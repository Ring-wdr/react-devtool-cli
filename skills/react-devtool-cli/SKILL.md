---
name: react-devtool-cli
description: Maintain and validate the `react-devtool-cli` (`rdt`) repository. Use when working inside this repo to run tests, launch `test-app`, validate `session open|connect|attach|doctor`, inspect snapshot-aware node workflows, exercise profiler commit analysis, or prepare npm packaging and publish checks.
---

# React Devtool CLI

## Overview

Use this skill to run and validate the `rdt` repository safely and consistently. Prefer repo-local commands (`node bin/rdt.js ...`) over any globally installed `rdt` so the checked-out source stays authoritative.

## Default Workflow

1. Read [README.md](/Users/kimmanjoong/private-project/rdt-cli/README.md) for current command semantics.
2. Read [docs/devtools-concept-mapping.md](/Users/kimmanjoong/private-project/rdt-cli/docs/devtools-concept-mapping.md) before changing payload semantics or profiler terminology.
3. Run `npm test` before and after code changes.
4. Treat [`test-app`](/Users/kimmanjoong/private-project/rdt-cli/test-app) as the default local validation target.
5. Keep user-owned working tree changes out of commits unless explicitly requested.

## Run the Repo

- Run CLI commands from the repo root:

```bash
node bin/rdt.js --help
node bin/rdt.js session doctor --session app
```

- Start the local React target from [`test-app`](/Users/kimmanjoong/private-project/rdt-cli/test-app):

```bash
cd test-app
npm run dev -- --host 127.0.0.1 --port 3000
```

- Open a local Playwright-managed session from the repo root:

```bash
node bin/rdt.js session open --url http://127.0.0.1:3000 --session app --timeout 10000
```

- Use `session attach` only when an external Chromium with CDP is already running.

## Validate Snapshot Workflows

1. Start with `tree get`.
2. Persist the returned `snapshotId`.
3. Pass `--snapshot <id>` to `node search`, `node inspect`, `node highlight`, and `source reveal`.
4. If `snapshot-expired` appears, collect a fresh tree and do not reuse old node IDs.

Example:

```bash
node bin/rdt.js tree get --session app
node bin/rdt.js node search SlowSearchDemo --session app --snapshot <snapshotId>
node bin/rdt.js node inspect <nodeId> --session app --snapshot <snapshotId>
```

## Validate Profiler Workflows

- Use the profiler against [`test-app`](/Users/kimmanjoong/private-project/rdt-cli/test-app), especially `SlowSearchDemo`, `ResultList`, and `ResultRow`.
- Treat profiler output as commit-oriented analysis with explicit limitations.
- Use the newer drill-down commands for commit analysis:

```bash
node bin/rdt.js profiler start --session app
node bin/rdt.js profiler stop --session app
node bin/rdt.js profiler summary --session app
node bin/rdt.js profiler commits --session app
node bin/rdt.js profiler commit <commitId> --session app
node bin/rdt.js profiler ranked <commitId> --session app --limit 10
node bin/rdt.js profiler flamegraph <commitId> --session app
node bin/rdt.js node inspect <nodeId> --session app --commit <commitId>
```

- Read `measurementMode`, `measuresComponentDuration`, `limitations`, and `runtimeWarnings` literally.
- Treat rerender reasons as snapshot-diff inference, not changed-fiber truth.
- Treat `node inspect --commit` node IDs as commit-local profiler IDs, not general tree snapshot IDs.

## Use Doctor Before Complex Validation

- Run `node bin/rdt.js session doctor --session <name>` before relying on helper scripts or profiler conclusions.
- Use `helperImportTarget` from doctor instead of reading internal installed files to find Playwright.
- Expect standalone `/tmp/*.mjs` helper scripts to fail bare `import('playwright')` even when `rdt` itself works.

## Package and Publish Checks

- Build publish artifacts with `npm run build`.
- Confirm packaging with:

```bash
npm pack --dry-run
npm publish --dry-run
```

- Expect npm packages to ship `dist/` plus required metadata only, not repo-only docs, `test-app`, or handoff artifacts.

## References

- Read [TASK.md](/Users/kimmanjoong/private-project/rdt-cli/TASK.md) only for session handoff or unresolved local work.
- Read [README.md](/Users/kimmanjoong/private-project/rdt-cli/README.md) for current command examples and trust-boundary guidance.
- Read [docs/devtools-concept-mapping.md](/Users/kimmanjoong/private-project/rdt-cli/docs/devtools-concept-mapping.md) before renaming or reinterpreting profiler fields.
