/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { join } from "node:path";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export function runtimeRoot(ctx: ExtensionContext): string {
	const sessionDir = ctx.sessionManager.getSessionDir();
	if (!ctx.sessionManager.getSessionFile() || !sessionDir) {
		throw new Error("SoL-OMP requires a persistent OMP session directory");
	}
	const sessionId = ctx.sessionManager.getSessionId();
	if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(sessionId)) {
		throw new Error("SoL-OMP requires a safe OMP session id");
	}
	return join(sessionDir, "sol-omp", sessionId);
}
