/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/sol-omp/config.ts";
import { createSolOmpExtension, registerConfiguredFeatures } from "../src/sol-omp/index.ts";
import { FakePi, fakeContext } from "./helpers.ts";

describe("SoL-OMP entrypoint", () => {
	it("registers no tools or events when every feature is disabled", () => {
		const pi = new FakePi();
		registerConfiguredFeatures(pi.asExtensionApi(), DEFAULT_CONFIG);
		expect(pi.registeredTools).toEqual([]);
		expect(pi.handlers.size).toBe(0);
	});

	it("registers all four standalone mechanisms from one config", () => {
		const pi = new FakePi();
		registerConfiguredFeatures(pi.asExtensionApi(), {
			...DEFAULT_CONFIG,
			actionFusion: true,
			observationPack: true,
			evidencePreservingReducer: true,
			onlineContextCompact: true,
		});

		expect(pi.registeredTools.map((tool) => tool.name)).toEqual(["edit", "write", "obs_recall", "update_plan"]);
		expect([...pi.handlers.keys()].sort()).toEqual([
			"agent_end",
			"before_provider_request",
			"context",
			"input",
			"session_before_tree",
			"session_compact",
			"session_shutdown",
			"session_start",
			"session_tree",
			"tool_result",
			"turn_end",
		]);
	});

	it("waits for a trusted session context and initializes once", async () => {
		const pi = new FakePi();
		const loader = vi.fn(() => ({ ...DEFAULT_CONFIG, observationPack: true }));
		createSolOmpExtension(loader)(pi.asExtensionApi());
		expect([...pi.handlers.keys()]).toEqual(["session_start"]);

		const ctx = fakeContext(pi.sessionManager);
		await pi.emit("session_start", { type: "session_start" }, ctx);
		await pi.emit("session_start", { type: "session_start" }, ctx);

		expect(loader).toHaveBeenCalledOnce();
		expect(pi.registeredTools.map((tool) => tool.name)).toEqual(["obs_recall"]);
		expect([...pi.handlers.keys()].sort()).toEqual(["context", "session_start"]);
	});

});
