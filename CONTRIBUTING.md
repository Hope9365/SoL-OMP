# Contributing

SoL-OMP is a community fork of [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi). Preserve upstream license headers and attribution. Keep OMP core unmodified; prefer OMP public APIs and a small change at the shared root cause.

1. Explain the observable behavior, security impact and any measured efficiency gain. Do not claim the upstream paper's benchmarks for this fork.
2. Add a regression check only when a plausible bug would fail it. Exercise modified tool/session behavior, not source text or configuration plumbing.
3. Run `npm ci --ignore-scripts` and `npm run check` with Bun and OMP 18.2.11. Include a Windows check when shell commands or filesystem paths change.
4. Update README/configuration/security documentation when behavior changes. Do not commit credentials or session archives.

Commit messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), for example `feat: add OMP observation recall` or `fix: preserve native edit schema`. Use `BREAKING CHANGE:` in the body for incompatible configuration or behavior. Pull requests should link the affected issue and include reproduction plus verification commands.
