# Security policy

SoL-OMP runs with its OMP process's filesystem, network and credential permissions. It is **not** a sandbox. Every mechanism is disabled until explicitly enabled in `sol-omp.json`.

- **Action Fusion** delegates mutations to OMP's native tool, then may run a model-requested shell command (`cmd.exe` on Windows, `/bin/sh` elsewhere). Both wrapped tools request execution-level approval, even without `then_run`. Inspect the command before approval. A failed mutation never runs the command; a failed command does not roll back the file change.
- **Observation Pack** saves large results under `<session directory>/sol-omp/<session id>/observation-pack/`; `obs_recall` exposes pages to the current agent. Session history is not edited. On Windows, archive permissions are inherited NTFS ACLs; protect the session directory from other users. Stable symlinks are rejected; filesystem races with a hostile concurrent writer are not fully closed by Node/Bun's Windows APIs.
- **Evidence-Preserving Reducer** archives source logs and may send eligible content to a configured model through OMP credentials. Its likely-secret filter is only a precaution, not data-loss-prevention. Never enable it for logs that must remain local. Invalid hashes, invented quotes, unusable models, model errors, non-smaller receipts and `artifact://`-truncated results pass through unchanged. Archive files persist until the session data is removed.
- **Online Context Compact** writes plans, progress and economics state as custom OMP session entries. Treat them like conversation data. After successful compaction, a generic reminder may trigger another agent turn.

OMP 18.2.11 reports all projects as trusted to extensions, with no project-config trust prompt. Review a project-local `.omp/sol-omp.json` before launching OMP in that directory. Do not store provider tokens or passwords in the config, source tree, command lines or issue reports.

Report vulnerabilities privately via [GitHub Security Advisories](https://github.com/Hope9365/SoL-OMP/security/advisories/new); do not publish exploit details in an issue. Include affected commit, configuration, impact and a minimal reproduction. OMP core vulnerabilities belong in the [OMP upstream repository](https://github.com/can1357/oh-my-pi).
