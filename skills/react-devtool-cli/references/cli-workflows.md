# CLI Workflows

## Install and Invocation

- Install globally with `npm install -g react-devtool-cli`.
- If a global install is not desired, use `npx react-devtool-cli ...`.
- Confirm the CLI is available with:

```bash
rdt --help
```

## Session Selection

- Use `rdt session open --url <app-url> --session <name>` for the normal local path.
- Use `rdt session connect --ws-endpoint <ws> --target-url <app-url> --session <name>` when Playwright is already running remotely.
- Use `rdt session attach --cdp-url <http-url> --target-url <app-url> --session <name>` only for an existing Chromium CDP target.

## Inspection Workflow

```bash
rdt session doctor --session demo
rdt tree get --session demo
rdt node search App --session demo --snapshot <snapshotId>
rdt node inspect <nodeId> --session demo --snapshot <snapshotId>
```

- `tree get` returns `snapshotId`.
- Node ids are only meaningful within that snapshot.
- If `--snapshot` is omitted, commands fall back to the latest collected snapshot.
- If a requested snapshot was evicted, commands fail with `snapshot-expired`.

## Interaction Workflow

- Prefer built-in interaction commands:
  - `rdt interact click --session <name> --selector <css>`
  - `rdt interact type --session <name> --selector <css> --text <value>`
  - `rdt interact press --session <name> --key <name> [--selector <css>]`
  - `rdt interact wait --session <name> --ms <n>`
- Use `session doctor` to confirm `supportsBuiltInInteract` before relying on them.

## Profiler Workflow

```bash
rdt profiler start --session demo
rdt profiler stop --session demo
rdt profiler summary --session demo
rdt profiler commits --session demo
rdt profiler commit <commitId> --session demo
rdt profiler ranked <commitId> --session demo --limit 10
rdt profiler flamegraph <commitId> --session demo
rdt profiler compare --session demo --left baseline --right candidate
```

- Treat profiler output as commit-oriented analysis.
- `profiler compare` accepts in-memory profile ids or exported `.jsonl` / `.jsonl.gz` files.
- `node inspect --commit <commitId>` expects profiler-local node ids from that commit.

## Doctor and Trust Boundaries

- `session doctor` reports runtime readiness, React detection, profiler capability, interact support, and Playwright resolution.
- Read `recommendedWorkflow`, `unsafeConclusions`, `helperStrategy`, `observationLevel`, `limitations`, and `runtimeWarnings` literally.
- `helperImportTarget` exists for cases where `rdt` can resolve Playwright but standalone helper scripts cannot.

## Output Formats

- Default output is `json`.
- Human-readable output supports `--format yaml` and `--format pretty`.
- Raw profiler export is NDJSON as `.jsonl` or `.jsonl.gz` with `--compress`.
