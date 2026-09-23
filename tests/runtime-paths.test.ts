/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { join } from "node:path";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { runtimeRoot } from "../src/sol-omp/runtime-paths.ts";

function context(sessionDir: string, sessionId: string): ExtensionContext {
	return {
		sessionManager: {
			getSessionDir: () => sessionDir,
			getSessionFile: () => join(sessionDir, "session.jsonl"),
			getSessionId: () => sessionId,
		},
	} as unknown as ExtensionContext;
}

describe("SoL-OMP runtime root", () => {
	it("gives each OMP session its own directory", () => {
		const sessionDir = join("sessions", "project-a");
		expect(runtimeRoot(context(sessionDir, "session-a"))).toBe(join(sessionDir, "sol-omp", "session-a"));
		expect(runtimeRoot(context(sessionDir, "session-b"))).toBe(join(sessionDir, "sol-omp", "session-b"));
	});

	it("rejects in-memory sessions without persistence", () => {
		const ctx = context("sessions", "valid");
		ctx.sessionManager.getSessionFile = () => undefined;
		expect(() => runtimeRoot(ctx)).toThrow("persistent OMP session");
	});

	it.each(["", ".", "..", "../escape", "nested/session", "nested\\session"])(
		"rejects unsafe session id %j",
		(sessionId) => {
			expect(() => runtimeRoot(context("sessions", sessionId))).toThrow("safe OMP session id");
		},
	);
});
