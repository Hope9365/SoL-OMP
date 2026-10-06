/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

/** OMP owns process-wide watchers; release them before deleting a Windows test directory. */
export async function isolatedOmpTest(file: string, name: string, run: (cwd: string) => Promise<void>): Promise<void> {
	const childRoot = process.env.SOL_OMP_TEST_ROOT;
	if (childRoot) return run(childRoot);
	const cwd = await mkdtemp(join(tmpdir(), "sol-omp-integration-"));
	try {
		await promisify(execFile)(process.execPath, ["test", file, "--test-name-pattern", name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")], {
			env: { ...process.env, SOL_OMP_TEST_ROOT: cwd, PI_TEST_RUNTIME: "1" },
			timeout: 15_000,
		});
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}
