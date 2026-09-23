# Configuration

SoL-OMP reads one JSON file at OMP session startup. Search order:

1. `<working directory>/.omp/sol-omp.json` (OMP 18.2.11 reports all projects as trusted to extensions);
2. `<OMP agent directory>/sol-omp.json` (`~/.omp/agent/sol-omp.json` by default);
3. built-in defaults.

OMP 18.2.11 does not show a trust prompt before accepting this project file. Review cloned projects before starting OMP. The project file replaces the global file; values are not merged. `OMP`'s `getAgentDir()` and `CONFIG_DIR_NAME` determine the real directories.

```json
{
  "version": 1,
  "actionFusion": false,
  "observationPack": false,
  "evidencePreservingReducer": false,
  "evidencePreservingReducerProvider": "openai-codex",
  "evidencePreservingReducerModel": "gpt-5.6-luna",
  "onlineContextCompact": false,
  "cacheWriteReadRatio": 12.5
}
```

`version` must be `1`. The four feature flags default to `false` and must be booleans. Provider/model IDs must be nonempty strings when present. `cacheWriteReadRatio` defaults to `12.5` and must be finite and nonnegative; `0` means no cache-write premium. Unknown keys and invalid JSON fail extension initialization instead of silently enabling features.

`sol-omp.example.json` is a template, not a file read automatically. Edit the two placeholder model IDs only when choosing a different reducer route. Preflight a chosen file before enabling everything:

```sh
node scripts/check-sol-omp-config.mjs --config /absolute/path/to/sol-omp.json --require-all-enabled
```

Omit `--require-all-enabled` for a partial profile. The script checks the file, not OMP project trust or credentials.

## Feature details

- **Action Fusion:** OMP native `edit`/`write` plus optional `then_run` (`command`, optional `timeout` in seconds). Commands use `cmd.exe` on Windows and `/bin/sh` on POSIX. The wrapper requests execution-level approval even for a mutation without a follow-up command.
- **Observation Pack:** stores eligible text results in content-addressed files and emits `obs_recall` for exact byte-offset pages. It leaves nonpersistent sessions unchanged.
- **Evidence-Preserving Reducer:** stores diagnostic sources locally, calls the configured model with OMP-managed authentication, verifies its receipt, and otherwise returns the original result. No credential, provider URL, storage path or extra reducer fallback is configured here. OMP artifact-backed truncated results are not reduced.
- **Online Context Compact:** `update_plan` records completed-step boundaries and estimates cache debt/window pressure using the configured ratio. Plan and estimate state go into OMP's session log; native OMP compaction produces the actual summary.

Project config can enable shell execution and remote transmission of logs. Review a project and its config before trusting it. Session archive files may outlive the process; treat them as sensitive. See [SECURITY.md](../SECURITY.md).
