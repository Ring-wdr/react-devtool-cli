# Runtime Semantics

## Summary

- `rdt` is a custom Playwright-native CLI runtime.
- `react-devtools-core` is a naming and concept reference, not a runtime dependency.
- `react-debug-tools` is a weak implementation reference in the current repo state.

## Engine Selection

`rdt` supports multiple inspection engines, selected per-session via `--engine`:

| Engine | Behavior |
|---|---|
| `auto` (default) | Resolves the best available engine at runtime; prefers custom, falls back to devtools |
| `custom` | Uses `rdt`'s own snapshot-diff inspection engine for tree collection and reason attribution |
| `devtools` | Uses the DevTools-aligned hook-based engine that mirrors `react-devtools-core` conventions |

Engine selection affects:
- **Tree collection**: Each engine maintains its own snapshot store; snapshots from one engine are not interchangeable with another.
- **Reason attribution**: The custom engine uses snapshot-diff inference; the devtools engine relies on hook-reported change data.
- **Profiler capabilities**: The devtools engine may report different `measurementMode` and `measuresComponentDuration` values.
- **Available metadata fields**: Fields like `engineFallback`, `engineReasons`, and `availableEngines` appear in `session doctor` and `session status` output.

### Engine fields in doctor/status output

| Field | Meaning |
|---|---|
| `enginePreference` | The engine requested via `--engine` |
| `selectedEngine` | The engine actually in use after resolution |
| `availableEngines` | Engines that the runtime supports for this page |
| `recommendedEngine` | The engine the runtime considers optimal |
| `engineFallback` | `true` if the selected engine differs from the preference (auto resolved to a specific engine, or a forced engine was unavailable) |
| `engineReasons` | Human-readable explanation of why the engine was selected |

## Concept Mapping

| `rdt` concept | Closest DevTools concept | Meaning |
| --- | --- | --- |
| Playwright-managed session | Runtime/backend host process | `rdt` owns browser and session lifecycle directly. |
| `__REACT_DEVTOOLS_GLOBAL_HOOK__` shim | DevTools global hook | Used for renderer and root discovery without adopting the frontend protocol. |
| `collectTree()` snapshot | Inspected tree payload | `rdt` serializes a CLI-friendly tree snapshot. Engine-specific. |
| `snapshotId` | No direct public equivalent | CLI-specific stability layer for follow-up commands. |
| Snapshot-local node id | Inspector element identity | Only valid within the collected snapshot and its engine. |
| `node inspect` payload | Inspected element details | Snapshot-time serialized element details. |
| `node pick` | Element picker | Interactive browser-based component selection. |
| Profiler summary/export | Profiler commit data | Commit-oriented summaries and NDJSON export. |
| `interact` commands | No direct public equivalent | Playwright-backed deterministic interaction helpers. |
| `session doctor` | No direct public equivalent | CLI-specific readiness and trust-boundary report. |
| `session status` | No direct public equivalent | Current session state including transport, engine, and runtime info. |
| `session close` | No direct public equivalent | Graceful shutdown with force-kill fallback. |

## Interpretation Rules

- Read `observationLevel`, `limitations`, and `runtimeWarnings` literally.
- Treat `ownerStack` as a lightweight owner chain, not a full frame model.
- Treat `hooks` and `context` as simplified serialized views.
- Expect `source` to be `null` in many builds when `_debugSource` is unavailable.
- Treat rerender reasons as snapshot-diff inference, not changed-fiber truth.
- Check `selectedEngine` and `engineFallback` before making claims about what the profiler or inspector can observe.

## Snapshot Rules

- Persist `snapshotId` from `tree get`.
- Reuse node ids only with the same snapshot.
- If a requested snapshot expires, recollect the tree before further node lookup.
- Snapshots are engine-specific: a snapshot collected under the custom engine cannot be used with the devtools engine, and vice versa.

## Profiler Rules

- `measurementMode`, `measuresComponentDuration`, and `tracksChangedFibers` are capability flags that limit what can be claimed.
- `nodeCountMeaning` is `live-tree-size-at-commit`.
- `profiler start` accepts `--profile-id` to assign a custom identifier.
- `profiler compare` works with in-memory profile ids or exported `.jsonl` / `.jsonl.gz` files.
- `profiler export` writes NDJSON with optional gzip compression (`--compress`).
- `node inspect --commit <commitId>` expects profiler-local node ids, not ids from `tree get`.
- Exported NDJSON includes engine metadata (`engine`, `enginePreference`, `selectedEngine`, `measurementSource`) in the summary record.
