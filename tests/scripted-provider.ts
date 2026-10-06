/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import type { ExtensionFactory } from "@oh-my-pi/pi-coding-agent";
import { createMockModel, type MockModelOptions } from "@oh-my-pi/pi-ai/providers/mock";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";

/** Keep scripted state per session, including when OMP copies the registered model. */
export function scriptedProvider(options: MockModelOptions & { provider: string }) {
	const mock = createMockModel(options);
	const model = { ...mock, api: `${options.provider}-api` };
	const extension: ExtensionFactory = (omp) => {
		omp.registerProvider(model.provider, {
			baseUrl: model.baseUrl,
			apiKey: "deterministic-test-key",
			api: model.api,
			models: [model],
			streamSimple: (_model, context, streamOptions) => {
				const stream = new AssistantMessageEventStream();
				void (async () => {
					await streamOptions?.onPayload?.({ messages: context.messages }, model);
					for await (const event of mock.stream(mock, context, streamOptions)) stream.push(event);
					stream.end();
				})().catch((error) => stream.fail(error));
				return stream;
			},
		});
	};
	return { model, extension, calls: mock.calls };
}
