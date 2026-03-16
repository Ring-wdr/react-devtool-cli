# RDT Task Handoff

This file is the source of truth for the next Codex session. Do not assume prior chat context. Start here.

## Goal

Build `react-devtool-cli` (`rdt`) into a Playwright-native CLI for inspecting live React apps.

Current session architecture is:

- `rdt session open` -> local Playwright launch
- `rdt session connect` -> Playwright protocol `wsEndpoint`
- `rdt session attach` -> Chromium CDP fallback
- `rdt` owns Playwright directly through the Node API

## Current Status

Implemented:

- CLI entrypoint and command routing
- session daemon process with local HTTP RPC
- session transports: `open`, `connect`, `attach`
- transport/capability metadata in session status
- basic React runtime injection via `__REACT_DEVTOOLS_GLOBAL_HOOK__`
- commands:
  - `session open|connect|attach|status|close`
  - `tree get`
  - `node inspect|search|highlight|pick`
  - `profiler start|stop|summary|export`
  - `source reveal`
- output formats:
  - default `json`
  - compact `yaml` / `pretty`
  - profiler raw export `jsonl` / `jsonl.gz`
- local React validation target:
  - `test-app/` Vite React template for real-app verification
- snapshot-aware lookup:
  - `tree get` returns `snapshotId`
  - `node inspect|search|highlight` and `source reveal` accept `--snapshot <id>`
  - runtime keeps a small in-memory snapshot cache
- dev-only React DevTools references:
  - `react-devtools-core`
  - `react-debug-tools`
  - added for agent reference and data-model comparison, not runtime integration

Implemented files to inspect first:

- [src/cli.js](./src/cli.js)
- [src/server.js](./src/server.js)
- [src/runtime-script.js](./src/runtime-script.js)
- [src/session-model.js](./src/session-model.js)
- [test/run-tests.js](./test/run-tests.js)

## Verified Facts

- `npm test` passes.
- `node bin/rdt.js --help` works.
- `import('playwright')` works locally.
- A local Vite React app was scaffolded at `test-app/` and dependencies were installed.
- Real browser launch was verified once with:

```bash
node bin/rdt.js session open --url data:text/html,%3Chtml%3E%3Cbody%3Ehello%3C/body%3E%3C/html%3E --session smoke-open-escalated --timeout 5000
node bin/rdt.js session status --session smoke-open-escalated
node bin/rdt.js session close --session smoke-open-escalated
```

- The smoke page was not a React app, so `reactDetected` was correctly `false`.
- `session connect` error path was verified against an invalid endpoint and returned a structured failure.
- Real React app validation was run successfully against `http://127.0.0.1:3000/` from `test-app/`.
- `node bin/rdt.js session open --url http://127.0.0.1:3000 --session app --timeout 10000` returned `reactDetected: true`.
- `tree get` returned a real React tree with one root and expected `App` / host nodes.
- `node search App --session app` and `node inspect <id> --session app` returned meaningful `props`, `state`, `hooks`, and `dom` data.
- profiler flow worked against real updates after adding an auto-incrementing `tick` state to `test-app/src/App.jsx`.
- `profiler stop` reported `commitCount: 42`, `maxNodeCount: 64`, `roots: ["root-1"]`.
- `profiler export --session app --compress` produced `/Users/kimmanjoong/private-project/rdt-cli/app-profile-mmt78xlw.jsonl.gz`.
- In this environment, both the Vite dev server port bind and `rdt` session commands that talk to the local session daemon required sandbox escalation.
- `tree get` now returns a `snapshotId` for snapshot-local node lookup.
- `node search App --session app --snapshot <snapshotId>` and `node inspect <nodeId> --session app --snapshot <snapshotId>` were verified against the same collected snapshot after later React updates.
- strict snapshot-time inspect behavior was verified:
  - `tree get` captured `App` with `Auto tick: 1`
  - after waiting for later React updates, `node inspect <nodeId> --snapshot <same-id>` still returned `tick = 1`
- `node highlight <nodeId> --session app --snapshot <snapshotId>` worked with snapshot-aware lookup.
- `source reveal <nodeId> --session app --snapshot <snapshotId>` executed successfully; for `App` it returned `null`, consistent with missing `_debugSource` rather than a snapshot lookup failure.
- `node pick` was validated through a CDP-attached session:
  - clicking `button.counter` returned a snapshot-scoped inspect result for the `button` host node
  - the returned `snapshotId` and `nodeId` were then reused successfully with `node inspect`, `node highlight`, and `source reveal`
- `react-devtools-core` and `react-debug-tools` were added as `devDependencies` for official reference during future agent maintenance.

## Known Issue From Real-App Run

- Node identity appears unstable across updates.
- Repro:
  1. Start `test-app/` with Vite.
  2. Open an `rdt` session to `http://127.0.0.1:3000`.
  3. Trigger React updates, either via HMR or the auto-incrementing `tick` state in `test-app/src/App.jsx`.
  4. Compare `tree get` output with `node search App` output, then immediately run `node inspect <id>`.
- Observed behavior:
  - `tree get` showed `App` as `n64` while `node search App` later returned `n127`.
  - `node inspect n64 --session app` returned `null`.
  - `node inspect n127 --session app` succeeded and returned current hook/state data.
- Interpretation:
  - there may be a bug in node ID stability, tree snapshot freshness, or lookup synchronization after updates/HMR
  - React inspection is functional, but node references are not yet trustworthy enough to call fully stable

## Current Design Decision

- `snapshot-local` node identity is now the active implementation direction.
- Working definition:
  - `tree get` should create a `snapshotId`
  - each node `id` is only guaranteed to be valid within that snapshot
  - follow-up commands such as `node search`, `node inspect`, and `node highlight` should resolve against the same snapshot instead of re-walking the latest live fiber tree
