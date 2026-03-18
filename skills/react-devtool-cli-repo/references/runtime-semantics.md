# Runtime Semantics

## Summary

- `rdt` is a custom Playwright-native CLI runtime.
- `react-devtools-core` is a naming and concept reference, not a runtime dependency.
- `react-debug-tools` is a weak implementation reference in the current repo state.

## Concept Mapping

| `rdt` concept | Closest DevTools concept | Meaning |
| --- | --- | --- |
| Playwright-managed session | Runtime/backend host process | `rdt` owns browser and session lifecycle directly. |
| `__REACT_DEVTOOLS_GLOBAL_HOOK__` shim | DevTools global hook | Used for renderer and root discovery without adopting the frontend protocol. |
| `collectTree()` snapshot | Inspected tree payload | `rdt` serializes a CLI-friendly tree snapshot. |
| `snapshotId` | No direct public equivalent | CLI-specific stability layer for follow-up commands. |
| Snapshot-local node id | Inspector element identity | Only valid within the collected snapshot. |
| `node inspect` payload | Inspected element details | Snapshot-time serialized element details. |
| Profiler summary/export | Profiler commit data | Commit-oriented summaries and NDJSON export. |
| `interact` commands | No direct public equivalent | Playwright-backed deterministic interaction helpers. |
| `session doctor` | No direct public equivalent | CLI-specific readiness and trust-boundary report. |

## Interpretation Rules

- Read `observationLevel`, `limitations`, and `runtimeWarnings` literally.
- Treat `ownerStack` as a lightweight owner chain, not a full frame model.
- Treat `hooks` and `context` as simplified serialized views.
- Expect `source` to be `null` in many builds when `_debugSource` is unavailable.
- Treat rerender reasons as snapshot-diff inference, not changed-fiber truth.

## Snapshot Rules

- Persist `snapshotId` from `tree get`.
- Reuse node ids only with the same snapshot.
- If a requested snapshot expires, recollect the tree before further node lookup.

## Profiler Rules

- `measurementMode`, `measuresComponentDuration`, and `tracksChangedFibers` are capability flags that limit what can be claimed.
- `nodeCountMeaning` is `live-tree-size-at-commit`.
- `profiler compare` works with in-memory profile ids or exported `.jsonl` / `.jsonl.gz` files.
- `node inspect --commit <commitId>` expects profiler-local node ids, not ids from `tree get`.
