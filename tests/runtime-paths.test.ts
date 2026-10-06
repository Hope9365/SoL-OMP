/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionManager, type ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { runtimeRoot } from "../src/sol-omp/runtime-paths.ts";

const temporaryRoots = new Set<string>();

afterEach(() => {
	for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
	temporaryRoots.clear();
});

function context(sessionDir: string, sessionId: string, persistent = true): ExtensionContext {
	return {
		sessionManager: {
			getSessionDir: () => sessionDir,
			getSessionFile: () => persistent ? join(sessionDir, "session.jsonl") : undefined,
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

	it.each(["", "sessions"])("uses a temporary root without persistence even with session directory %j", (sessionDir) => {
		const manager = SessionManager.inMemory();
		const root = runtimeRoot(context(sessionDir, manager.getSessionId(), false));
		temporaryRoots.add(root);
		expect(dirname(root)).toBe(tmpdir());
		expect(statSync(root).isDirectory()).toBe(true);
	});

	it("keeps one private temporary directory per in-memory session across contexts", async () => {
		const manager = SessionManager.inMemory();
		expect(manager.getSessionFile()).toBeUndefined();
		const root = runtimeRoot(context(manager.getSessionDir(), manager.getSessionId(), false));
		temporaryRoots.add(root);
		expect(dirname(root)).toBe(tmpdir());
		expect(statSync(root).isDirectory()).toBe(true);
		if (process.platform !== "win32") expect(statSync(root).mode & 0o777).toBe(0o700);
		expect(runtimeRoot(context("another-session-directory", manager.getSessionId(), false))).toBe(root);

		await manager.newSession();
		const nextRoot = runtimeRoot(context(manager.getSessionDir(), manager.getSessionId(), false));
		temporaryRoots.add(nextRoot);
		expect(nextRoot).not.toBe(root);
		expect(statSync(root).isDirectory()).toBe(true);
	});

	it("isolates concurrent in-memory workers in the same working directory", () => {
		const workers = [SessionManager.inMemory(), SessionManager.inMemory()];
		const roots = workers.map((worker) => {
			const root = runtimeRoot(context(worker.getSessionDir(), worker.getSessionId(), false));
			temporaryRoots.add(root);
			return root;
		});
		expect(roots[0]).not.toBe(roots[1]);
	});

	it.each(["", ".", "..", "../escape", "nested/session", "nested\\session"])(
		"rejects unsafe session id %j",
		(sessionId) => {
			expect(() => runtimeRoot(context("sessions", sessionId))).toThrow("safe OMP session id");
			expect(() => runtimeRoot(context("sessions", sessionId, false))).toThrow("safe OMP session id");
			expect(() => runtimeRoot(context("", sessionId, false))).toThrow("safe OMP session id");
		},
	);
});
