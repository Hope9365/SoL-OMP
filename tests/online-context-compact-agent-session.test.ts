/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, SessionManager, Settings, type AgentSession, type ExtensionFactory } from "@oh-my-pi/pi-coding-agent";
import { initializeExtensions } from "@oh-my-pi/pi-coding-agent/modes/runtime-init";
import { describe, expect, it } from "vitest";
import { createOnlineContextCompactExtension } from "../src/sol-omp/extensions/online-context-compact/extension.ts";
import { scriptedProvider } from "./scripted-provider.ts";
import { isolatedOmpTest } from "./isolated-omp.ts";

const OPEN = [{ id: "build", goal: "build it", status: "in_progress" }] as const;
const DONE = [{ id: "build", goal: "build it", status: "completed" }] as const;
const REKEYED = [{ id: "rebuild", goal: "build it (restated)", status: "completed" }] as const;
const PROGRESS = {
	files_changed: ["src/a.ts"],
	verification: ["tests passed"],
	decisions: ["kept the implementation small"],
};

type CompletedPlan = readonly { readonly id: string; readonly goal: string; readonly status: "completed" }[];

async function runScenario(cwd: string, compactions: 1 | 2, reissuedPlans: readonly CompletedPlan[] = []): Promise<void> {
	const agentDir = join(cwd, "agent");
	let session: AgentSession | undefined;
	try {
		await mkdir(agentDir);
		const finalReply = "all plan work complete";
		let requestedCompactions = 0;
		const provider = scriptedProvider({
			provider: `sol-omp-occ-${compactions}-${reissuedPlans.length}-${reissuedPlans[0]?.[0]?.id ?? "fresh"}`,
			contextWindow: 4_096,
			maxTokens: 1_024,
			handler: (context) => {
				const hasResult = (id: string) => context.messages.some((message) => message.role === "toolResult" && message.toolCallId === id);
				if (requestedCompactions < compactions) {
					const ordinal = requestedCompactions + 1;
					if (!hasResult(`plan-open-${ordinal}`)) return { content: [
						...(ordinal === 1 ? [] : [Array.from({ length: 200 }, (_, index) => `Change ${index}: checked branch ${index * 17} and retained its evidence.\n`).join("")]),
						{ type: "toolCall", name: "update_plan", arguments: { steps: OPEN }, id: `plan-open-${ordinal}` },
					] };
					if (!hasResult(`plan-done-${ordinal}`)) return { content: [{ type: "toolCall", name: "update_plan", arguments: { steps: DONE, progress: PROGRESS }, id: `plan-done-${ordinal}` }] };
				} else {
					for (const [index, steps] of reissuedPlans.entries()) {
						if (!hasResult(`plan-reissued-${index}`)) return { content: [{ type: "toolCall", name: "update_plan", arguments: { steps }, id: `plan-reissued-${index}` }] };
					}
				}
				return { content: [finalReply], delayMs: 80 };
			},
		});
		const extension: ExtensionFactory = (omp) => {
			createOnlineContextCompactExtension({ cacheWriteReadRatio: 0, keepRecentTokens: 150 })(omp);
			omp.on("session_before_compact", (event) => {
				requestedCompactions++;
				return { compaction: {
					summary: `deterministic compacted history ${"s".repeat(6_000)}`,
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
				} };
			});
		};
		const sessionManager = SessionManager.inMemory(cwd);
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: `historical request ${"x".repeat(6_000)}` }],
			timestamp: Date.now() - 2,
		});
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: `historical response ${"y".repeat(6_000)}` }],
			api: provider.model.api,
			provider: provider.model.provider,
			model: provider.model.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop",
			timestamp: Date.now() - 1,
		});
		({ session } = await createAgentSession({
			cwd, agentDir, sessionManager,
			model: provider.model,
			thinkingLevel: "off",
			settings: Settings.isolated({
				"compaction.enabled": false,
				"compaction.keepRecentTokens": 150,
				"compaction.reserveTokens": 1_024,
				"retry.enabled": false,
				"title.refreshOnReplan": false,
			}),
			extensions: [provider.extension, extension],
			disableExtensionDiscovery: true,
			preloadedCustomToolPaths: [],
			skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
			enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true,
			requireYieldTool: false, toolNames: ["update_plan"], autoApprove: true,
			systemPrompt: "You are a deterministic lifecycle test assistant.",
		}));
		await sessionManager.setSessionName("Compaction integration", "user");
		const errors: unknown[] = [];
		await initializeExtensions(session, {
			reportSendError: (_action, error) => errors.push(error),
			reportRuntimeError: (error) => errors.push(error),
		});
		let finishContinuation!: () => void;
		let failContinuation!: (error: Error) => void;
		const continuationFinished = new Promise<void>((resolve, reject) => { finishContinuation = resolve; failContinuation = reject; });
		let ended = false;
		session.subscribe((event) => {
			if (event.type === "agent_end") ended = true;
			if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "error") failContinuation(new Error(event.message.errorMessage));
			if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "stop" && requestedCompactions === compactions) finishContinuation();
		});
		await session.prompt("finish the current plan step", { expandPromptTemplates: false });
		await continuationFinished;
		await session.waitForIdle();

		expect(requestedCompactions).toBe(compactions);
		expect(sessionManager.getBranch().filter((entry) => entry.type === "compaction")).toHaveLength(compactions);
		expect(session.getLastAssistantText()).toBe(finalReply);
		expect(ended).toBe(true);
		expect(session.isStreaming).toBe(false);
		expect(errors).toEqual([]);
	} finally {
		await session?.dispose();
	}
}

describe("Online Context Compact with a real OMP AgentSession", () => {
	it("settles the automatic continuation through the native idle barrier", async () => {
		await isolatedOmpTest(fileURLToPath(import.meta.url), "settles the automatic continuation through the native idle barrier", (cwd) => runScenario(cwd, 1));
	}, 20_000);
	it("settles two consecutive automatic compactions", async () => {
		await isolatedOmpTest(fileURLToPath(import.meta.url), "settles two consecutive automatic compactions", (cwd) => runScenario(cwd, 2));
	}, 20_000);
	it("compacts once when the post-compaction reminder re-states the identical plan", async () => {
		await isolatedOmpTest(fileURLToPath(import.meta.url), "compacts once when the post-compaction reminder re-states the identical plan", (cwd) => runScenario(cwd, 1, [DONE, DONE, DONE]));
	}, 20_000);
	it("compacts once despite repeated re-keyed completed plans past the cooldown", async () => {
		await isolatedOmpTest(fileURLToPath(import.meta.url), "compacts once despite repeated re-keyed completed plans past the cooldown", (cwd) => runScenario(cwd, 1, [REKEYED, REKEYED.map((step) => ({ ...step, id: "renamed-again" })), REKEYED.map((step) => ({ ...step, id: "renamed-once-more" }))]));
	}, 20_000);
});
