/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createAgentSession, SessionManager, Settings, type AgentSession } from "@oh-my-pi/pi-coding-agent";
import { initializeExtensions } from "@oh-my-pi/pi-coding-agent/modes/runtime-init";
import { CONFIG_DIR_NAME } from "@oh-my-pi/pi-utils/dirs";
import { expect, it } from "vitest";
import { DEFAULT_CONFIG, loadSolOmpConfig } from "../src/sol-omp/config.ts";
import { createSolOmpExtension } from "../src/sol-omp/index.ts";
import { scriptedProvider } from "./scripted-provider.ts";
import { isolatedOmpTest } from "./isolated-omp.ts";

const ALL_ENABLED = {
	...DEFAULT_CONFIG,
	actionFusion: true,
	observationPack: true,
	evidencePreservingReducer: true,
	onlineContextCompact: true,
};
const packagePath = fileURLToPath(new URL("../src/sol-omp/index.ts", import.meta.url));

it.each(["persistent", "in-memory"])("loads the package and executes native fused writes in an all-enabled %s OMP session", async (storage) => {
	await isolatedOmpTest(fileURLToPath(import.meta.url), `all-enabled ${storage} OMP session`, async (cwd) => {
	const agentDir = join(cwd, "agent");
	let session: AgentSession | undefined;
	let ephemeralSessionId: string | undefined;
	try {
		await mkdir(agentDir);
		await mkdir(join(cwd, CONFIG_DIR_NAME));
		await writeFile(join(cwd, CONFIG_DIR_NAME, "sol-omp.json"), JSON.stringify(ALL_ENABLED));
		const provider = scriptedProvider({
			provider: `sol-omp-package-${storage}`,
			responses: [
				{ content: [{ type: "toolCall", name: "write", arguments: {
					path: "result.txt", content: "package integration passed\n",
					then_run: { command: process.platform === "win32" ? "copy /y result.txt verified.txt" : "cp result.txt verified.txt" },
				} }] },
				{ content: [{ type: "toolCall", name: "update_plan", arguments: {
					steps: [{ id: "verify", goal: "verify the package", status: "in_progress" }],
				} }] },
				{ content: ["package smoke complete"] },
			],
		});
		const sessionManager = storage === "persistent"
			? SessionManager.create(cwd, join(agentDir, "sessions"))
			: SessionManager.inMemory(cwd);
		if (storage === "in-memory") ephemeralSessionId = sessionManager.getSessionId();
		({ session } = await createAgentSession({
			cwd, agentDir, sessionManager,
			model: provider.model, thinkingLevel: "off",
			settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false, "title.refreshOnReplan": false }),
			extensions: [provider.extension, createSolOmpExtension(() => loadSolOmpConfig(cwd, agentDir, true))],
			disableExtensionDiscovery: true, preloadedCustomToolPaths: [],
			skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
			enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true,
			requireYieldTool: false, autoApprove: true,
			systemPrompt: "You are a deterministic package integration test assistant.",
		}));
		await sessionManager.setSessionName("Package integration", "user");
		const errors: unknown[] = [];
		await initializeExtensions(session, {
			reportSendError: (_action, error) => errors.push(error),
			reportRuntimeError: (error) => errors.push(error),
		});
		await session.prompt("run the package smoke test", { expandPromptTemplates: false });
		await session.waitForIdle();
		const toolResults = sessionManager.getBranch().flatMap((entry) =>
			entry.type === "message" && entry.message.role === "toolResult" ? [entry.message] : [],
		);
		expect(toolResults).toHaveLength(2);
		expect(toolResults.every((result) => !result.isError)).toBe(true);
		expect(await readFile(join(cwd, "result.txt"), "utf8")).toBe("package integration passed\n");
		// This second file proves the fused shell command actually ran after the native mutation.
		expect(await readFile(join(cwd, "verified.txt"), "utf8")).toBe("package integration passed\n");
		expect(session.getLastAssistantText()).toBe("package smoke complete");
		expect(session.isStreaming).toBe(false);
		expect(provider.calls).toHaveLength(3);
		expect(errors).toEqual([]);
	} finally {
		await session?.dispose();
		if (ephemeralSessionId) {
			const roots = (await readdir(tmpdir())).filter((name) => name.startsWith(`sol-omp-${ephemeralSessionId}-`));
			await Promise.all(roots.map((name) => rm(join(tmpdir(), name), { recursive: true, force: true })));
		}
	}
	});
}, 30_000);

