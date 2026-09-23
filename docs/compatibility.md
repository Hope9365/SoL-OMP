# OMP compatibility

This fork targets **Oh My Pi 18.2.11**. Development dependencies are pinned to this version; a different OMP version requires a fresh typecheck, compatibility check, test run and interactive startup check. The upstream Pi 0.84–0.85 API is **not** supported.

The extension imports public package exports from `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-agent-core`, `@oh-my-pi/pi-ai`, `@oh-my-pi/pi-tui`, `@oh-my-pi/pi-utils` and `@oh-my-pi/omptype`. The package declares OMP-owned packages as peer dependencies and does not patch OMP.

- **Action Fusion:** gets native `edit`/`write` omptype schemas from `pi.getAllTools()` and delegates execution through same-tool `ctx.invokeTool()`. This retains OMP's active edit variant and mutation policy. The wrapper uses `pi.exec()` for the optional follow-up and reports a command failure without discarding a successful mutation. It declares `approval: "exec"` because one call may execute a command.
- **Observation Pack:** rewrites only the public `context` projection. `SessionManager.getSessionFile()` and `getSessionId()` derive persistent archive roots. Without a file-backed session it leaves the original provider messages untouched.
- **Evidence-Preserving Reducer:** handles public `tool_result`; the configured model comes from `ctx.modelRegistry.find()`, with `getApiKey()` and `resolver()` for OMP credentials, then `@oh-my-pi/pi-ai`'s `completeSimple()`. Hash, exact-quote, likely-secret, size and model-response checks fail open. OMP `artifact://` truncation links are preserved instead of being reduced from a partial preview.
- **Online Context Compact:** observes `context`, `before_provider_request`, `turn_end`, `agent_end` and `session_compact` events; uses `ctx.compact()`, OMP session entries and `pi.sendMessage()` for a plan reminder. Compaction does not replace OMP's native summary or use Pi-only `agent_settled` events.

## Verify

From a checkout with Node.js 22.19+ and Bun:

```sh
npm ci --ignore-scripts
npm run check
```

`npm run compat` starts a real ephemeral OMP SDK session and checks registration of all four mechanisms plus native `edit`/`write` schemas; TypeScript guards the extension contracts. Bun executes tests because OMP sources import Bun-native resources. To verify interactive behavior, load `src/sol-omp/index.ts` with the OMP `-e` flag in a trusted session. Do not assume an offline unit suite proves a model's remote credentials or a particular shell is installed.

On Windows, `mode: 0o600` does not represent an NTFS ACL: archives inherit their session directory's ACL. Node/Bun's Windows filesystem lacks `O_NOFOLLOW`; stable symlinks are rejected with `lstat` before and after reading, but an adversary concurrently replacing a path can still race that check. Protect the session directory from untrusted writers.
