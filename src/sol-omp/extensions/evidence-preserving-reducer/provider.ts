/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { completeSimple } from "@oh-my-pi/pi-ai";
import type { Api, AssistantMessage, Model } from "@oh-my-pi/pi-ai";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { ArchiveObject } from "./archive.ts";
import type { ReducerConfig } from "./config.ts";
import { reducerInput, reducerInstructions } from "./receipt.ts";

export type ReducerComplete = typeof completeSimple;

export interface NormalizedUsage {
 readonly input: number;
 readonly output: number;
 readonly cacheRead: number;
 readonly cacheWrite: number;
 readonly totalTokens: number;
}

export interface ProviderResult {
 readonly model: string;
 readonly ok: boolean;
 readonly outputText: string;
 readonly provider: string;
 readonly stopReason: AssistantMessage["stopReason"];
 readonly usage: NormalizedUsage;
}

export class ReducerModelUnavailableError extends Error {
 override readonly name = "ReducerModelUnavailableError";
}

function operationSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(new DOMException("Reducer model call timed out", "AbortError")), timeoutMs);
 return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

/** Use only the configured model and OMP-managed credentials, never the active model as a fallback. */
export async function callReducer(
 config: ReducerConfig,
 command: string,
 isError: boolean,
 archive: ArchiveObject,
 body: string,
 context: ExtensionContext,
 complete: ReducerComplete = completeSimple,
): Promise<ProviderResult> {
 const model: Model<Api> | undefined = context.modelRegistry.find(config.reducerProvider, config.reducerModel);
 if (!model || model.provider !== config.reducerProvider || model.id !== config.reducerModel) {
  throw new ReducerModelUnavailableError("Configured reducer model unavailable");
 }
 const operation = operationSignal(config.timeoutMs);
 try {
  const sessionId = context.sessionManager.getSessionId();
  if (!await context.modelRegistry.getApiKey(model, sessionId, { signal: operation.signal })) {
   throw new Error("Reducer credential unavailable");
  }
  const response = await complete(model, {
   systemPrompt: [reducerInstructions()],
   messages: [{ role: "user", content: [{ type: "text", text: reducerInput(command, isError, archive, body) }], timestamp: Date.now() }],
  }, {
   apiKey: context.modelRegistry.resolver(model, sessionId),
   cacheRetention: "none",
   maxTokens: Math.min(config.maxOutputTokens, model.maxTokens ?? config.maxOutputTokens),
   sessionId: config.runId,
   signal: operation.signal,
  });
  return {
   model: response.model,
   ok: response.stopReason === "stop" && response.provider === model.provider && response.model === model.id,
   outputText: response.content.flatMap(item => item.type === "text" ? [item.text] : []).join(""),
   provider: response.provider,
   stopReason: response.stopReason,
   usage: {
    input: response.usage.input,
    output: response.usage.output,
    cacheRead: response.usage.cacheRead,
    cacheWrite: response.usage.cacheWrite,
    totalTokens: response.usage.totalTokens,
   },
  };
 } finally {
  operation.cleanup();
 }
}
