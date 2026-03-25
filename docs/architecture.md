# Architecture

`react-devtool-cli` is intentionally not a browser extension wrapper. It is a CLI runtime that owns browser automation, React tree capture, and profiler export as one command surface.

## Runtime shape

| Layer | Responsibility |
| --- | --- |
| CLI | Parse commands, format output, and route calls to the session daemon |
| Session daemon | Own browser lifecycle, transport selection, and RPC between commands and the active page |
| Runtime script | Discover roots through the React global hook, collect snapshots, inspect nodes, and capture profiler data |

This split keeps user-facing commands stable while transport and runtime details evolve underneath.

## Session transports

| Transport | Meaning | Recommended use |
| --- | --- | --- |
| `open` | `rdt` launches the browser directly through Playwright | Default for local work |
| `connect` | `rdt` connects to an existing Playwright endpoint | Best remote path |
| `attach` | `rdt` attaches through Chromium CDP | Compatibility fallback when Playwright protocol is unavailable |

## Engine selection

`--engine auto` is the default because it chooses between the current custom engine and a DevTools-aligned path when capability checks allow it.

- `custom` forces the snapshot-diff engine
- `devtools` requests the DevTools-aligned path and falls back when capability checks fail
- `doctor` exposes `selectedEngine`, `recommendedEngine`, and capability hints so callers know what they are actually trusting

## Snapshot semantics

Snapshot-scoped node identity is a deliberate design choice, not a temporary workaround.

- `tree get` creates a snapshot and returns `snapshotId`
- follow-up node ids are only stable inside that snapshot
- commands fail loudly when a requested snapshot has expired from the cache

This makes the CLI more deterministic for agent workflows than a model that pretends node ids stay globally stable across live React updates.

## Inspect payload model

`node inspect` is closest to an inspected-element payload, but the CLI keeps it intentionally simpler than full DevTools frontend data.

- `ownerStack` is a lightweight owner chain
- `hooks` is a simplified serialized view of hook state
- `context` is a serialized view of current context dependencies
- `source` may be `null` when `_debugSource` is not present in the runtime
- `dom` is the first host descendant summary used for highlight and DOM-oriented follow-up

## Profiler model

Profiler support is commit-oriented.

- summaries focus on commit count, timestamps, roots, and live-tree size
- exported profiles use NDJSON or `jsonl.gz`
- ranked and flamegraph views provide CLI-oriented hotspot summaries
- duration support depends on what the current React runtime exposes

Important limitation: current profiler output does not prove exact rerender sets the way a full DevTools frontend with component-duration instrumentation might.

## Trust boundaries

Most structured responses expose the same three guardrails:

- `observationLevel`: what was directly observed
- `limitations`: what the payload does not prove
- `runtimeWarnings`: environmental or runtime conditions that can mislead follow-up analysis

The project is designed so agents can read those fields literally instead of inferring hidden guarantees.

## Documentation boundary

Public docs should explain the product, workflow, and architecture clearly. Maintainer handoff notes, raw validation logs, and internal investigation artifacts still belong in the repository, but they are not the public narrative for the GitHub Pages site.
