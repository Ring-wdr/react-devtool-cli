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
- `profiler export` intentionally rejects `YAML`; use `profiler summary` for compact summaries
- Global CLI distribution is preferred; Playwright does not need to be pinned as a repo dependency
