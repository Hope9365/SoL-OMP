/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { Tokenizer, type AgentMessage, type AgentToolResult } from "@oh-my-pi/pi-agent-core";
import { findCutPoint, type SessionEntry as CompactionSessionEntry } from "@oh-my-pi/pi-agent-core/compaction";
import type { ExtensionContext, ExtensionFactory, SessionEntry } from "@oh-my-pi/pi-coding-agent";
import { formatSavingsCount, showSolOmpSavings } from "../../tui.ts";

const tokenizer = new Tokenizer();
import {
	DEFAULT_COMPACTION_ECONOMICS,
	decideCompaction,
	type CompactionDecision,
} from "./economics.ts";
import { analyzePlanTransition, formatPlanSnapshot, parsePlanSteps } from "./plan.ts";
import { entryMessages, projectedEntryTokens } from "./projection.ts";
import {
	appendOnlineState,
	initialOnlineState,
	recordBoundary,
	recordCompaction,
	recordCompletedPlanHandoff,
	recordCorrection,
	recordProviderRequest,
	restoreOnlineState,
	type OnlineState,
	type ProgressSummary,
} from "./state.ts";
import { registerOnlineTools, type PlanUpdateInput } from "./tools.ts";

export const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
export const DEFAULT_NATIVE_SUMMARY_TOKEN_ESTIMATE = 1_000;
export const BOUNDARY_COMPACTION_INSTRUCTIONS =
	"Preserve completed work, verification results, important decisions, and remaining work.";
export const POST_COMPACTION_PLAN_REMINDER =
	"Online context compaction finished. The parent task is still active. " +
	"Continue the remaining work from the current plan. Preserve existing step IDs when updating progress.";
export const SKIPPED_COMPACTION_REMINDER =
	"Online context compaction was skipped. The existing context is still available. " +
	"Continue the remaining work from the current plan.";
const FAILED_COMPACTION_REMINDER =
	"Online context compaction did not complete. The parent task is still active. " +
	"Continue the remaining work from the current plan.";
// OMP rejects these before committing a replacement summary, so the current
// context is still usable. Unknown errors and user cancellation remain distinct.
const RECOVERABLE_COMPACTION_ERRORS = new Set([
	"Nothing to compact (session too small)",
	"Nothing to compact (session too small or already rolled over)",
	"Already compacted",
	"Summarization failed: generation hit the token cap and the summary is incomplete",
]);

export type OnlineContextCompactOptions = {
	readonly cacheWriteReadRatio?: number | null;
	readonly keepRecentTokens?: number;
};

type PendingBoundary = { readonly toolCallId: string };
type SelectedCompaction = { readonly decision: CompactionDecision };
type CacheDebt = { readonly debtTokens: number; readonly repaymentTokens: number };

export function resolveKeepRecentTokens(value: number | undefined): number {
	const resolved = value ?? DEFAULT_KEEP_RECENT_TOKENS;
	if (!Number.isSafeInteger(resolved) || resolved < 1) {
		throw new Error("Online Context Compact keepRecentTokens must be a positive safe integer");
	}
	return resolved;
}

function resolveCacheWriteReadRatio(value: number | null | undefined): number | null {
	if (value === undefined || value === null) return null;
	if (!Number.isFinite(value) || value < 0) {
		throw new Error("Online Context Compact cacheWriteReadRatio must be finite and non-negative");
	}
	return value;
}

function tokenEstimate(text: string): number {
	return Math.ceil(Buffer.byteLength(text) / 4);
}

function result(text: string, details: Readonly<Record<string, unknown>>): AgentToolResult<Readonly<Record<string, unknown>>> {
	return { content: [{ type: "text", text }], details };
}

function progressSummary(input: PlanUpdateInput, completedStepId: string): ProgressSummary | undefined {
	const step = input.steps.find((item) => item.id === completedStepId);
	if (!step || !input.progress) return;
	return {
		stepId: step.id,
		goal: step.goal,
		filesChanged: [...input.progress.files_changed],
		verification: [...input.progress.verification],
		decisions: [...input.progress.decisions],
		nextWork: input.steps.filter((item) => item.status !== "completed").map((item) => item.goal),
	};
}

function compactionTokenEstimate(
	entries: readonly SessionEntry[],
	startIndex: number,
	endIndex: number,
	projected?: ReadonlyMap<string, number>,
): number {
	let tokens = 0;
	for (let index = startIndex; index < endIndex; index++) {
		const entry = entries[index];
		if (!entry || entry.type === "compaction") continue;
		if (projected) {
			tokens += projected.get(entry.id) ?? 0;
			continue;
		}
		const message = entryMessages(entry)[0];
		if (message) tokens += tokenizer.countMessage(message);
	}
	return tokens;
}


