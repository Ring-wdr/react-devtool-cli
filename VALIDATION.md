# End-to-End Validation: RDT Agent Snapshot Workflow

**Date:** 2026-03-16
**Commit:** `a368b941e40ab1ed4887724a1d6b176615169638`
**Node:** v24.14.0
**Verdict:** ✅ **PASS** — all 9 checks passed

Machine-readable record: [`reports/validation-summary.json`](reports/validation-summary.json)

---

## Phase 0 — Baseline

| Check | Result |
|-------|--------|
| `git rev-parse HEAD` | `a368b941e40ab1ed4887724a1d6b176615169638` |
| `node --version` | v24.14.0 (≥22 ✓) |
| `npm test` | **pass** — 8/8 tests pass |

> **Note:** Plan referenced 14 unit tests; actual `test/run-tests.js` contains 8 tests covering `parseArgv`, `formatOutput`, and `session-model`. All 8 pass.

---

## Phase 1 — Start test-app

```
cd test-app && npm run dev -- --host 127.0.0.1 --port 3000 &
```

Vite v8.0.0 ready in 144ms at `http://127.0.0.1:3000/`. PID: 87122.

---

## Phase 2 — Open Session

**Command:**
```
node bin/rdt.js session open --url http://127.0.0.1:3000 --session app --timeout 10000 --format json
```

**Result:** ✅ Pass

```json
{
  "sessionName": "app",
  "transport": "open",
  "browserName": "chromium",
  "target": "http://127.0.0.1:3000/",
  "reactDetected": true,
  "roots": [{ "id": "root-1", "rendererId": 1, "nodeId": "n1" }],
  "nodeCount": 64
}
```

`reactDetected: true` confirmed. Session status command also returns `open`.

---

## Phase 3 — tree get & snapshotId

**Command:**
```
node bin/rdt.js tree get --session app --format json
```

**Result:** ✅ Pass

| Field | Value |
|-------|-------|
| `snapshotId` | `snapshot-2` |
| `nodeCount` | 65 nodes |
| Root node | `n66` (Mode) |
| App node | `n68` (FunctionComponent, depth 1) |
| `generatedAt` | 2026-03-16T14:23:17.448Z |

> The first explicit `tree get` returned `snapshot-2`. This report records the observed snapshot numbering only; it does not assert that `session open` creates `snapshot-1` internally.

---

## Phase 4 — Node Search (with snapshot)

**Command:**
```
node bin/rdt.js node search App --session app --snapshot snapshot-2 --format json
```

**Result:** ✅ Pass

```json
[{
  "id": "n68",
  "displayName": "App",
  "tagName": "FunctionComponent",
  "depth": 1,
  "snapshotId": "snapshot-2"
}]
```

- Hit count: 1
- `snapshotId` field present in response ✓
- Node ID: `n68`

---

## Phase 5 — Node Inspect (with snapshot)

**Command:**
```
node bin/rdt.js node inspect n68 --session app --snapshot snapshot-2 --format json
```

**Result:** ✅ Pass

| Field | Value |
|-------|-------|
| `snapshotId` | `snapshot-2` (matches request) |
| `displayName` | `App` |
| `props` | `{}` (no props) |
| State hook 0 | `count = 0` (memoizedState: 0) |
| State hook 1 | `tick = 1` (memoizedState: 1) |
| State hook 2 | `useEffect` (cleanup function present) |
| `hooksCount` | 3 |
| `context` | `[]` |
| `ownerStack` | `[Mode (n66), HostRoot (n67)]` |
| `dom.tagName` | `section#center` |

---

## Phase 6 — Node Highlight (with snapshot)

**Command:**
```
node bin/rdt.js node highlight n68 --session app --snapshot snapshot-2 --format json
```

**Result:** ✅ Pass

```json
{
  "tagName": "section",
  "id": "center",
  "className": null,
  "rect": { "x": 78, "y": 0, "width": 1124, "height": 462.53125 }
}
```

DOM rect present, no error. Exit code: 0.

---

## Phase 7 — Source Reveal (with snapshot)

**Command:**
```
node bin/rdt.js source reveal n68 --session app --snapshot snapshot-2 --format json
```

