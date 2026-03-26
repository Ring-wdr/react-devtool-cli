# Workflows

This page is the fastest path from zero context to a useful `rdt` session.

## Install

```bash
npm install -g react-devtool-cli
```

`rdt` resolves Playwright from the local project first, then falls back through `playwright-core`, `RDT_PLAYWRIGHT_PATH`, and global installs.

## Choose the right session mode

| Command | Use when | Notes |
| --- | --- | --- |
| `rdt session open` | You want `rdt` to launch and own the browser locally | Recommended default path |
| `rdt session connect` | You already have a Playwright `wsEndpoint` | Remote-friendly, keeps Playwright fidelity |
| `rdt session attach` | You only have Chromium CDP access | Compatibility path, lower fidelity than Playwright protocol |

## Quick start

```bash
rdt session open --url http://localhost:3000 --browser chromium --engine auto --session demo
rdt tree get --session demo
rdt tree stats --session demo --top 5
rdt node search App --session demo --snapshot <snapshotId> --structured
rdt node inspect <nodeId> --session demo --snapshot <snapshotId>
```

If you only remember one rule, remember this one: `tree get` starts the inspection cycle, and the returned `snapshotId` should follow later lookup commands.

## Snapshot-aware inspection

- `tree get` returns a `snapshotId`.
- Node ids are only guaranteed to be meaningful inside that snapshot.
- If you omit `--snapshot`, `rdt` falls back to the latest collected snapshot.
- If a requested snapshot has been evicted from the in-memory cache, the command fails with `snapshot-expired`.

Recommended flow:

```bash
rdt tree get --session demo
rdt tree stats --session demo --top 5
rdt node search App --session demo --snapshot <snapshotId> --structured
rdt node highlight <nodeId> --session demo --snapshot <snapshotId>
rdt source reveal <nodeId> --session demo --snapshot <snapshotId> --structured
```

- `tree stats` is the lightweight summary path when `tree get --format json` is too heavy.
- `node search --structured` keeps the default array-returning behavior opt-in while adding `matchCount`, `returnedCount`, `truncated`, and `runtimeWarnings`.
- `source reveal --structured` returns availability metadata instead of only raw `null`.

Recovery flow:

```bash
rdt tree get --session demo
# save the new snapshotId
rdt node search App --session demo --snapshot <newSnapshotId>
```

## Run `doctor` before deeper investigation

```bash
rdt doctor --session demo
rdt session doctor --session demo
```

Use it to confirm:

- React was detected
- which engine was selected
- whether built-in `interact` helpers are supported
- whether profiler and source-reveal capabilities are trustworthy for the current runtime

## Interact before profiling

Built-in interactions keep the investigation inside the same session instead of forcing separate helper scripts.

```bash
rdt interact click --session demo --role button --nth 0 --delivery auto
rdt interact type --session demo --target-text 'Filter inventory' --text hello
rdt interact wait --session demo --ms 500
```

- `interact click --delivery auto` uses Playwright pointer input by default.
- When the profiler is active, `auto` may fall back to DOM dispatch and reports the applied delivery in the response payload.
- Use one targeting mode per click: `--selector`, `--text`, or `--role`.
- `interact type` and targeted `interact press` accept `--selector`, `--target-text`, or `--role`.
- `interact press --key <name>` without a target remains a page-level keyboard action and depends on the browser's current focus state.
- Add `--nth` to choose one match from a broader result set, or `--strict` to require exactly one match.
- For `interact type` and targeted `interact press`, `--strict` and `--nth` require an explicit target.

After interaction, verify the app settled by collecting a fresh tree or reading profiler output instead of assuming the UI state changed correctly.

## Profile a real update

```bash
rdt profiler start --session demo
rdt interact type --session demo --target-text 'Filter inventory' --text hello
rdt profiler stop --session demo
rdt profiler summary --session demo
rdt profiler ranked <commitId> --session demo --limit 10
rdt profiler export --session demo --compress
```

Read profiler output literally:

- `commitCount` tells you how many commits were captured
- `nodeCount` fields describe live tree size at commit time, not exact rerender counts
- `primaryUpdateCommitId` and `recommendedCommitIds` are better drill-down targets than blindly reading the first commit

## Close the loop cleanly

```bash
rdt session close --session demo
```

Treat sessions as explicit resources. Close them when the investigation is over so later runs start from a known state.
