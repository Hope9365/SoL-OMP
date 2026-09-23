# SoL-OMP

**Four opt-in efficiency extensions for [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi).**

[![CI](https://github.com/Hope9365/SoL-OMP/actions/workflows/ci.yml/badge.svg)](https://github.com/Hope9365/SoL-OMP/actions/workflows/ci.yml) · [Configuration](docs/configuration.md) · [Compatibility](docs/compatibility.md) · [Security](SECURITY.md) · [License](LICENSE)

SoL-OMP adapts the [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) research extension to OMP's native tool and session APIs. It is an independent community fork, not an official NVIDIA or OMP release. The original authors' copyright and MIT license are retained.

| Mechanism | Effect | Boundary |
|---|---|---|
| **Action Fusion** | `edit`/`write` can execute an optional `then_run` command in the same tool call. | Native OMP edit modes and write implementation handle mutations; commands never run after a failed mutation. |
| **Observation Pack** | Large repeated text observations become small placeholders with exact paged `obs_recall`. | Session history stays unchanged; archives remain on disk in persistent sessions. |
| **Evidence-Preserving Reducer** | Long diagnostic output may become a compact receipt with source hash and verbatim quotes. | Opt-in remote model call; uncertain, invalid, secret-looking, or artifact-truncated output passes through unchanged. |
| **Online Context Compact** | Completed `update_plan` steps can trigger economical native compaction and a continuation reminder. | OMP owns the summary; the mechanism retains plan state in the session log. |

**Nothing is enabled by installing the package.** Each feature is `false` until explicitly selected in `sol-omp.json`.

## Install

Requires OMP **18.2.11**, Bun (OMP's runtime), Node.js **22.19+** and npm for development checks. Use a trusted project; do not install an unreviewed extension into a privileged agent.

From the project that will run OMP:

```sh
omp plugin install github:Hope9365/SoL-OMP --scope=project
omp plugin list
```

For a local checkout without installing a plugin, start OMP with `-e /absolute/path/to/SoL-OMP/src/sol-omp/index.ts`. See the [agent installation protocol](agents-install.md) for source checks, preflight, and installation scope. Do not use Pi's `pi install` or its `.pi/` configuration.

## Configure

Create `.omp/sol-omp.json` in a **trusted** project, or `sol-omp.json` in the OMP agent directory (`~/.omp/agent/` by default). The project file takes precedence; files are not merged. A minimal local-only profile:

```json
{
  "version": 1,
  "actionFusion": true,
  "observationPack": true,
  "evidencePreservingReducer": false,
  "onlineContextCompact": false
}
```

Action Fusion adds `then_run: { "command": "npm test", "timeout": 60 }` to OMP's native `edit`/`write` arguments. On Windows the follow-up uses `cmd.exe`; on POSIX it uses `/bin/sh`. The extension requests execution-level approval for both wrapped tools, including calls without `then_run`. Check commands before approving them.

The reducer's defaults are `openai-codex/gpt-5.6-luna`; enabling it requires an available model and OMP-managed credentials. It sends eligible log content to that model. To select another provider/model, configure `evidencePreservingReducerProvider` and `evidencePreservingReducerModel`. See [configuration](docs/configuration.md) and [security](SECURITY.md) first. No credential belongs in this repository or JSON file.

## Development

```sh
npm ci --ignore-scripts
npm run check
```

`check` runs TypeScript checking, public OMP API checks, Bun tests, and a package dry-run. The lockfile pins OMP 18.2.11 for development; no OMP source tree is vendored. Tests do not require a remote model. Pull requests use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/); see [CONTRIBUTING.md](CONTRIBUTING.md).

## Storage and attribution

Archives live under `<OMP session directory>/sol-omp/<session id>/`; they may contain sensitive output and persist until deleted with the session. In-memory sessions leave large observations and logs untouched. OMP's own artifact-backed truncated outputs are not reduced. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the upstream work and dependency licenses.

Original research: [SoL-Pi](https://github.com/NVlabs/SoL-Pi) by NVIDIA, MIT-licensed. This fork does not claim its published benchmarks or maintenance commitments.
