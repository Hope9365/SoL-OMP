# Third-party notices

## Original SoL-Pi work

SoL-OMP forks [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi). Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. The upstream code and documentation are licensed under MIT; their copyright headers and the original [LICENSE](LICENSE) are retained. This fork is independent of NVIDIA.

## OMP packages

`@oh-my-pi/pi-agent-core`, `@oh-my-pi/pi-ai`, `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-tui`, `@oh-my-pi/pi-utils` and `@oh-my-pi/omptype` are provided by the [Oh My Pi](https://github.com/can1357/oh-my-pi) runtime and retain their own MIT licenses. Development uses 18.2.11; `@oh-my-pi/pi-catalog` is used by test fixtures. No OMP source is copied into this package.

Development-only `@types/node` (MIT), TypeScript (Apache-2.0), and Vitest (MIT) remain under their own licenses. See `package-lock.json` for exact versions and transitive dependencies. Bun runs the tests; no third-party source is bundled into the repository's npm tarball.
