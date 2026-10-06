/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const temporaryRoots = new Map<string, string>();

export function runtimeRoot(ctx: ExtensionContext): string {
	const sessionDir = ctx.sessionManager.getSessionDir();
	const sessionId = ctx.sessionManager.getSessionId();
	if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(sessionId)) {
		throw new Error("SoL-OMP requires a safe OMP session id");
	}
	// OMP also assigns a session directory to in-memory sessions; only a session file signals persistence.
	if (ctx.sessionManager.getSessionFile() && sessionDir) return join(sessionDir, "sol-omp", sessionId);

	// --no-session and SDK in-memory sessions still need files for exact recall.
	// Share the root across contexts and mechanisms, without sharing a predictable
	// directory with other processes. Keep files after shutdown for parent workers.
	let root = temporaryRoots.get(sessionId);
	if (!root) {
		root = mkdtempSync(join(tmpdir(), `sol-omp-${sessionId}-`));
		temporaryRoots.set(sessionId, root);
	}
	return root;
}
