/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { ExecResult } from "@oh-my-pi/pi-coding-agent";

export const THEN_RUN_SUCCEEDED = "[then_run:succeeded]";
export const THEN_RUN_FAILED = "[then_run:failed]";
export const THEN_RUN_SKIPPED = "[then_run:skipped]";

export interface ThenRunInput {
 command: string;
 timeout?: number;
}

/** The native tool owns path resolution, approval, mutation locking and edit-mode parsing. */
export async function executeMutationThenRun<TDetails>({
 thenRun, mutate, run,
}: {
 thenRun?: ThenRunInput;
 mutate: () => Promise<AgentToolResult<TDetails>>;
 run: (command: string, timeout?: number) => Promise<ExecResult>;
}): Promise<AgentToolResult<TDetails>> {
 let mutation: AgentToolResult<TDetails>;
 try {
  mutation = await mutate();
 } catch (error) {
  if (!thenRun) throw error;
  throw new Error(THEN_RUN_SKIPPED + " Native mutation failed: " + String(error));
 }
 if (!thenRun) return mutation;
 if (mutation.isError) return {
  ...mutation,
  content: [...mutation.content, { type: "text", text: THEN_RUN_SKIPPED + " Native mutation failed" }],
 };
 try {
  const command = await run(thenRun.command, thenRun.timeout);
  const ok = command.code === 0 && !command.killed;
  const output = [ok ? THEN_RUN_SUCCEEDED : THEN_RUN_FAILED + " exit " + command.code,
   command.stdout, command.stderr].filter(Boolean).join("\n");
  return {
   ...mutation,
   content: [...mutation.content, { type: "text", text: output }],
   isError: !ok,
  };
 } catch (error) {
  return {
   ...mutation,
   content: [...mutation.content, { type: "text", text: THEN_RUN_FAILED + " " + String(error) }],
   isError: true,
  };
 }
}
