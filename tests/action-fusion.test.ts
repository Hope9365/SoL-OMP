/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { Type, type TSchema } from "@oh-my-pi/omptype/typebox";
import { registerActionFusion } from "../src/sol-omp/extensions/action-fusion/index.ts";
import { FakePi, FakeSessionManager, fakeContext } from "./helpers.ts";

function setup() {
 const pi = new FakePi();
 registerActionFusion(pi.asExtensionApi());
 return pi;
}

describe("Action Fusion native OMP delegation", () => {
 it("accepts native tool schemas from a different omptype instance", () => {
  const pi = new FakePi();
  const native = pi.getAllTools();
  vi.spyOn(pi, "getAllTools").mockReturnValue(native.map((tool) => ({
   ...tool,
   parameters: Object.assign(() => ({}), {
    toJsonSchema: () => (tool.parameters as unknown as TSchema).toJsonSchema(),
   }) as unknown as typeof tool.parameters,
  })));
  registerActionFusion(pi.asExtensionApi());
  expect((pi.tool("write").parameters as unknown as TSchema)
   .safeParse({ path: "a.txt", content: "ok", then_run: { command: "echo ok" } }).success).toBe(true);
 });

 it("accepts input-based edit variants without inventing a path, and leaves plain edits untouched", async () => {
  const pi = setup();
  const native = vi.fn(async () => ({ content: [{ type: "text" as const, text: "original edit result" }] }));
  const context = fakeContext(new FakeSessionManager(), { invokeTool: native });
  const edit = pi.tool("edit");
  expect((edit.parameters as unknown as TSchema).safeParse({ input: "[file#hash]\nPUT 1.=1:\n+fixed", then_run: { command: "echo ok" } }).success).toBe(true);
  const original = await edit.execute("edit-1", { input: "patch data" }, undefined, undefined, context);
  expect(original).toEqual({ content: [{ type: "text", text: "original edit result" }] });
  expect(native).toHaveBeenCalledWith({ input: "patch data" }, expect.any(Object));
 });

 it("runs a command after a successful native write and reports its output", async () => {
  const pi = setup();
  const context = fakeContext(new FakeSessionManager(), {
   cwd: "C:/scratch/sol-omp",
   invokeTool: async () => ({ content: [{ type: "text", text: "wrote file" }] }),
  });
  pi.exec = vi.fn(async () => ({ stdout: "check passed", stderr: "", code: 0, killed: false }));
  const result = await pi.tool("write").execute("write-1", { path: "a.txt", content: "hello", then_run: { command: "echo check passed" } }, undefined, undefined, context);
  expect(result.isError).toBe(false);
  expect(result.content).toEqual([{ type: "text", text: "wrote file" }, { type: "text", text: "[then_run:succeeded]\ncheck passed" }]);
  expect(pi.exec).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ cwd: context.cwd }));
 });

 it("does not run after a failed mutation, and keeps the mutation result on command failure", async () => {
  const pi = setup();
  pi.exec = vi.fn(async () => ({ stdout: "", stderr: "compiler failed", code: 2, killed: false }));
  const failed = fakeContext(new FakeSessionManager(), { invokeTool: async () => ({ content: [{ type: "text", text: "write denied" }], isError: true }) });
  const input = { path: "a.txt", content: "hello", then_run: { command: "compile" } };
  const skipped = await pi.tool("write").execute("write-2", input, undefined, undefined, failed);
  expect(skipped.isError).toBe(true);
  expect(skipped.content).toContainEqual({ type: "text", text: "[then_run:skipped] Native mutation failed" });
  expect(pi.exec).not.toHaveBeenCalled();

  const accepted = fakeContext(new FakeSessionManager(), { invokeTool: async () => ({ content: [{ type: "text", text: "write succeeded" }] }) });
  const result = await pi.tool("write").execute("write-3", input, undefined, undefined, accepted);
  expect(result.isError).toBe(true);
  expect(result.content).toContainEqual({ type: "text", text: "[then_run:failed] exit 2\ncompiler failed" });
  expect(result.content).toContainEqual({ type: "text", text: "write succeeded" });
 });
});
