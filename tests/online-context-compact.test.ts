/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import type { CompactOptions, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	BOUNDARY_COMPACTION_INSTRUCTIONS,
	createOnlineContextCompactExtension,
	DEFAULT_KEEP_RECENT_TOKENS,
	estimateNativeCompactionTokens,
	DEFAULT_NATIVE_SUMMARY_TOKEN_ESTIMATE,
	POST_COMPACTION_PLAN_REMINDER,
	registerOnlineContextCompact,
	resolveKeepRecentTokens,
} from "../src/sol-omp/extensions/online-context-compact/index.ts";
import {
	appendOnlineState,
	initialOnlineState,
	restoreOnlineState,
} from "../src/sol-omp/extensions/online-context-compact/state.ts";
import { FakePi, FakeSessionManager, fakeContext } from "./helpers.ts";
const tokenizer = new Tokenizer();

const OPEN = [{ id: "build", goal: "build it", status: "in_progress" }] as const;
const DONE = [{ id: "build", goal: "build it", status: "completed" }] as const;
const PROGRESS = {
	files_changed: ["src/a.ts"],
	verification: ["tests passed"],
	decisions: ["kept the implementation small"],
};

function assistant(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "test",
		provider: "test",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

async function runPlan(pi: FakePi, context: ExtensionContext, id: string, params: unknown) {
	const execute = pi.tool("update_plan").execute as (
		toolCallId: string,
		params: unknown,
		signal: undefined,
		onUpdate: undefined,
		context: ExtensionContext,
	) => Promise<{ content: unknown[]; details: Readonly<Record<string, unknown>> }>;
	return await execute(id, params, undefined, undefined, context);
}

describe("Online Context Compact extension", () => {
	it("rejects invalid retained-tail overrides", () => {
		expect(() => resolveKeepRecentTokens(0)).toThrow(/positive safe integer/u);
		expect(resolveKeepRecentTokens(50)).toBe(50);
	});

	it("observes context without changing it", async () => {
		const pi = new FakePi();
		registerOnlineContextCompact(pi.asExtensionApi());
		const context = fakeContext(pi.sessionManager);
		await pi.emit("session_start", { type: "session_start" }, context);
		const messages = [assistant("unchanged")];
		expect(await pi.emitContext(messages, context)).toEqual(messages);
	});

	it.each([0, 3])("records real progress on the first plan update after compaction, following %s work requests", async (workRequests) => {
		const manager = new FakeSessionManager();
		const pi = new FakePi(manager);
		appendOnlineState(pi.asExtensionApi(), {
			...initialOnlineState(), plan: OPEN, requestCount: 5,
			lastBoundaryRequestCount: 2, completedBoundaryRequestCounts: [2],
		});
		registerOnlineContextCompact(pi.asExtensionApi());
		const context = fakeContext(manager);
		await pi.emit("session_start", {}, context);
		await pi.emit("session_compact", { fromExtension: false }, context);
		for (let index = 0; index < workRequests; index++) {
			await pi.emit("before_provider_request", {}, context);
			await pi.emit("turn_end", { message: assistant("work"), toolResults: [{ toolName: "bash", isError: false }] }, context);
		}
		await pi.emit("before_provider_request", {}, context);
		const result = await runPlan(pi, context, "completed-after-compact", { steps: DONE, progress: PROGRESS });
		expect(result.details).toMatchObject({ boundary: true, progress_recorded: true, completed_step_ids: ["build"] });
		expect(restoreOnlineState(manager.entries)).toMatchObject({
			plan: DONE, completedBoundaryRequestCounts: [2, 4 + workRequests],
			pendingProgress: [expect.objectContaining({ stepId: "build", verification: PROGRESS.verification })],
		});
	});

	it("matches OMP's removable messages across initial and repeated compactions", () => {
		const manager = new FakeSessionManager();
		manager.appendMessage({ role: "user", content: "x".repeat(100), timestamp: Date.now() });
		manager.appendMessage(assistant("y".repeat(100_000)));
		const initialEntries = manager.getBranch();
		const initialMessage = initialEntries[0];
		if (initialMessage?.type !== "message") throw new Error("expected message entry");
		const initialExpected = tokenizer.countMessage(initialMessage.message);
		expect(estimateNativeCompactionTokens(initialEntries, 20_000)).toBe(initialExpected);
		expect(initialExpected).toBeLessThan(DEFAULT_NATIVE_SUMMARY_TOKEN_ESTIMATE);

		const firstKeptEntryId = manager.entries.at(-1)?.id ?? "message-2";
		manager.entries.push({
			type: "compaction",
			id: "compact-1",
			parentId: firstKeptEntryId,
			timestamp: new Date().toISOString(),
			summary: "s".repeat(8_000),
			firstKeptEntryId,
			tokensBefore: 25_025,
		});
		manager.leafId = "compact-1";
		manager.appendMessage({ role: "user", content: "new work", timestamp: Date.now() });
		manager.appendMessage(assistant("z".repeat(8_000)));
		const repeatedEntries = manager.getBranch();
		const previousSummary = repeatedEntries.findLast((entry) => entry.type === "compaction");
		if (!previousSummary) throw new Error("expected compaction entry");
		const previousSummaryMessage: AgentMessage = {
			role: "compactionSummary",
			summary: previousSummary.summary,
			tokensBefore: previousSummary.tokensBefore,
			timestamp: new Date(previousSummary.timestamp).getTime(),
		};
		const firstKept = repeatedEntries.find((entry) => entry.id === previousSummary.firstKeptEntryId);
		const newUser = repeatedEntries.at(-2);
		if (firstKept?.type !== "message" || newUser?.type !== "message") {
			throw new Error("expected removable message entries");
		}
		const repeatedExpected =
			tokenizer.countMessage(previousSummaryMessage) + tokenizer.countMessage(firstKept.message) + tokenizer.countMessage(newUser.message);
		expect(estimateNativeCompactionTokens(repeatedEntries, 1)).toBe(repeatedExpected);

		const noNewPrefix = repeatedEntries.slice(0, repeatedEntries.indexOf(previousSummary) + 2);
		expect(estimateNativeCompactionTokens(noNewPrefix, 200_000)).toBe(0);
	});

	it("defers when Pi's cut point leaves too little history to offset the summary", async () => {
		const manager = new FakeSessionManager();
		manager.appendMessage({ role: "user", content: "x".repeat(100), timestamp: Date.now() });
		manager.appendMessage(assistant("y".repeat(100_000)));
		const pi = new FakePi(manager);
		createOnlineContextCompactExtension({ cacheWriteReadRatio: 12.5 })(pi.asExtensionApi());
		const abort = vi.fn();
		const compact = vi.fn();
		const context = fakeContext(manager, {
			abort,
			compact,
			getContextUsage: () => ({ tokens: 25_025, contextWindow: 30_000, percent: 83.4 }),
		});

		await pi.emit("session_start", { type: "session_start" }, context);
		await pi.emitContext(
			[
				{ role: "user", content: "x".repeat(100), timestamp: Date.now() },
				assistant("y".repeat(100_000)),
			],
			context,
		);
		await pi.emit("before_provider_request", { type: "before_provider_request", payload: {} }, context);
		await runPlan(pi, context, "plan-open", { steps: OPEN });
		await runPlan(pi, context, "plan-done", { steps: DONE, progress: PROGRESS });
		await pi.emit(
			"turn_end",
			{
				type: "turn_end",
				turnIndex: 1,
				message: assistant("boundary"),
				toolResults: [
					{
						role: "toolResult",
						toolCallId: "plan-done",
						toolName: "update_plan",
						content: [{ type: "text", text: "done" }],
						isError: false,
						timestamp: Date.now(),
					},
				],
			},
			context,
		);

		expect(abort).not.toHaveBeenCalled();
		await pi.emit("agent_end", { type: "agent_end" }, context);
		expect(compact).not.toHaveBeenCalled();
	});

	it.each([false, true])("preserves existing debt during unrelated native compaction (fromExtension=%s)", async (fromExtension) => {
		const manager = new FakeSessionManager();
		const pi = new FakePi(manager);
		appendOnlineState(pi.asExtensionApi(), {
			...initialOnlineState(),
			cacheDebtTokens: 900,
			cacheDebtRepaymentTokens: 300,
		});
		registerOnlineContextCompact(pi.asExtensionApi());
		const context = fakeContext(manager);

		await pi.emit("session_start", { type: "session_start" }, context);
		await pi.emit(
			"session_compact",
			{
				type: "session_compact",
				fromExtension,
				reason: "manual",
				willRetry: false,
				compactionEntry: {},
			},
			context,
		);

		expect(restoreOnlineState(manager.entries)).toMatchObject({
			nativeCompactionCount: 1,
			cacheDebtTokens: 900,
			cacheDebtRepaymentTokens: 300,
		});
	});

	it("stops at an eligible completed-step boundary, then compacts after settlement", async () => {
		const manager = new FakeSessionManager();
		manager.appendMessage({ role: "user", content: `old ${"x".repeat(8_000)}`, timestamp: Date.now() });
		manager.appendMessage(assistant(`work ${"y".repeat(2_000)}`));
		const pi = new FakePi(manager);
		createOnlineContextCompactExtension({ cacheWriteReadRatio: 12.5, keepRecentTokens: 1 })(pi.asExtensionApi());
		let idle = true;
		const abort = vi.fn();
		const compactCalls: CompactOptions[] = [];
		let finishCompaction!: () => void;
		const compactionGate = new Promise<void>((resolve) => {
			finishCompaction = resolve;
		});
		let context: ExtensionContext;
		const compact = (options: CompactOptions = {}): Promise<void> => {
			compactCalls.push(options);
			return compactionGate.then(() => pi
				.emit(
					"session_compact",
					{
						type: "session_compact",
						fromExtension: false,
						reason: "manual",
						willRetry: false,
						compactionEntry: {
							type: "compaction",
							id: "compact-1",
							parentId: manager.getLeafId(),
							timestamp: new Date().toISOString(),
							summary: "summary",
							firstKeptEntryId: manager.entries.at(-1)?.id ?? "message-1",
							tokensBefore: 195_000,
						},
					},
					context,
				))
				.then(() => { options.onComplete?.({
					summary: "summary",
					firstKeptEntryId: manager.entries.at(-1)?.id ?? "message-1",
					tokensBefore: 195_000,
				}); });
		};
		context = fakeContext(manager, {
			abort,
			compact,
			isIdle: () => idle,
			getSystemPrompt: () => ["test prompt"],
			getContextUsage: () => ({ tokens: 195_000, contextWindow: 200_000, percent: 97.5 }),
		});

		await pi.emit("session_start", { type: "session_start" }, context);
		await pi.emitContext(manager.entries.flatMap((entry) => entry.type === "message" ? [entry.message] : []), context);
		await pi.emit("before_provider_request", { type: "before_provider_request", payload: {} }, context);
		await runPlan(pi, context, "plan-open", { steps: OPEN });
		const planResult = await runPlan(pi, context, "plan-done", { steps: DONE, progress: PROGRESS });

		await pi.emit(
			"turn_end",
			{
				type: "turn_end",
				turnIndex: 1,
				message: assistant("boundary"),
				toolResults: [
					{
						role: "toolResult",
						toolCallId: "plan-done",
						toolName: "update_plan",
						content: [{ type: "text", text: "done" }],
						isError: false,
						timestamp: Date.now(),
					},
				],
			},
			context,
		);

		expect(planResult.details).toMatchObject({ boundary: true, progress_recorded: true });
		expect(abort).toHaveBeenCalledOnce();
		expect(compactCalls).toEqual([]);

		idle = false;
		let firstSettlementFinished = false;
		const firstSettlement = pi.emit("agent_end", { type: "agent_end" }, context).then(() => {
			firstSettlementFinished = true;
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(compactCalls).toHaveLength(1);
		expect(await pi.emit("session_before_tree", { type: "session_before_tree" }, context)).toEqual({ cancel: true });
		finishCompaction();
		await firstSettlement;
		expect(pi.sentMessages).toHaveLength(1);

		expect(compactCalls).toHaveLength(1);
		expect(compactCalls[0]?.internalGuidance).toBe(BOUNDARY_COMPACTION_INSTRUCTIONS);
		await firstSettlement;
		expect(firstSettlementFinished).toBe(true);
		expect(pi.sentMessages).toEqual([
			{
				message: {
					customType: "sol-omp-online-context-compact",
					content: POST_COMPACTION_PLAN_REMINDER,
					display: false,
				},
				options: { triggerTurn: true },
			},
		]);

		idle = true;
		await pi.emit("agent_end", { type: "agent_end" }, context);
		await firstSettlement;
		expect(firstSettlementFinished).toBe(true);
		expect(await pi.emit("session_before_tree", { type: "session_before_tree" }, context)).toBeUndefined();
		expect(restoreOnlineState(manager.entries)).toMatchObject({
			nativeCompactionCount: 1,
			pendingProgress: [],
			cacheDebtTokens: (195_000 - (estimateNativeCompactionTokens(manager.getBranch(), 1) - 1_000)) * (12.5 - 1),
			cacheDebtRepaymentTokens: estimateNativeCompactionTokens(manager.getBranch(), 1) - 1_000,
		});
	});
});

function buildSessionMessages(): AgentMessage[] {
	return [
		{ role: "user", content: `old ${"x".repeat(8_000)}`, timestamp: Date.now() },
		assistant(`work ${"y".repeat(2_000)}`),
	];
}
