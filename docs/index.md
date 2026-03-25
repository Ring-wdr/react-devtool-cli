---
layout: home

hero:
  name: react-devtool-cli
  text: Inspect live React apps without opening DevTools UI
  tagline: A Playwright-native CLI for tree snapshots, node inspection, deterministic interaction, and commit-oriented profiler analysis.
  actions:
    - theme: brand
      text: Start with Workflows
      link: /workflows
    - theme: alt
      text: Read the Architecture
      link: /architecture

features:
  - title: Snapshot-aware tree inspection
    details: Collect a tree once, keep the returned snapshot context, and inspect nodes deterministically instead of chasing unstable live ids.
  - title: Playwright-managed sessions
    details: Open local browser sessions directly, connect to Playwright endpoints remotely, or attach to Chromium over CDP when compatibility matters more than fidelity.
  - title: Commit-oriented profiler analysis
    details: Move from suspicion to evidence with doctor checks, built-in interaction helpers, profiler capture, and exportable NDJSON traces.
---

## Why this project exists

`react-devtool-cli` gives agents and engineers a structured command surface for investigating React applications from the terminal. It is built for workflows where opening the DevTools UI is either too manual, too hard to automate, or too indirect for repeatable debugging.

Unlike browser extensions or frontend-only DevTools flows, `rdt` owns the browser session through Playwright. That makes it useful for automated investigations, remote environments, and agent-driven debugging loops where commands need deterministic output and explicit trust boundaries.

## What you can do with it

- Open a browser session against a live app with `session open`, `session connect`, or `session attach`
- Capture snapshot-scoped trees with `tree get`
- Search, inspect, highlight, and source-map React nodes with explicit snapshot context
- Run built-in interactions before profiling, instead of stitching together ad hoc browser scripts
- Record and export commit-oriented profiler data for later comparison

## Recommended first run

```bash
npm install -g react-devtool-cli
rdt session open --url http://localhost:3000 --session demo
rdt tree get --session demo
rdt node search App --session demo --snapshot <snapshotId>
```

That sequence captures the core model of the tool:

1. Open a browser session that `rdt` manages.
2. Collect a tree and persist the returned `snapshotId`.
3. Reuse that snapshot for follow-up inspection so node lookups stay deterministic.

## What makes it different

| Area | `react-devtool-cli` bias |
| --- | --- |
| Runtime host | Playwright-managed browser session |
| Primary interface | Structured CLI output for agents and engineers |
| Tree stability model | Snapshot-scoped node ids |
| Profiler output | Commit-oriented summaries and NDJSON export |
| Trust boundary | Explicit `observationLevel`, `limitations`, and `runtimeWarnings` fields |

## Where to go next

- Use [Workflows](/workflows) to get productive quickly.
- Use [Architecture](/architecture) to understand engine choice, snapshot semantics, and profiler interpretation limits.