export function estimateNativeCompactionTokens(
	entries: readonly SessionEntry[],
	keepRecentTokens: number,
	projectedMessages?: readonly AgentMessage[],
): number {
	const path = [...entries];
	const projected = projectedMessages === undefined ? undefined : projectedEntryTokens(entries, projectedMessages);
	let startIndex = 0;
	let previousSummaryTokens = 0;
	for (let index = path.length - 1; index >= 0; index--) {
		const entry = path[index];
		if (entry?.type !== "compaction") continue;
		const keptIndex = path.findIndex((item) => item.id === entry.firstKeptEntryId);
		startIndex = keptIndex >= 0 ? keptIndex : index + 1;
		const previousSummary = entryMessages(entry)[0];
		previousSummaryTokens = projected
			? projected.get(entry.id) ?? 0
			: previousSummary ? tokenizer.countMessage(previousSummary) : 0;
		break;
	}

	// Keep OMP's native cut on session entries; price only provider-visible messages.
	const cut = findCutPoint(path as CompactionSessionEntry[], tokenizer, startIndex, path.length, keepRecentTokens);
	const firstKept = cut.firstKeptEntryIndex;
	if (compactionTokenEstimate(path, startIndex, firstKept) === 0) return 0;
	return previousSummaryTokens + compactionTokenEstimate(path, startIndex, firstKept, projected);
}

function validPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function createOnlineContextCompactExtension(options: OnlineContextCompactOptions = {}): ExtensionFactory {
	const keepRecentTokens = resolveKeepRecentTokens(options.keepRecentTokens);
	const cacheWriteReadRatio = resolveCacheWriteReadRatio(options.cacheWriteReadRatio);

	return (pi) => {
		let state: OnlineState = initialOnlineState();
		let restored = false;
		let observedMessages: readonly AgentMessage[] = [];
		let pendingBoundary: PendingBoundary | undefined;
		let selected: SelectedCompaction | undefined;
		let activeDebt: CacheDebt | undefined;
		let compactionInFlight = false;
		let compactionRefused = false;


		const restore = (context: ExtensionContext): void => {
			state = restoreOnlineState(context.sessionManager.getBranch());
			restored = true;
			// Restoring raw history is not evidence of a provider-visible projection.
			observedMessages = [];
			pendingBoundary = undefined;
			selected = undefined;
			activeDebt = undefined;
			compactionInFlight = false;
			compactionRefused = false;
		};
		const ensureRestored = (context: ExtensionContext): void => {
			if (!restored) restore(context);
		};
		const save = (): void => appendOnlineState(pi, state);
		const contextTokens = (context: ExtensionContext): number => {
			const visible = observedMessages.reduce((total, message) => total + tokenizer.countMessage(message), 0);
			const estimated = visible + tokenEstimate(context.getSystemPrompt().join("\n"));
			const reported = context.getContextUsage()?.tokens;
			return validPositiveInteger(reported) ? Math.max(reported, estimated) : estimated;
		};

		registerOnlineTools(pi, {
			updatePlan: async (input) => {
				ensureRestored(input.context);
				if (input.signal?.aborted) throw new Error("Plan update was aborted");
				const steps = parsePlanSteps(input.steps);
				if (!steps || steps.length === 0) throw new Error("Plan must contain at least one valid step");

				const transition = analyzePlanTransition(state.plan, steps);
				const completedIds = transition.completedSteps.map((step) => step.id);
				if (completedIds.length > 0) {
					state = recordBoundary(state, steps, progressSummary(input, completedIds[0] ?? ""));
					if (!pendingBoundary) pendingBoundary = { toolCallId: input.toolCallId };
				} else {
					state = { ...state, plan: [...steps] };
				}
				save();

				return result(
					[formatPlanSnapshot(steps), ...transition.advice].join("\n"),
					{
						boundary: completedIds.length > 0,
						completed_step_ids: completedIds,
						progress_recorded: completedIds.length > 0 && input.progress !== undefined,
						task_status: "active",
						plan: steps,
					},
				);
			},
		});

		pi.on("session_start", (_event, context) => restore(context));
		pi.on("session_before_tree", () => (compactionInFlight ? { cancel: true } : undefined));
		pi.on("session_tree", (_event, context) => restore(context));

		pi.on("context", (event, context) => {
			ensureRestored(context);
			observedMessages = [...event.messages];
		});

		pi.on("before_provider_request", (_event, context) => {
			ensureRestored(context);
			state = recordProviderRequest(state, contextTokens(context));
			save();
		});

		pi.on("input", (event, context) => {
			compactionRefused = false;
			ensureRestored(context);
			if (context.isIdle() && !event.text.startsWith("CORRECTION:")) {
				const next = recordCompletedPlanHandoff(state);
				if (next !== state) {
					state = next;
					save();
				}
				return;
			}
			pendingBoundary = undefined;
			selected = undefined;
			activeDebt = undefined;
			state = recordCorrection(state);
			save();
		});

		pi.on("turn_end", (event, context) => {
			// Plan chatter cannot make a rejected compact feasible. Require actual
			// tool work or new user input before attempting another boundary.
			if (event.toolResults.some((item) => item.toolName !== "update_plan" && !item.isError)) compactionRefused = false;
			const boundary = pendingBoundary;
			pendingBoundary = undefined;
			if (!boundary || selected || compactionRefused) return;
			const toolResult = event.toolResults.find((item) => item.toolCallId === boundary.toolCallId);
			if (
				event.message.role !== "assistant" ||
				event.message.stopReason === "error" ||
				event.message.stopReason === "aborted" ||
				!toolResult ||
				toolResult.isError
			) {
				return;
			}

			const usage = context.getContextUsage();
			const writeTokens = contextTokens(context);
			const archiveTokens = estimateNativeCompactionTokens(
				context.sessionManager.getBranch(),
				keepRecentTokens,
				observedMessages,
			);
			const contextWindowTokens = validPositiveInteger(usage?.contextWindow)
				? usage.contextWindow
				: validPositiveInteger(context.model?.contextWindow)
					? context.model.contextWindow
					: null;
			const averageContextTokenIncrement =
				state.positiveContextDeltaCount === 0
					? null
					: state.positiveContextDeltaTotal / state.positiveContextDeltaCount;
			const priced = decideCompaction({
				writeTokens,
				archiveTokens,
				memoTokens: DEFAULT_NATIVE_SUMMARY_TOKEN_ESTIMATE,
				contextTokens: writeTokens,
				completedBoundaryRequestCounts: state.completedBoundaryRequestCounts,
				remainingBoundaries: state.plan.filter((step) => step.status !== "completed").length,
				averageContextTokenIncrement,
				contextWindowTokens,
				priorCompactionCount: state.nativeCompactionCount,
				requestsSinceLastCompaction:
					state.lastCompactionRequestCount === null
						? null
						: state.requestCount - state.lastCompactionRequestCount,
				carriedDebtTokens: state.cacheDebtTokens,
				cacheDebtRepaymentTokens: state.cacheDebtRepaymentTokens,
				cacheWriteReadRatio,
				economics: DEFAULT_COMPACTION_ECONOMICS,
			});
			const decision: CompactionDecision =
				priced.compact && archiveTokens === 0
					? { ...priced, compact: false, reason: "native_not_compactable" }
					: priced;
			if (!decision.compact) return;

			selected = { decision };
			context.abort();
		});

		pi.on("agent_end", async (_event, context) => {
			const pending = selected;
			selected = undefined;
			if (!pending) return;
			activeDebt = {
				debtTokens: pending.decision.postCompactionTokens * (pending.decision.incrementalCacheCostRatio ?? 0),
				repaymentTokens: Math.max(0, pending.decision.archiveTokens - pending.decision.memoTokens),
			};
			let compacted = false;
			let compactionError: Error | undefined;
			try {
				compactionInFlight = true;
				try {
					// agent_end can precede prompt unwind; native compact owns the abort/idle barrier.
					await context.compact({
						internalGuidance: BOUNDARY_COMPACTION_INSTRUCTIONS,
						suppressContinuation: true,
						onComplete: (compaction) => {
							compacted = true;
							const removed = Math.max(0, pending.decision.archiveTokens - tokenEstimate(compaction.summary));
							if (removed > 0) showSolOmpSavings(context, "Online Context Compact", formatSavingsCount(removed, "context tokens removed"));
						},
						onError: (error) => {
							activeDebt = undefined;
							compactionError = error;
						},
					});
				} catch (error) {
					activeDebt = undefined;
					compactionError = error instanceof Error ? error : new Error(String(error));
				}
				const failure = compactionError?.name === "AbortError" || compactionError?.message === "Compaction cancelled"
					? undefined
					: compactionError;
				const recoverableError = failure !== undefined && RECOVERABLE_COMPACTION_ERRORS.has(failure.message);
				if (recoverableError) {
					compactionRefused = true;
					pi.appendEntry("sol-omp-online-context-compact-skipped", { reason: failure.message });
					if (context.mode === "tui") context.ui.notify(`Online compaction skipped: ${failure.message}`, "warning");
				}
				if (compacted || failure) {
					// OMP schedules triggerTurn asynchronously; don't wait for a child turn here.
					pi.sendMessage({
						customType: "sol-omp-online-context-compact",
						content: compacted ? POST_COMPACTION_PLAN_REMINDER
							: recoverableError ? SKIPPED_COMPACTION_REMINDER : FAILED_COMPACTION_REMINDER,
						display: false,
					}, { triggerTurn: true });
				}
				if (failure && !recoverableError) throw failure;
			} finally {
				compactionInFlight = false;
				activeDebt = undefined;
			}
		});

		pi.on("session_compact", (event, context) => {
			ensureRestored(context);
			compactionRefused = false;
			state = recordCompaction(
				state,
				event.fromExtension || !activeDebt ? { debtTokens: 0, repaymentTokens: 0 } : activeDebt,
			);
			save();
			pendingBoundary = undefined;
			selected = undefined;
			activeDebt = undefined;
			observedMessages = [];
		});

		pi.on("session_shutdown", () => {
			pendingBoundary = undefined;
			selected = undefined;
			activeDebt = undefined;
			compactionInFlight = false;
		});
	};
}
