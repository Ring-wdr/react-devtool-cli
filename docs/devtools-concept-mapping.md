# RDT to React DevTools Concept Mapping

This note maps the current `rdt` runtime to the public concepts exposed by `react-devtools-core`.
It is a maintenance aid for agents and contributors. It is not a commitment to runtime integration.

## Summary

- `rdt` remains a custom Playwright-native CLI runtime.
- `react-devtools-core` is used as a reference for naming and concept comparison.
- `react-debug-tools` is currently a weak reference in this repo state and should not drive implementation decisions.

## Reference Packages

### `react-devtools-core`

- Primary reference package for backend/frontend DevTools concepts.
- Useful for:
  - global hook and renderer registration concepts
  - backend/frontend separation
  - profiler and inspected-element terminology
- Not currently used in the runtime path.

### `react-debug-tools`

- Installed as a dev-only reference.
- In this environment it does not provide a practical code surface for implementation guidance.
- Treat it as a low-confidence reference until a stronger use case appears.

## Concept Mapping

| `rdt` concept | Current source | Closest DevTools concept | Notes |
|---|---|---|---|
| Playwright-managed session | `src/server.js` | Runtime/backend host process | `rdt` owns browser/session lifecycle directly rather than embedding a socket-connected backend. |
| `__REACT_DEVTOOLS_GLOBAL_HOOK__` shim | `src/runtime-script.js` | DevTools global hook | `rdt` uses the hook for renderer/root discovery, but does not speak the official frontend protocol. |
| `state.roots` + `rootId` | `src/runtime-script.js` | Fiber roots / renderer root registry | `rdt` assigns CLI-friendly `root-*` ids per discovered root. |
| `collectTree()` snapshot | `src/runtime-script.js` | Inspected tree payload | `rdt` serializes a tree for CLI use instead of streaming updates to a frontend. |
| `snapshotId` | `src/runtime-script.js` | No direct public equivalent | Intentional divergence. This is a CLI-specific stability layer for follow-up commands. |
| `node id` like `n68` | `src/runtime-script.js` | Element/fiber identity in inspector payloads | Snapshot-scoped only. Not intended to be globally stable across commits. |
| `node inspect` payload | `src/runtime-script.js` | Inspected element details | Closest conceptual match to DevTools inspected element data. |
| `ownerStack` | `src/runtime-script.js` | Owner chain / component stack | Serialized as lightweight `{id, displayName}` records. |
| `hooks` | `src/runtime-script.js` | Hook inspection data | Derived from `memoizedState`; intentionally simpler than full DevTools hook typing. |
| `context` | `src/runtime-script.js` | Context dependencies / inspected context values | Derived from fiber dependencies, serialized for CLI use. |
| `source reveal` | `src/server.js` + `src/runtime-script.js` | View source / inspect source location | Depends on `_debugSource`; may legitimately return `null`. |
| `profiler` summary/export | `src/runtime-script.js` + `src/cli.js` | Profiler commit data | `rdt` keeps commit-oriented summaries and NDJSON export rather than full DevTools frontend state. |
| `session doctor` | `src/server.js` + `src/runtime-script.js` | No direct public equivalent | CLI-specific preflight that reports trust boundaries, runtime readiness, Playwright resolution diagnostics, and helper import targets. |

## Intentional Divergences

- `snapshotId` and snapshot-local node ids are CLI-specific and should stay explicit in docs and agent workflows.
- `rdt` exposes serialized JSON snapshots, not a live DevTools backend/frontend protocol.
- `inspect` returns a stable snapshot-time payload rather than a live-updating inspected element model.
- `highlight` and `pick` are implemented as page-side DOM event flows for CLI automation, not frontend UI affordances.
- `doctor` is CLI-specific and intentionally exposes environment limitations that DevTools frontends normally hide.

## Field Semantics

### Tree payload

- `snapshotId`: identifier for one collected tree snapshot.
- `roots[]`: root metadata for the current snapshot.
- `roots[].nodeId`: top visible node id for that root within the same snapshot.
- `nodes[]`: serialized node list for the snapshot.
- `nodes[].tag`: numeric fiber tag.
- `nodes[].tagName`: human-readable tag label derived from the fiber tag.

### Inspect payload

- `ownerStack`: lightweight owner chain, not a full DevTools stack frame model.
- `hooks`: serialized hook state view, intentionally simplified.
- `context`: serialized current context dependency values.
- `source`: `_debugSource` projection when available; `null` is expected in many builds.
- `dom`: first host element descendant summary used for CLI-oriented highlight/reveal behavior.

### Profiler payload

- `commitCount`, `maxNodeCount`, `minNodeCount`, `averageNodeCount`, `roots` are summary-level CLI metrics.
- Exported NDJSON is commit-oriented event data, not a full DevTools profiler session model.
- `measuresComponentDuration` and `tracksChangedFibers` are explicit negative-capability flags to prevent over-interpretation.

## Implementation Guidance

- Prefer aligning terminology and documentation before changing runtime structure.
- Do not import `react-devtools-core` into the runtime path unless there is a clear need to adopt its messaging/runtime model.
- If future work revisits integration, compare current `rdt` snapshot commands against `react-devtools-core` backend concepts first, then decide whether to stay custom or move closer to official messaging.
