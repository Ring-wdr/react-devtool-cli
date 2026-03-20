---
name: react-devtool-cli-repo
description: Maintain and validate the `react-devtool-cli` repository. Use when working inside this repo to change source, run tests, validate `test-app` browser flows, inspect snapshot-aware node commands, use interactive node picking, verify profiler behavior and export workflows, confirm package contents, or align runtime field semantics with the bundled repo references. Also use when debugging test failures, checking engine selection logic, or reviewing session lifecycle implementation.
---

# React Devtool CLI Repo

## Overview

Use this skill for repository maintenance and validation. Treat the skill bundle as self-contained: locate the repo root dynamically, prefer bundled references over project-root docs, and run repo-local commands so the checked-out source stays authoritative.

## Locate the Repo

- Confirm the repo root by checking for `package.json` with name `react-devtool-cli`, `bin/rdt.js`, and `test-app/`.
- Run repository commands from that root.
- Prefer `node bin/rdt.js ...` over a globally installed `rdt`.

## Load References Deliberately

- Read [references/repo-workflows.md](references/repo-workflows.md) before changing commands, tests, or packaging.
- Read [references/runtime-semantics.md](references/runtime-semantics.md) before renaming payload fields, changing profiler wording, or reinterpreting trust-boundary metadata.
- Use `react-devtool-cli` instead when the task is about operating an installed CLI rather than editing this repository.

## Default Workflow

1. Locate the repo root and inspect local changes before editing.
2. Read the bundled references that match the task.
3. Run `npm test` before and after behavior changes.
4. Treat `test-app/` as the default browser-backed validation target.
5. Run `node bin/rdt.js session doctor --session <name>` before profiler-heavy or helper-heavy validation.
6. Prefer built-in `interact` commands before ad hoc Playwright helper scripts.
7. Use `session status` to check session health and `session close` to clean up sessions.
8. Keep user-owned working tree changes out of commits unless explicitly requested.

## Core Repo Commands

- Run CLI commands from the repo root:

```bash
node bin/rdt.js --help
node bin/rdt.js session doctor --session app
node bin/rdt.js session status --session app
node bin/rdt.js session close --session app
node bin/rdt.js interact wait --session app --ms 250
```

- Start the local React target from `test-app/`:

```bash
cd test-app
npm run dev -- --host 127.0.0.1 --port 3000
```

- Open a local Playwright-managed session from the repo root:

```bash
node bin/rdt.js session open --url http://127.0.0.1:3000 --session app --timeout 10000
```

- Advanced session open options: `--browser`, `--engine`, `--channel`, `--device`, `--storage-state`, `--user-data-dir`, `--headless=false`.
- Use `session attach` only when an external Chromium with CDP is already running.

## Validate Snapshot Workflows

- Start with `tree get`.
- Persist the returned `snapshotId`.
- Pass `--snapshot <id>` to `node search`, `node inspect`, `node highlight`, and `source reveal`.
- If `snapshot-expired` appears, collect a fresh tree and do not reuse old node ids.
- Use `node pick` for interactive browser-based node selection (30s default timeout).

Example:

```bash
node bin/rdt.js tree get --session app
node bin/rdt.js node search SlowSearchDemo --session app --snapshot <snapshotId>
node bin/rdt.js node inspect <nodeId> --session app --snapshot <snapshotId>
node bin/rdt.js node pick --session app --timeout-ms 30000
```

## Validate Profiler Workflows

- Use the profiler against `test-app/`, especially `SlowSearchDemo`, `ResultList`, and `ResultRow`.
- Treat profiler output as commit-oriented analysis with explicit limitations.
- Use the drill-down commands for commit analysis:

```bash
node bin/rdt.js profiler start --session app [--profile-id <id>]
node bin/rdt.js profiler stop --session app
node bin/rdt.js profiler summary --session app
node bin/rdt.js profiler commits --session app
node bin/rdt.js profiler commit <commitId> --session app
node bin/rdt.js profiler ranked <commitId> --session app --limit 10
node bin/rdt.js profiler flamegraph <commitId> --session app
node bin/rdt.js profiler compare --session app --left baseline --right candidate
node bin/rdt.js profiler export --session app [--output file.jsonl] [--compress]
node bin/rdt.js node inspect <nodeId> --session app --commit <commitId>
```

- Read `measurementMode`, `measuresComponentDuration`, `limitations`, and `runtimeWarnings` literally.
- Treat rerender reasons as snapshot-diff inference, not changed-fiber truth.
- Treat `node inspect --commit` node ids as commit-local profiler ids, not general tree snapshot ids.
- `flamegraph` and `export` do not support `--format yaml`.
- Exported `.jsonl` / `.jsonl.gz` files can be used as inputs to `profiler compare`.

## Prefer Built-in Interact Commands

- Use `interact click`, `interact type`, `interact press`, and `interact wait` before ad hoc helper scripts.
- All interact commands accept optional `--timeout-ms <ms>` for element location timeout.
- Keep selectors deterministic and CSS-based.
- Use `session doctor` to confirm `supportsBuiltInInteract` before relying on interaction replay.

## Package and Publish Checks

- Build publish artifacts with `npm run build`.
- Confirm packaging with:

```bash
npm pack --dry-run
npm publish --dry-run
```

- Expect npm packages to ship `dist/` plus required metadata only, not repo-only docs, `test-app/`, or handoff artifacts.

## References

- Read [references/repo-workflows.md](references/repo-workflows.md) for repo commands, validation lanes, and packaging checks.
- Read [references/runtime-semantics.md](references/runtime-semantics.md) before changing runtime terminology or profiler semantics.
