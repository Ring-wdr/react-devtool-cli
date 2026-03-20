# CLI Workflows

## Install and Invocation

- Requires Node.js >= 22.
- Install globally with `npm install -g react-devtool-cli`.
- If a global install is not desired, use `npx react-devtool-cli ...`.
- Confirm the CLI is available with:

```bash
rdt --help
```

## Session Lifecycle

### Opening a session

Use `session open` for the normal local Playwright path:

```bash
rdt session open --url <app-url> --session <name>
```

Full options for `session open`:

| Option | Default | Description |
|---|---|---|
| `--url <url>` | *required* | Target URL to open |
| `--browser chromium\|firefox\|webkit` | `chromium` | Browser engine |
| `--engine auto\|custom\|devtools` | `auto` | React inspection engine |
| `--channel <name>` | | Browser channel variant (e.g. `chrome`, `msedge`) |
| `--device <name>` | | Device profile name for emulation |
| `--storage-state <path>` | | Saved browser state file (cookies, localStorage) |
| `--user-data-dir <path>` | | Persistent browser data directory |
| `--headless=false` | `true` | Set `false` to launch visible browser |
| `--timeout <ms>` | `15000` | Connection timeout |
| `--session <name>` | auto-generated | Session identifier |
| `--format json\|yaml\|pretty` | `json` | Output format |

### Connecting to a remote Playwright instance

```bash
rdt session connect --ws-endpoint <ws> --target-url <app-url> --session <name>
```

Accepts `--browser`, `--engine`, `--target-url`, `--timeout`, `--session`, `--format`.

### Attaching to Chromium CDP

```bash
rdt session attach --cdp-url <http-url> --target-url <app-url> --session <name>
```

Chromium only. Accepts `--engine`, `--target-url`, `--timeout`, `--session`, `--format`.

### Checking session status

```bash
rdt session status --session <name>
```

Returns current session state including transport, browser, engine, and runtime readiness.

### Closing a session

```bash
rdt session close --session <name>
```

Attempts a graceful shutdown first; falls back to force-killing the session process tree if the server does not respond within 3 seconds.

## Inspection Workflow

```bash
rdt session doctor --session demo
rdt tree get --session demo
rdt node search App --session demo --snapshot <snapshotId>
rdt node inspect <nodeId> --session demo --snapshot <snapshotId>
rdt node highlight <nodeId> --session demo --snapshot <snapshotId>
rdt source reveal <nodeId> --session demo --snapshot <snapshotId>
```

- `tree get` returns `snapshotId`.
- Node ids are only meaningful within that snapshot.
- If `--snapshot` is omitted, commands fall back to the latest collected snapshot.
- If a requested snapshot was evicted, commands fail with `snapshot-expired`.

### Interactive node selection

```bash
rdt node pick --session demo [--timeout-ms 30000]
```

Lets the user click a component in the browser to select it. Returns the picked node details. Default timeout is 30 seconds.

## Interaction Workflow

- Prefer built-in interaction commands:
  - `rdt interact click --session <name> --selector <css> [--timeout-ms <ms>]`
  - `rdt interact type --session <name> --selector <css> --text <value> [--timeout-ms <ms>]`
  - `rdt interact press --session <name> --key <name> [--selector <css>] [--timeout-ms <ms>]`
  - `rdt interact wait --session <name> --ms <n>`
- Use `session doctor` to confirm `supportsBuiltInInteract` before relying on them.

## Profiler Workflow

```bash
rdt profiler start --session demo [--profile-id <id>]
rdt profiler stop --session demo
rdt profiler summary --session demo
rdt profiler commits --session demo
# => prefer primaryUpdateCommitId or a commit where commitKind=update
rdt profiler commit <commitId> --session demo
rdt profiler ranked <commitId> --session demo --limit 10
rdt profiler flamegraph <commitId> --session demo
rdt profiler compare --session demo --left baseline --right candidate
```

- `profiler start` accepts `--profile-id <id>` to assign a custom profile identifier; auto-generated if omitted.
- Treat profiler output as commit-oriented analysis.
- Treat `commitKind`, `isLikelyInitialMount`, `isInteractionCandidate`, `primaryUpdateCommitId`, and `recommendedCommitIds` as the first pass for commit selection.
- `profiler compare` accepts in-memory profile ids or exported `.jsonl` / `.jsonl.gz` file paths.
- `node inspect --commit <commitId>` expects profiler-local node ids from that commit, not snapshot ids from `tree get`.
- `flamegraph` does not support `--format yaml`.

### Exporting profiler data

```bash
rdt profiler export --session demo [--output file.jsonl] [--compress]
```

- Exports recorded profiler events as NDJSON (`.jsonl`).
- `--compress` writes gzip-compressed `.jsonl.gz`.
- `--output` sets the file path; defaults to `<session>-<profileId>.jsonl` in the current directory.
- `export` does not support `--format yaml`.

## Doctor and Trust Boundaries

- `session doctor` reports runtime readiness, React detection, profiler capability, interact support, and Playwright resolution.
- Read `recommendedWorkflow`, `unsafeConclusions`, `helperStrategy`, `observationLevel`, `limitations`, and `runtimeWarnings` literally.
- `helperImportTarget` exists for cases where `rdt` can resolve Playwright but standalone helper scripts cannot.

## Engine Selection

The `--engine` flag controls how `rdt` inspects the React tree:

| Engine | Behavior |
|---|---|
| `auto` | Tries the custom engine first, falls back to DevTools-aligned if unavailable |
| `custom` | Uses `rdt`'s own snapshot-diff inspection engine |
| `devtools` | Uses the DevTools-aligned hook-based engine |

Engine choice affects profiler capabilities, rerender reason attribution, and available metadata fields. Use `session doctor` to see which engine was actually selected (`selectedEngine`) and whether a fallback occurred (`engineFallback`).

## Output Formats

- Default output is `json`.
- Human-readable output supports `--format yaml` and `--format pretty`.
- `flamegraph` and `export` commands do not support `yaml`.
