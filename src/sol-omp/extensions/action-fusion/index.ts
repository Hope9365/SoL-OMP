/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import type { ExtensionAPI, ExtensionFactory, ToolInfo } from "@oh-my-pi/pi-coding-agent";
import { fromJsonSchema } from "@oh-my-pi/omptype";
import { Type } from "@oh-my-pi/omptype/typebox";
import { showSolOmpSavings } from "../../tui.ts";
import { executeMutationThenRun, THEN_RUN_SUCCEEDED, type ThenRunInput } from "./then-run.ts";

const thenRunSchema = Type.Object({
 then_run: Type.Optional(Type.Object({
  command: Type.String({ description: "Shell command to run after a successful mutation" }),
  timeout: Type.Optional(Type.Number({ minimum: 0, description: "Timeout in seconds" })),
 })),
});

/** Preserve the active OMP edit variant (replace, patch, hashline, apply_patch, sloppy). */
export function createActionFusionExtension(): ExtensionFactory {
 return (pi) => {
  for (const name of ["edit", "write"] as const) {
   const native = pi.getAllTools().find((tool: ToolInfo) => tool.name === name && tool.sourceInfo.source === "builtin");
   if (!native) throw new Error("SoL-OMP requires OMP's native " + name + " tool");
   if (typeof native.parameters !== "function" || typeof native.parameters.toJsonSchema !== "function") {
    throw new Error("Unsupported native OMP " + name + " schema");
   }
   const parameters = Type.Intersect([fromJsonSchema(native.parameters.toJsonSchema()), thenRunSchema]);
   pi.registerTool({
    name,
    label: name === "edit" ? "Edit" : "Write",
    description: native.description + " Optionally provide then_run to run a shell command after a successful mutation.",
    parameters,
    approval: "exec",
    async execute(_id, input, signal, onUpdate, ctx) {
     const { then_run, ...params } = input as typeof input & { then_run?: ThenRunInput };
     const result = await executeMutationThenRun({
      thenRun: then_run,
      mutate: () => {
       if (!ctx.invokeTool) throw new Error("Native " + name + " delegation unavailable");
       return ctx.invokeTool(params, { signal, onUpdate });
      },
      run: (command, timeout) => pi.exec(
       process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/sh",
       process.platform === "win32" ? ["/d", "/c", command] : ["-c", command],
       { cwd: ctx.cwd, signal, timeout: timeout === undefined ? undefined : timeout * 1000 },
      ),
     });
     if (then_run && result.content.some((part) => part.type === "text" && part.text.includes(THEN_RUN_SUCCEEDED))) {
      showSolOmpSavings(ctx, "Action Fusion", "1 model round-trip avoided");
     }
     return result;
    },
   });
  }
 };
}

export type { ThenRunInput } from "./then-run.ts";
export { executeMutationThenRun, THEN_RUN_FAILED, THEN_RUN_SKIPPED, THEN_RUN_SUCCEEDED } from "./then-run.ts";
export function registerActionFusion(pi: ExtensionAPI): void { createActionFusionExtension()(pi); }
export default registerActionFusion;