**Result:** ✅ Pass (expected behavior)

```
null
```

Exit code: 0. Result is `null` — **this is correct, not a failure.** Vite dev builds do not embed `_debugSource` debug info by default. The `null` indicates the field is absent on the component, not a snapshot lookup error. An actual lookup failure would produce a non-zero exit with an error message.

---

## Phase 8 — Profiler

**Commands:**
```
node bin/rdt.js profiler start --session app
sleep 12
node bin/rdt.js profiler stop --session app
node bin/rdt.js profiler summary --session app --format json
node bin/rdt.js profiler export --session app --compress
```

**Result:** ✅ Pass

| Field | Value |
|-------|-------|
| `profileId` | `profile-mmt9xjzv` |
| `commitCount` | 4 (≥2 required ✓) |
| `maxNodeCount` | 64 |
| `minNodeCount` | 64 |
| `averageNodeCount` | 64 |
| `roots` | `["root-1"]` |
| Duration | ~18.9s |
| Export path | `app-profile-mmt9xjzv.jsonl.gz` |
| Compressed | true |

The `tick` state auto-increments every 5s via `setInterval`. During the profiling window, 4 commits were observed. The exact commit boundary timing was not independently traced in this report.

---

## Phase 9 — Snapshot-Expired Verification

**Goal:** Evict `snapshot-2` from the 5-slot cache, then verify access fails with the correct error.

**Eviction:** Ran `tree get` 5 more times → created `snapshot-3` through `snapshot-7`.
Cache now holds: `[snapshot-3, snapshot-4, snapshot-5, snapshot-6, snapshot-7]`. `snapshot-2` is evicted.

**Command:**
```
node bin/rdt.js node inspect n68 --session app --snapshot snapshot-2 --format json
```

**Result:** ✅ Pass

```
CliError: Snapshot "snapshot-2" is no longer available. Run rdt tree get --session <name> again to collect a fresh snapshot.
EXIT=1
```

| Check | Value |
|-------|-------|
| Exit code | 1 (non-zero ✓) |
| Error message | "no longer available" |
| Internal error code | `snapshot-expired` — inferred from source (`src/runtime-script.js:405`); CLI stderr only surfaces the human-readable message |
| stderr contains indication | ✓ |

---

## Phase 10 — Close Session

```
node bin/rdt.js session close --session app
```

Output: `{ "closed": true, "sessionName": "app" }`. Exit: 0.
Vite background process (PID 87122) killed.

---

## Verification Criteria Summary

| Check | Pass Condition | Result |
|-------|---------------|--------|
| Unit tests | All tests pass | ✅ 8/8 pass |
| `session open` | `reactDetected: true` | ✅ |
| `tree get` | Non-empty nodes, valid `snapshotId` | ✅ 65 nodes, `snapshot-2` |
| `node search` | ≥1 result for "App", `snapshotId` in response | ✅ 1 hit, `snapshotId` present |
| `node inspect` | Returns props/state/hooks for App node | ✅ |
| `node highlight` | No error (DOM rect or null) | ✅ DOM rect returned |
| `source reveal` | Returns `null` without error | ✅ `null`, exit 0 |
| `profiler` | `commitCount ≥ 1`, export file created | ✅ 4 commits, `.jsonl.gz` created |
| `snapshot-expired` | Non-zero exit + snapshot-expired error | ✅ exit 1, error confirmed |

**Overall Verdict: PASS**

---

## Issues

None. All phases completed successfully without errors.

---

## Notes

- The first explicit `tree get` returned `snapshot-2`. The snapshot numbering is recorded as observed; agent workflows should extract `snapshotId` from `tree get` output rather than assuming any particular value.
- `source reveal` returning `null` is correct behavior for Vite dev builds. To get `_debugSource` data, the app would need to be built with `@babel/plugin-transform-react-jsx-source` or equivalent. This is documented as a known limitation, not a bug.
- The `snapshot-expired` error code is surfaced via `CliError.code = "snapshot-expired"` (set in `src/runtime-script.js:405` → propagated through `src/server.js:unwrapRuntimeResult`). The human-readable message in stderr is "no longer available".
