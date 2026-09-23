/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import type { ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { recordValue } from "./config.ts";

/** Markers written by the action-fusion extension around a fused command's output. */
const THEN_RUN_SUCCEEDED = "[then_run:succeeded]";
const THEN_RUN_FAILED = "[then_run:failed]";

export interface ReducibleToolResult {
	readonly command: string;
	readonly body: string;
	/** Put the receipt back where the raw output was, leaving the rest of the result alone. */
	readonly projectReceipt: (receipt: string) => ToolResultEvent["content"];
}

function textContent(event: ToolResultEvent): string {
	return event.content
		.filter((item): item is { type: "text"; text: string } => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}

// OMP spills long bash output to artifact://; leave its recoverable original untouched.
const ARTIFACT_FOOTER = /\[raw output: artifact:\/\/[^\]]+\]/u;

/**
 * Identify the log inside a tool result: either a plain bash result, or the
 * command output appended by a fused `edit`/`write` call.
 */
export async function reducibleToolResult(event: ToolResultEvent): Promise<ReducibleToolResult | undefined> {
	if (event.toolName === "bash") {
		const command = typeof event.input.command === "string" ? event.input.command : "";
		if (!command) return undefined;
		const inline = textContent(event);
		if (ARTIFACT_FOOTER.test(inline)) return undefined;
		return {
			command,
			body: inline,
			projectReceipt: (receipt) => [{ type: "text", text: receipt }],
		};
	}
	if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
	const thenRun = recordValue(event.input, "then_run");
	const commandValue = recordValue(thenRun, "command");
	if (typeof commandValue !== "string" || !commandValue) return undefined;
	const marker = event.isError ? THEN_RUN_FAILED : THEN_RUN_SUCCEEDED;
	for (let index = 0; index < event.content.length; index++) {
		const block = event.content[index];
		if (!block || block.type !== "text") continue;
		if (ARTIFACT_FOOTER.test(block.text)) return undefined;
		const markerIndex = block.text.indexOf(marker);
		if (markerIndex < 0) continue;
		const suffixStart = markerIndex + marker.length;
		const suffix = block.text.slice(suffixStart);
		const separator = suffix.match(/^(?:\r?\n)+/u)?.[0] ?? "\n";
		const inline = suffix.slice(separator === "\n" && !suffix.startsWith("\n") ? 0 : separator.length);
		return {
			command: commandValue,
			body: inline,
			projectReceipt: (receipt) =>
				event.content.map((content, contentIndex) =>
					contentIndex === index && content.type === "text"
						? { ...content, text: `${content.text.slice(0, suffixStart)}${separator}${receipt}` }
						: content,
				),
		};
	}
	return undefined;
}
