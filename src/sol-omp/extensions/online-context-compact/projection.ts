/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent";
import { createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage } from "@oh-my-pi/pi-coding-agent/session/messages";

const tokenizer = new Tokenizer();

/** OMP's canonical message constructors keep identity aligned with session context. */
export function entryMessages(entry: SessionEntry): AgentMessage[] {
	if (entry.type === "message") return [entry.message];
	if (entry.type === "custom_message") return [createCustomMessage(entry.customType, entry.content, entry.display, entry.details, entry.timestamp, entry.attribution)];
	if (entry.type === "branch_summary" && entry.summary) return [createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)];
	if (entry.type === "compaction") return [createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp)];
	return [];
}

/** Native summary rendering metadata is not identity; tool-result payloads may be packed. */
function messageKey(message: AgentMessage): string {
	if (message.role === "compactionSummary") return JSON.stringify([message.role, message.summary, message.tokensBefore]);
	return message.role === "toolResult"
		? `tool:${JSON.stringify([message.toolCallId, message.toolName, message.timestamp])}`
		: JSON.stringify(message);
}

/** Map the last observed projection to source entries, without rerunning context hooks. */
export function projectedEntryTokens(
	entries: readonly SessionEntry[],
	projected: readonly AgentMessage[],
): ReadonlyMap<string, number> {
	const lastCompaction = entries.findLastIndex((entry) => entry.type === "compaction");
	let active = entries;
	if (lastCompaction >= 0) {
		const compaction = entries[lastCompaction];
		if (compaction?.type === "compaction") {
			const firstKept = entries.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
			active = [compaction, ...(firstKept >= 0 ? entries.slice(firstKept, lastCompaction) : []), ...entries.slice(lastCompaction + 1)];
		}
	}
	const sources = new Map<string, string[]>();
	for (const entry of active) {
		if (entry.type === "compaction" && entry !== entries[lastCompaction]) continue;
		for (const message of entryMessages(entry)) {
			const key = messageKey(message);
			const ids = sources.get(key) ?? [];
			ids.push(entry.id);
			sources.set(key, ids);
		}
	}
	const visible = new Map<string, number[]>();
	for (const message of projected) {
		const key = messageKey(message);
		const sizes = visible.get(key) ?? [];
		sizes.push(tokenizer.countMessage(message));
		visible.set(key, sizes);
	}
	const tokens = new Map<string, number>();
	for (const [key, ids] of sources) {
		const sizes = visible.get(key);
		// Dropped, rewritten, newly appended, or ambiguously duplicated messages
		// provide no proven savings. Never fall back to their raw content size.
		if (!sizes || sizes.length !== ids.length || (key.startsWith("tool:") && ids.length > 1)) continue;
		for (let index = 0; index < ids.length; index++) {
			const id = ids[index]!;
			tokens.set(id, (tokens.get(id) ?? 0) + sizes[index]!);
		}
	}
	return tokens;
}