- Rationale:
  - current IDs are keyed by live fiber object identity and are not stable across updates or HMR
  - forcing globally stable IDs across React commits would be more complex and less reliable than first making snapshot semantics explicit
  - snapshot-local IDs are sufficient for a CLI flow where users first fetch a tree, then inspect/search/highlight within that same view
- Expected implementation shape:
  - keep a small in-memory snapshot cache in the page runtime
  - store `snapshotId`, serialized nodes, and a `nodeId -> fiber` lookup for that snapshot
  - make server/CLI commands accept a snapshot reference where needed
  - document that a node ID without its snapshot context is not globally meaningful

## Remaining Gap After Snapshot Work

- Snapshot lookup now keeps node identity stable enough for `tree get -> search/inspect/highlight/source`.
- Current implementation status:
  - explicit `--snapshot <id>` is supported
  - omitting `--snapshot` falls back to the latest collected snapshot
  - runtime snapshot cache size is currently `5` per session
  - if an explicitly requested snapshot has been evicted, commands now fail with `snapshot-expired` instead of silently falling back
- Agent-oriented operating rule:
  - agents should treat `tree get` as the start of a lookup cycle
  - agents should persist the returned `snapshotId` and pass it to all later node/source commands
  - latest-snapshot fallback exists for convenience, not as the preferred deterministic path
- Remaining questions:
  - whether snapshot cache size should stay fixed at `5` or become configurable

## Important Constraints

- Browser launch may require sandbox escalation in this environment.
- `attach` is Chromium-only and lower fidelity than Playwright protocol transport.
- Current React inspection uses a custom runtime script, not `react-devtools-core` yet.
- Session state is stored under `.react-devtool-cli/sessions` in the repo by default.

## Design Consideration

- Evaluate adding `react-devtools-core` and related DevTools packages as `devDependencies`, not immediate runtime dependencies.
- Current decision:
  - `react-devtools-core` and `react-debug-tools` are now installed as `devDependencies`
  - they are reference-only for agent maintenance and model comparison
  - do not import them into the runtime path unless a later tradeoff review justifies that coupling
- Purpose:
  - improve type stability while exploring DevTools data structures
  - compare the current custom runtime against official DevTools concepts and event flow
  - decide whether later integration should stay custom, adopt official types only, or move closer to official runtime pieces
- Decision rule:
  - prefer development-time references and type usage first
  - avoid runtime deep imports unless the stability tradeoff is clearly acceptable
- This should be revisited during the first real React app validation pass.

## Next Priority

Primary next milestone:

- re-run end-to-end validation against the documented agent snapshot workflow and decide whether any snapshot UX should still change

Concrete tasks:

1. Reuse `test-app/` as the default local React validation target.
2. Re-run the documented agent workflow exactly as written in README / skill docs:
   - `tree get`
   - persist `snapshotId`
   - `node search|inspect|highlight|source reveal` with `--snapshot`
3. Decide whether `node pick` needs a more prominent README example now that the behavior is verified.
4. Verify snapshot eviction behavior remains acceptable with cache size `5`.
5. Re-run the same React validation after the doc / UX cleanup:
   - `session open` returns `reactDetected: true`
   - `tree get` returns credible roots, nodes, and a snapshot identifier
   - `node search`, `node inspect`, `node highlight`, `source reveal`, and `node pick` work on IDs from that same snapshot
   - profiler still captures real commits
6. Revisit whether official DevTools types or references would help stabilize node identity modeling.

## Suggested Execution Order

1. Re-read [TASK.md](./TASK.md), [README.md](./README.md), and [skills/react-devtool-cli/SKILL.md](./skills/react-devtool-cli/SKILL.md).
2. Run:

```bash
npm test
node bin/rdt.js --help
```

3. Launch the local React target:

```bash
cd test-app
npm run dev -- --host 127.0.0.1 --port 3000
```

4. In another shell, run:

```bash
node bin/rdt.js session open --url http://127.0.0.1:3000 --session app --timeout 10000
node bin/rdt.js tree get --session app
node bin/rdt.js node search App --session app
node bin/rdt.js node inspect <id-from-search-or-tree> --session app
node bin/rdt.js profiler start --session app
node bin/rdt.js profiler stop --session app
node bin/rdt.js profiler summary --session app
node bin/rdt.js profiler export --session app --compress
node bin/rdt.js session close --session app
```

Planned post-change shape:

```bash
node bin/rdt.js tree get --session app
# => returns snapshotId, roots, nodes
node bin/rdt.js node search App --session app --snapshot <snapshotId>
node bin/rdt.js node inspect <nodeId> --session app --snapshot <snapshotId>
node bin/rdt.js node highlight <nodeId> --session app --snapshot <snapshotId>
node bin/rdt.js source reveal <nodeId> --session app --snapshot <snapshotId>
```

5. If port binding, browser launch, or session RPC is blocked, rerun the affected command with sandbox escalation.

## Definition of Done for Next Session

- `rdt` still works against `test-app/` or another real React app with `reactDetected: true`.
- `tree get` returns a snapshot identifier and node IDs scoped to that snapshot.
- `node search`, `node inspect`, and `node highlight` resolve nodes correctly when given the same snapshot context.
- `source reveal` also resolves correctly with snapshot-aware lookup.
- snapshot behavior is documented clearly enough that users know when `--snapshot` is required, how long snapshots live, and what happens on expiry.
- profiler flow still captures at least one real React update after the node identity fix.
- any discovered defects are either fixed or documented in this file with exact repro steps.

## If You Need To Change Direction

- Update this file first.
- Record:
  - what changed
  - why it changed
  - what still works
  - what remains unverified
