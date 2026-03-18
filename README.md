# react-devtool-cli

Agent-first CLI for inspecting React applications through a Playwright-managed browser session.

It gives agents and engineers a structured command surface for React tree snapshots, node inspection, source reveal, deterministic browser interaction, and commit-oriented profiler analysis without opening the DevTools UI. The public CLI is engine-based: `auto` chooses between the current custom engine and a DevTools-aligned engine when capability checks allow it.

## Recommended architecture

- `rdt` talks to Playwright directly through the Node API
- `rdt session open` is the default local path
- `rdt session connect` is the remote Playwright protocol path
- `rdt session attach` is the Chromium CDP compatibility path

This follows the same overall shape as Playwright's own CLI surface: one command layer, multiple transport modes underneath.

## Install

```bash
npm install -g react-devtool-cli
```

Published package notes:

- npm consumers receive built files from `dist/`, not the repository source tree.
- repository-only validation artifacts, handoff docs, and local test fixtures are intentionally excluded from the published package.

`rdt` resolves Playwright in this order:

- local `playwright`
- local `playwright-core`
- `RDT_PLAYWRIGHT_PATH`
- global `playwright`
- global `playwright-core`

## Commands

```bash
rdt session open --url http://localhost:3000 --browser chromium --engine auto --session demo
rdt session connect --ws-endpoint ws://127.0.0.1:3000/ --target-url localhost:3000 --session remote
rdt session attach --cdp-url http://127.0.0.1:9222 --target-url localhost:3000 --session cdp
rdt session doctor --session demo
rdt tree get --session demo
rdt interact type --session demo --selector 'input[name="query"]' --text hello
rdt node search App --session demo --snapshot <snapshotId>
rdt node inspect <nodeId> --session demo --snapshot <snapshotId>
rdt profiler start --session demo
rdt profiler stop --session demo
rdt profiler compare --session demo --left baseline --right candidate
rdt profiler export --session demo --compress
```

## Snapshot Semantics

- `tree get` returns a `snapshotId`.
- Node IDs are only meaningful within that snapshot.
- The runtime currently keeps up to `5` snapshots in memory per session.
- Agent-friendly recommended flow:
  1. call `tree get`
  2. store the returned `snapshotId`
  3. pass that `snapshotId` to later `node search`, `node inspect`, `node highlight`, and `source reveal` calls
- If `--snapshot` is omitted, commands fall back to the latest collected snapshot.
- If an explicitly requested snapshot has been evicted from the runtime cache, commands fail with `snapshot-expired`.
- Responses from snapshot-aware commands include the `snapshotId` that was actually used, so agents can pin follow-up calls to it.

## Doctor

- `rdt session doctor --session <name>` reports runtime readiness and trust boundaries before a deeper investigation.
- It also reports `enginePreference`, `selectedEngine`, `recommendedEngine`, `availableEngines`, and DevTools capability hints so agents know whether they are on a custom fallback or a DevTools-aligned path.
- `sourceCapability` is reported separately from engine selection.
- `_debugSource` is treated as an optional legacy source-mapping capability, not an engine-selection gate.
- In React 19+ builds, `_debugSource` is commonly unavailable, so `source reveal` may remain partial even when `selectedEngine` is `devtools`.
- It checks React detection, snapshot/inspect readiness, profiler capability, `_debugSource` availability, and Playwright resolution.
- It also reports whether built-in `interact` commands are available on the current session target and whether duration metrics are exposed by the current React runtime.
- It also warns when `rdt` itself can resolve Playwright but standalone helper scripts may still fail to `import('playwright')`.
- When that mismatch happens, `doctor` returns `helperImportTarget` and `helperImportExample` so agents can import the same Playwright entry that `rdt` resolved without reading internal package files.
- It returns `recommendedWorkflow`, `unsafeConclusions`, and `helperStrategy` so agents can decide whether to trust `interact`, `profiler`, or helper-based fallbacks.
- Use it before profiling if browser interaction helpers or ad hoc Node scripts are involved.

## Interact

