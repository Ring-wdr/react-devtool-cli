---
name: react-devtool-cli
description: Operate and troubleshoot the published `rdt` CLI outside the source repo. Use when a user wants help installing `react-devtool-cli`, opening or attaching sessions, collecting tree snapshots, inspecting nodes, running profiler flows, interpreting `session doctor`, comparing custom vs DevTools-aligned engine output, or understanding CLI trust boundaries.
---

# React Devtool CLI

## Overview

Use this skill for installed-CLI workflows used by real end users after distribution. Prefer published `rdt` commands and bundled references; if the task requires changing source code, validating `test-app/`, or editing repository docs, switch to `react-devtool-cli-repo` instead.

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
7. Run profiler commands only after a reproducible user interaction is defined.

## Interpretation Rules

- Persist `snapshotId` from `tree get` and reuse it for `node search`, `node inspect`, `node highlight`, and `source reveal`.
- If `snapshot-expired` appears, recollect the tree and do not reuse old node ids.
- Read `observationLevel`, `limitations`, and `runtimeWarnings` literally.
- Read `selectedEngine`, `engineFallback`, and `devtoolsCapabilities` literally before making profiler claims.
- Treat `node inspect --commit <commitId>` ids as profiler-local ids, not tree snapshot ids.
- Prefer built-in `interact` commands over ad hoc Playwright helpers when `session doctor` reports support.

## Escalate to the Repo Skill

- Use `react-devtool-cli-repo` when the task requires source edits, `npm test`, `npm run build`, `test-app/`, packaging checks, or runtime semantics changes in this repository.