it("archives tool output with the real OMP --no-session CLI and retains it after exit", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "sol-omp-no-session-"));
	try {
		const agentDir = join(cwd, "agent");
		const temporaryDir = join(cwd, "tmp");
		await mkdir(agentDir);
		await mkdir(temporaryDir);
		await writeFile(join(agentDir, "sol-omp.json"), JSON.stringify(ALL_ENABLED));
		await writeFile(join(agentDir, "config.yml"), "compaction:\n  enabled: false\nretry:\n  enabled: false\nmemory:\n  backend: off\n");
		// A single raw line avoids native read's preview pagination and stays below its byte cap.
		const body = "ephemeral CLI evidence ".repeat(800) + "\n";
		await writeFile(join(cwd, "evidence.txt"), body);
		const providerPath = join(cwd, "test-provider.ts");
		const helperPath = fileURLToPath(new URL("./scripted-provider.ts", import.meta.url));
		await writeFile(providerPath, `
import { scriptedProvider } from ${JSON.stringify(helperPath)};
export default function (omp) {
	const provider = scriptedProvider({
		provider: "sol-omp-no-session-test", id: "ephemeral", contextWindow: 200000, maxTokens: 4096,
		responses: [
			{ content: [{ type: "toolCall", name: "read", arguments: { path: ${JSON.stringify(join(cwd, "evidence.txt") + ":raw")} } }] },
			{ content: [{ type: "toolCall", name: "read", arguments: { path: ${JSON.stringify(providerPath)} } }] },
			{ content: [{ type: "toolCall", name: "read", arguments: { path: ${JSON.stringify(join(agentDir, "config.yml"))} } }] },
			{ content: ["no-session smoke complete"] },
		],
	});
	provider.extension(omp);
	omp.on("session_start", async (_event, ctx) => {
		if (ctx.sessionManager.getSessionFile()) throw new Error("Expected an ephemeral CLI session");
		const model = ctx.modelRegistry.find(provider.model.provider, provider.model.id);
		if (!model || !await omp.setModel(model)) throw new Error("Local scripted provider unavailable");
	});
}
`);
		const ompSource = dirname(fileURLToPath(import.meta.resolve("@oh-my-pi/pi-coding-agent")));
		const running = promisify(execFile)(process.execPath, [
			join(ompSource, "../dist/cli.js"), "--auto-approve", "--no-session",
			"--mode", "json",
			"--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-title", "--no-pty",
			"-e", packagePath, "-e", providerPath,
			"--provider", "openai", "--model", "gpt-4o-mini",
			"--thinking", "off", "-p", "read the evidence",
		], {
			cwd,
			env: {
				...process.env,
				HOME: cwd, USERPROFILE: cwd,
				XDG_CONFIG_HOME: cwd, XDG_DATA_HOME: cwd, XDG_STATE_HOME: cwd, XDG_CACHE_HOME: cwd,
				PI_TEST_RUNTIME: "1",
				PI_CODING_AGENT_DIR: agentDir,
				OMP_PROFILE: "", PI_PROFILE: "", PI_CONFIG_FILES: "",
				TMPDIR: temporaryDir, TMP: temporaryDir, TEMP: temporaryDir,
			},
			timeout: 20_000,
		});
		running.child.stdin?.end();
		const { stdout } = await running;
		expect(stdout).toContain("no-session smoke complete");
		const roots = (await readdir(temporaryDir)).filter((name) => name.startsWith("sol-omp-"));
		expect(roots).toHaveLength(1);
		const objectsDir = join(temporaryDir, roots[0]!, "observation-pack", "objects");
		const objects = await readdir(objectsDir);
		expect(objects).toHaveLength(1);
		expect(await readFile(join(objectsDir, objects[0]!), "utf8")).toBe(body);
		expect((await readdir(agentDir, { recursive: true })).some((name) => name.endsWith(".jsonl"))).toBe(false);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}, 30_000);