- Use built-in `interact` commands before reaching for external Playwright helper scripts.
- Current supported actions:
  - `rdt interact click --session <name> --selector <css>`
  - `rdt interact type --session <name> --selector <css> --text <value>`
  - `rdt interact press --session <name> --key <name> [--selector <css>]`
  - `rdt interact wait --session <name> --ms <n>`
- These commands execute through the same Playwright session that owns the current `rdt` browser page.
- They target the first matching selector only and return structured action metadata plus trust-boundary fields.
- `click`, `type`, and `press` confirm that the action was dispatched. They do not guarantee that the page or React tree has fully settled afterward.
- When profiling or triggering large rerenders, follow `interact` with an explicit verification step such as `interact wait`, `tree get`, `node inspect`, or a profiler read command.

Example deterministic flow:

```bash
rdt tree get --session demo
# => save snapshotId from output
rdt node search App --session demo --snapshot <snapshotId>
rdt node inspect <nodeId> --session demo --snapshot <snapshotId>
rdt node highlight <nodeId> --session demo --snapshot <snapshotId>
rdt source reveal <nodeId> --session demo --snapshot <snapshotId>
```

Snapshot recovery:

- If you get `snapshot-expired`, do not reuse old node IDs.
- Run `rdt tree get --session <name>` again.
- Read the new `snapshotId`.
- Re-run `node search` against the new snapshot before further inspection.

`node pick` behavior:

- `node pick` captures a snapshot-scoped result and returns the same shape as `node inspect`.
- Agents should persist the returned `snapshotId` and use it for any follow-up commands.

## Practical Workflows

Engine selection:

- `--engine auto` is the default and should be preferred for agent workflows.
- `--engine custom` forces the snapshot-diff engine.
- `--engine devtools` requests the DevTools-aligned engine and falls back to `custom` when capability checks fail.
- Inspect `selectedEngine`, `engineFallback`, and `devtoolsCapabilities` from `session doctor` before trusting profiler fidelity.
- Do not use `_debugSource` availability as a reason to override `selectedEngine`; source mapping is tracked independently via `sourceCapability`.
- Snapshot and profiler buffers are now isolated per selected engine, so `auto`, `custom`, and `devtools` no longer share the same in-memory lookup state.

Performance triage flow:

```bash
rdt session open --url http://localhost:3000 --session app
rdt tree get --session app
# => save snapshotId from output as SNAPSHOT_A
rdt node search SlowSearchDemo --session app --snapshot SNAPSHOT_A
rdt node search ResultList --session app --snapshot SNAPSHOT_A
rdt node inspect <nodeId> --session app --snapshot SNAPSHOT_A
rdt profiler start --session app
# in test-app, type one character into "Type to filter products"
rdt profiler stop --session app
rdt profiler summary --session app
rdt profiler commits --session app
rdt profiler ranked <commitId> --session app --limit 10
rdt profiler export --session app --compress
rdt tree get --session app
# => save new snapshotId as SNAPSHOT_B
rdt node search SlowSearchDemo --session app --snapshot SNAPSHOT_B
rdt node inspect <nodeId> --session app --snapshot SNAPSHOT_B
```

Use this flow when an agent needs to answer:

- whether a user action produced more commits than expected
- whether a suspected component changed `props`, `state`, `hooks`, or `context`
- whether the update appears localized or broad across the tree

`test-app` includes an intentional bottleneck for this flow:

- `SlowSearchDemo` owns the filter state
- `ResultList` renders a large list
- `ResultRow` recomputes per-row derived data and receives fresh props on each input change
- typing into the filter causes broad re-rendering across the visible list

Profiler interpretation:

- current profiler output is commit-oriented, not component-duration-oriented
- use `commitCount`, commit timestamps, and `nodeCount` to detect suspicious update patterns
- use follow-up `tree get` and `node inspect` calls to infer likely causes from changed state, props, hooks, and context

`node pick` flow:

```bash
rdt node pick --session app
# click the element in Chromium
# => save returned snapshotId and id
rdt node inspect <nodeId> --session app --snapshot <snapshotId>
rdt node highlight <nodeId> --session app --snapshot <snapshotId>
rdt source reveal <nodeId> --session app --snapshot <snapshotId>
```

