/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { createAgentSession, getAgentDir, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { initializeExtensions } from "@oh-my-pi/pi-coding-agent/modes/runtime-init";
import { getBundledModel } from "@oh-my-pi/pi-catalog";
import { completeSimple } from "@oh-my-pi/pi-ai";
import { CONFIG_DIR_NAME } from "@oh-my-pi/pi-utils/dirs";
import { DEFAULT_CONFIG } from "../src/sol-omp/config.ts";
import { createSolOmpExtension } from "../src/sol-omp/index.ts";

for (const [name, value] of Object.entries({
 getAgentDir,
 completeSimple,
 getSessionFile: SessionManager.prototype.getSessionFile,
 getSessionDir: SessionManager.prototype.getSessionDir,
 getSessionId: SessionManager.prototype.getSessionId,
})) {
 if (typeof value !== "function") throw new Error("Missing OMP API: " + name);
}
if (CONFIG_DIR_NAME !== ".omp") throw new Error("Unexpected OMP config directory: " + CONFIG_DIR_NAME);
// Verify the installed OMP runtime, not a made-up JSON Schema approximation.
const { session } = await createAgentSession({
 cwd: process.cwd(),
 sessionManager: SessionManager.inMemory(process.cwd()),
 model: getBundledModel("openai-codex", "gpt-5.6-luna"),
 extensions: [createSolOmpExtension(() => ({ ...DEFAULT_CONFIG,
  actionFusion: true, observationPack: true, evidencePreservingReducer: true, onlineContextCompact: true }))],
 disableExtensionDiscovery: true,
 skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
 enableMCP: false, enableLsp: false,
});
try {
 const errors = [];
 await initializeExtensions(session, {
  reportRuntimeError: (error) => errors.push(error),
  reportSendError: (_action, error) => errors.push(error),
 });
 if (errors.length) throw new Error("OMP extension initialization failed: " + JSON.stringify(errors));
 for (const name of ["edit", "write", "obs_recall", "update_plan"]) {
  const tool = session.getToolByName(name);
  if (!tool) throw new Error("SoL-OMP tool did not register: " + name);
  if (name === "edit" || name === "write") {
   const schema = tool.parameters.toJsonSchema();
   if (schema.type !== "object" || !schema.properties?.then_run ||
       schema.properties?.[name === "edit" ? "input" : "content"] === undefined) {
    throw new Error("Invalid fused native " + name + " schema");
   }
  }
 }
 console.log("OMP public API compatible: all mechanisms registered with native tool schemas");
} finally {
 await session.dispose();
}
