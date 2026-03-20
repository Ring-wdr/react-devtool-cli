# Repo Workflows

## Repo Root Signals

- `package.json` has `"name": "react-devtool-cli"`.
- `bin/rdt.js` exists at the repo root.
- `test-app/` exists for browser-backed validation.

## Default Command Rules

- Run repository commands from the repo root.
- Prefer `node bin/rdt.js ...` over a globally installed `rdt`.
- Use `npm test` as the default regression check.
- Use `npm run build` before packaging checks.

## Browser Validation Target

- Use `test-app/` as the default local validation target.
- Start it with:

```bash
cd test-app
npm run dev -- --host 127.0.0.1 --port 3000
```

- Open a local inspection session from the repo root with:

```bash
node bin/rdt.js session open --url http://127.0.0.1:3000 --session app --timeout 10000
```

- Advanced session open options:
  - `--browser chromium|firefox|webkit` — defaults to chromium
  - `--engine auto|custom|devtools` — defaults to auto
  - `--channel <name>` — browser channel variant
  - `--device <name>` — device emulation profile
  - `--storage-state <path>` — saved browser state
  - `--user-data-dir <path>` — persistent browser data directory
  - `--headless=false` — launch with visible browser window

- Use `session attach` only when an external Chromium with CDP is already running.

## Session Management

- Check session state with `session status`:

```bash
node bin/rdt.js session status --session app
```

- Close a session when done:

```bash
node bin/rdt.js session close --session app
```

Close attempts graceful shutdown first, then force-kills the process tree as fallback.

## Validation Lanes

### Snapshot-aware inspection

- Start with `tree get`.
- Persist the returned `snapshotId`.
- Pass `--snapshot <id>` to `node search`, `node inspect`, `node highlight`, and `source reveal`.
- If `snapshot-expired` appears, collect a fresh tree and rerun lookup commands before trusting node ids.

### Interactive node selection

- Use `node pick` to let the user click a component in the browser:

```bash
node bin/rdt.js node pick --session app [--timeout-ms 30000]
```

Default timeout is 30 seconds. Returns the picked node details.

### Interaction

- Prefer built-in `interact click`, `interact type`, `interact press`, and `interact wait`.
- Keep selectors deterministic and CSS-based.
- Run `session doctor` first to confirm `supportsBuiltInInteract`.
- All interact commands accept optional `--timeout-ms <ms>` for element location timeout.

### Profiler

- Treat profiler output as commit-oriented analysis, not full DevTools frontend state.
- Use `profiler start [--profile-id <id>]`, `profiler stop`, `profiler summary`, `profiler commits`, `profiler commit`, `profiler ranked`, `profiler flamegraph`, and `profiler compare` for drill-down.
- Use `node inspect --commit <commitId>` only with profiler-local node ids from that commit.
- `flamegraph` does not support `--format yaml`.

### Profiler export

- Export recorded profiler events to NDJSON:

```bash
node bin/rdt.js profiler export --session app [--output file.jsonl] [--compress]
```

- `--compress` produces gzip-compressed `.jsonl.gz`.
- `--output` sets the file path; defaults to `<session>-<profileId>.jsonl` in the current directory.
- `export` does not support `--format yaml`.
- Exported files can be used as `--left` or `--right` inputs to `profiler compare`.

## Publish Checks

- Build with `npm run build`.
- Verify the package payload with:

```bash
npm pack --dry-run
npm publish --dry-run
```

- Expect publish artifacts to contain `dist/` and required metadata, not repo-only docs, `test-app/`, or handoff artifacts.