Use `node pick` when the agent knows the visible element but not the component name to search for.

## Response Semantics

- Most structured responses now include:
  - `observationLevel`
  - `limitations`
  - `runtimeWarnings`
- Read them literally:
  - `observationLevel: "observed"` means the payload is directly observed by `rdt`
  - `limitations` describes what the payload does not prove
  - `runtimeWarnings` highlights environment or runtime conditions that can mislead follow-up analysis
- `tag` is the numeric React fiber tag.
- `tagName` is the human-readable label derived from that fiber tag.
- `ownerStack` is a lightweight owner chain for CLI output, not a full stack frame model.
- `hooks` is a simplified serialized view of hook state from the inspected fiber.
- `context` is a serialized view of current context dependencies for the inspected node.
- `source` projects `_debugSource` when available; `null` is expected in many dev builds.
- `dom` is the first host element summary used for CLI highlight and DOM-oriented inspection.
- Profiler summary fields are commit-oriented CLI metrics, not the full DevTools profiler session schema.
- `profiler summary` and exported summaries explicitly report:
  - `measurementMode: "actual-duration" | "structural-only" | "mixed"`
  - `measuresComponentDuration`
  - `tracksChangedFibers: false`
  - `nodeCountMeaning: "live-tree-size-at-commit"`
- New profiler drill-down commands:
  - `rdt profiler commits --session <name>`
  - `rdt profiler commit <commitId> --session <name>`
  - `rdt profiler ranked <commitId> --session <name> [--limit <n>]`
  - `rdt profiler flamegraph <commitId> --session <name>`
  - `rdt profiler compare --session <name> --left <profileId|file> --right <profileId|file>`
- `node inspect --commit <commitId>` expects a node id from that commit's profiler views, not from a separate `tree get` snapshot.
- `profiler compare` can compare in-memory profile ids from the current session or exported `.jsonl` / `.jsonl.gz` profiler files.
- Commit-oriented profiler payloads now expose:
  - `observedReasons`
  - `inferredReasons`
  - `reasonConfidence`
- Read them literally:
  - `observedReasons` are direct diffs from adjacent commit snapshots
  - `inferredReasons` are propagation-based explanations such as `parent-render`
  - `reasonConfidence` is a CLI confidence estimate, not React-internal truth
- `profiler ranked` now includes `reasonSummary`, `hotspotLabel`, and compact hotspot summaries.
- `profiler flamegraph` now includes `hottestSubtrees`, `widestChangedSubtrees`, and `mostCommonReasons` at the root level.

## Concept Alignment

- Current runtime design note: [docs/devtools-concept-mapping.md](./docs/devtools-concept-mapping.md)
- `react-devtools-core` is the primary reference package for concept comparison.
- `react-debug-tools` is installed as a dev-only reference but is currently a low-value implementation reference in this repo state.

## Output formats

- Default command output is `JSON`
- Compact human-readable output supports `--format yaml` and `--format pretty`
- Raw profiler export is `NDJSON` (`.jsonl`) or `jsonl.gz` with `--compress`

## Skills

- Installed CLI user skill: [skills/react-devtool-cli/SKILL.md](./skills/react-devtool-cli/SKILL.md)
- Repository maintenance skill: [skills/react-devtool-cli-repo/SKILL.md](./skills/react-devtool-cli-repo/SKILL.md)

## Notes

- Initial browser support is Chromium-only
- `session open` is the recommended default
- `session connect` expects a Playwright `wsEndpoint`
- `session attach` requires a Chromium instance with CDP enabled and has lower fidelity than Playwright protocol transport
- Session status reports `transport`, `browserName`, `endpoint`, `persistent`, and `capabilities`
- Snapshot-aware node workflows are preferred for agents; use the `snapshotId` returned by `tree get` for deterministic follow-up calls
- Runtime semantics are documented to align with DevTools concepts where practical, while keeping the CLI snapshot model custom
- `profiler export` intentionally rejects `YAML`; use `profiler summary` for compact summaries
- Global CLI distribution is preferred; Playwright does not need to be pinned as a repo dependency

## License

MIT. See [LICENSE](./LICENSE).
