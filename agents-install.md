# SoL-OMP installation and validation

Read this file before changing an installation. Respect explicit user instructions and existing project changes. Never print credentials, patch OMP internals, or silently ignore failed checks.

## Source checkout

Require Node.js 22.19+, Bun and OMP 18.2.11. From the SoL-OMP checkout:

```sh
npm ci --ignore-scripts
npm run check
omp --version
```

`npm run check` typechecks, verifies public API imports, runs Bun tests, and inspects package contents. Use OMP's version output; do not infer compatibility from a Pi installation. Never copy provider secrets into `sol-omp.json`.

## Install scope

The published GitHub source is `github:Hope9365/SoL-OMP`. In a trusted target project, choose **one** scope:

```sh
omp plugin install github:Hope9365/SoL-OMP --scope=project
omp plugin list
```

To install for the current user rather than the project, use `--scope=user`. For a development checkout, use `omp plugin link /absolute/path/to/SoL-OMP --scope=project` or load the extension once with OMP's `-e /absolute/path/to/SoL-OMP/src/sol-omp/index.ts` flag. Do not install an unpublished GitHub URL before creating the repository. Do not register the same checkout twice.

## Select features

All four mechanisms are disabled by default. Copy `sol-omp.example.json` to a single effective configuration location:

- trusted project: `<target project>/.omp/sol-omp.json`;
- user: `<OMP agent directory>/sol-omp.json` (`~/.omp/agent/` by default).

The project file wins and replaces the user file; they are not merged. Enable only mechanisms explicitly requested. Action Fusion wraps mutation tools with execution-level approval. Observation Pack writes sensitive outputs to the session directory. Evidence-Preserving Reducer sends eligible logs to a configured remote model. Online Context Compact may interrupt a turn and continue after compaction. Review [SECURITY.md](SECURITY.md) before enabling any of them.

To require an all-enabled profile, edit the four flags to `true` and run:

```sh
node scripts/check-sol-omp-config.mjs --config /absolute/path/to/sol-omp.json --require-all-enabled
```

For any partial profile, omit `--require-all-enabled`. Run `omp plugin list`, start OMP with the intended profile, and confirm the extension loads without errors. Do not claim remote reducer authentication or compaction continuity was verified unless each path was exercised.

## Report

Record the checkout path and commit, OMP version, exact install scope, effective config path and enabled flags, checks executed and their results. Exclude credentials and archived logs from the report.
