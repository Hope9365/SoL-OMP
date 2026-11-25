# OMP compatibility

This fork targets **Oh My Pi 19.2.0**. Development dependencies are pinned to this version; a different OMP version requires a fresh typecheck, compatibility check, test run and interactive startup check. Upstream Pi is not supported.

The extension imports public package exports from `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-agent-core`, `@oh-my-pi/pi-ai`, `@oh-my-pi/pi-utils` and `@oh-my-pi/omptype`. The package declares OMP-owned packages as peer dependencies and does not patch OMP.

Import `Tokenizer` from the `@oh-my-pi/pi-agent-core` root. The installed OMP 19.0.0 executable exposes the root to extensions, but not the `/tokenizer` subpath; using that subpath pulls in a second copy of OMP packages and can fail on `pi-ai` or `pi-natives`.

OMP 19.2 removed the old TUI `Container` and `Text` classes. SoL-OMP tool renderers return plain rows using the theme provided by the host, with no runtime import from `pi-tui`.

- **Action Fusion:** gets native `edit`/`write` schemas from `pi.getAllTools()` and rebuilds them from JSON Schema before extending them; the OMP executable and a linked checkout have separate `omptype` instances. It delegates execution through same-tool `ctx.invokeTool()`, retaining OMP's active edit variant and mutation policy. The wrapper uses `pi.exec()` for the optional follow-up and reports a command failure without discarding a successful mutation. It declares `approval: "exec"` because one call may execute a command.
- **Observation Pack:** rewrites only the public `context` projection. `SessionManager.getSessionFile()`, `getSessionDir()` and `getSessionId()` select persistent roots; nonpersistent sessions use cached, randomized roots under `tmpdir()`, even when OMP reports a configured session directory. Temporary archives remain readable after session shutdown.
- **Evidence-Preserving Reducer:** handles public `tool_result`; the configured model comes from `ctx.modelRegistry.find()`, with `getApiKey()` and `resolver()` for OMP credentials, then `@oh-my-pi/pi-ai`'s `completeSimple()`. Hash, exact-quote, likely-secret, size and model-response checks fail open. OMP `artifact://` truncation links are preserved instead of being reduced from a partial preview.
- **Online Context Compact:** uses OMP `Tokenizer`, native `findCutPoint()` and canonical session message constructors to price only the removable messages in the latest context projection. Summary identity excludes native rendering metadata; missing, rewritten or ambiguous projection matches prove no savings. It observes `context`, `before_provider_request`, `turn_end`, `agent_end` and `session_compact`. Native `ctx.compact()` owns the abort/idle barrier even when `agent_end` precedes prompt unwind; automatic native continuation is suppressed so OCC sends exactly one outcome-based reminder through `pi.sendMessage()`, without Pi-only `agent_settled` barriers. Plans and unpaid cache debt survive compaction; incomplete-summary and no-op recovery keep the original context. See [configuration](configuration.md) for cooldown and retry gates.

## Verify

From a checkout with Node.js 22.19+ and Bun 1.4.4+:

```sh
npm ci --ignore-scripts
npm run check
```

`npm run compat` starts a real ephemeral OMP SDK session and checks registration of all four mechanisms plus native `edit`/`write` schemas; TypeScript guards the extension contracts. Bun executes tests because OMP sources import Bun-native resources. To verify interactive behavior, load `src/sol-omp/index.ts` with the OMP `-e` flag in a trusted session. Do not assume an offline unit suite proves a model's remote credentials or a particular shell is installed.

SDK integration tests run in child processes so OMP's process-wide watchers exit before Windows temporary directories are deleted. Native-session tests observe the final continuation before awaiting OMP's idle barrier; the CLI check verifies that `--no-session` evidence remains readable after exit.

On Windows, `mode: 0o600` does not represent an NTFS ACL: archives inherit their session directory's ACL. Node/Bun's Windows filesystem lacks `O_NOFOLLOW`; stable symlinks are rejected with `lstat` before and after reading, but an adversary concurrently replacing a path can still race that check. Protect the session directory from untrusted writers.
