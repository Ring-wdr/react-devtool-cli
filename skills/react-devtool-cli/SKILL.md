---
name: react-devtool-cli
description: Operate and troubleshoot the published `rdt` CLI outside the source repo. Use when a user wants help installing `react-devtool-cli`, opening or attaching sessions, checking session status, closing sessions, collecting tree snapshots, inspecting or picking nodes, running profiler flows, exporting profiler data, interpreting `session doctor`, comparing custom vs DevTools-aligned engine output, or understanding CLI trust boundaries. Also use when the user mentions React performance debugging, component tree inspection, or Playwright-based React tooling.
---

# React Devtool CLI

## Overview

Use this skill for installed-CLI workflows used by real end users after distribution. Prefer published `rdt` commands and bundled references; if the task requires changing source code, validating `test-app/`, or editing repository docs, switch to `react-devtool-cli-repo` instead.

Requires Node.js >= 22.

## Start Here

- Read [references/cli-workflows.md](references/cli-workflows.md) before giving commands or interpreting output.
- Confirm whether the user has `rdt` on `PATH` or should use `npx react-devtool-cli`.
- Choose the transport that matches the environment:
  - `session open` for local browser launch.
  - `session connect` for an existing Playwright `wsEndpoint`.
  - `session attach` for an existing Chromium CDP endpoint.

## Default Operator Workflow

1. Confirm how the app is launched and which transport the user can provide.
2. Start or connect a session.
3. Run `session doctor` before deep inspection or helper-based work.
4. Prefer `--engine auto` unless the user explicitly wants to force `custom` or `devtools`.
5. Collect a tree with `tree get` and persist `snapshotId`.
6. Use snapshot-aware node commands with the same `snapshotId`.
7. For interactive selection, use `node pick` to let the user click a component in the browser.
8. Run profiler commands only after a reproducible user interaction is defined.
9. Prefer `primaryUpdateCommitId` or `recommendedCommitIds` over blindly drilling into `commit-1`.
10. Use `profiler export` with `--compress` to save profiler data for later comparison.
11. Use `session status` to check session health and `session close` to clean up when done.

## Command Reference

### Session
- `session open` — Launch a local Playwright-managed browser session
- `session connect` — Connect to a remote Playwright WebSocket endpoint
- `session attach` — Connect to an existing Chromium CDP target
- `session status` — Check current session state
- `session doctor` — Diagnose runtime readiness and trust boundaries
- `session close` — Gracefully close or force-kill a session

### Inspection
- `tree get` — Collect a component tree snapshot (returns `snapshotId`)
- `node search` — Find nodes by display name within a snapshot
- `node inspect` — Inspect a specific node (supports `--commit` for profiler context)
- `node highlight` — Highlight a node in the browser
- `node pick` — Interactively select a node by clicking in the browser
- `source reveal` — Open the source file for a node in the editor

### Interaction
- `interact click` — Click a DOM element by CSS selector
- `interact type` — Type text into an element
- `interact press` — Press a keyboard key
- `interact wait` — Wait for a duration

### Profiler
- `profiler start` — Begin profiling (accepts `--profile-id`)
- `profiler stop` — Stop the current profiling session
- `profiler summary` — Get commit count, node ranges, measurement modes
- `profiler commits` — List all captured commits
- `profiler commit` — Detailed analysis for a specific commit
- `profiler ranked` — Ranked component analysis (accepts `--limit`)
- `profiler flamegraph` — Flamegraph visualization for a commit
- `profiler compare` — Compare two profiles by id or exported file path
- `profiler export` — Export profiler events as NDJSON (accepts `--output`, `--compress`)

## Interpretation Rules

- Persist `snapshotId` from `tree get` and reuse it for `node search`, `node inspect`, `node highlight`, and `source reveal`.
- If `snapshot-expired` appears, recollect the tree and do not reuse old node ids.
- Read `observationLevel`, `limitations`, and `runtimeWarnings` literally.
- Read `selectedEngine`, `engineFallback`, and `devtoolsCapabilities` literally before making profiler claims.
- Read `commitKind`, `isLikelyInitialMount`, `isInteractionCandidate`, `primaryUpdateCommitId`, and `recommendedCommitIds` literally before choosing a profiler commit to inspect.
- Read `observedReasons`, `inferredReasons`, and `reasonConfidence` literally in commit/ranked/flamegraph output.
- Treat `node inspect --commit <commitId>` ids as profiler-local ids, not tree snapshot ids.
- Prefer built-in `interact` commands over ad hoc Playwright helpers when `session doctor` reports support.

## Escalate to the Repo Skill

- Use `react-devtool-cli-repo` when the task requires source edits, `npm test`, `npm run build`, `test-app/`, packaging checks, or runtime semantics changes in this repository.
