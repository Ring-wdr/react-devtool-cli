# react-devtool-cli

Agent-first CLI for inspecting React applications through a Playwright-managed Chromium session.

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
rdt session open --url http://localhost:3000 --browser chromium --session demo
rdt session connect --ws-endpoint ws://127.0.0.1:3000/ --target-url localhost:3000 --session remote
rdt session attach --cdp-url http://127.0.0.1:9222 --target-url localhost:3000 --session cdp
rdt tree get --session demo
rdt node search App --session demo --snapshot <snapshotId>
rdt node inspect <nodeId> --session demo --snapshot <snapshotId>
rdt profiler start --session demo
rdt profiler stop --session demo
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

Performance triage flow:

```bash
rdt session open --url http://localhost:3000 --session app
rdt tree get --session app
# => save snapshotId from output as SNAPSHOT_A
rdt node search SearchResults --session app --snapshot SNAPSHOT_A
rdt node inspect <nodeId> --session app --snapshot SNAPSHOT_A
rdt profiler start --session app
# reproduce the slow interaction in the browser
rdt profiler stop --session app
rdt profiler summary --session app
rdt profiler export --session app --compress
rdt tree get --session app
# => save new snapshotId as SNAPSHOT_B
rdt node search SearchResults --session app --snapshot SNAPSHOT_B
rdt node inspect <nodeId> --session app --snapshot SNAPSHOT_B
```

Use this flow when an agent needs to answer:

- whether a user action produced more commits than expected
- whether a suspected component changed `props`, `state`, `hooks`, or `context`
- whether the update appears localized or broad across the tree

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

- `tag` is the numeric React fiber tag.
- `tagName` is the human-readable label derived from that fiber tag.
- `ownerStack` is a lightweight owner chain for CLI output, not a full stack frame model.
- `hooks` is a simplified serialized view of hook state from the inspected fiber.
- `context` is a serialized view of current context dependencies for the inspected node.
- `source` projects `_debugSource` when available; `null` is expected in many dev builds.
- `dom` is the first host element summary used for CLI highlight and DOM-oriented inspection.
- Profiler summary fields are commit-oriented CLI metrics, not the full DevTools profiler session schema.

## Concept Alignment

- Current runtime design note: [docs/devtools-concept-mapping.md](/Users/kimmanjoong/private-project/rdt-cli/docs/devtools-concept-mapping.md)
- `react-devtools-core` is the primary reference package for concept comparison.
- `react-debug-tools` is installed as a dev-only reference but is currently a low-value implementation reference in this repo state.

## Output formats

- Default command output is `JSON`
- Compact human-readable output supports `--format yaml` and `--format pretty`
- Raw profiler export is `NDJSON` (`.jsonl`) or `jsonl.gz` with `--compress`

## Skill

- Repository skill: [skills/react-devtool-cli/SKILL.md](/C:/Users/김만중/private/react-devtool-cli/skills/react-devtool-cli/SKILL.md)
- Session handoff: [TASK.md](/C:/Users/김만중/private/react-devtool-cli/TASK.md)

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
