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

## Validation Lanes

### Snapshot-aware inspection

- Start with `tree get`.
- Persist the returned `snapshotId`.
- Pass `--snapshot <id>` to `node search`, `node inspect`, `node highlight`, and `source reveal`.
- If `snapshot-expired` appears, collect a fresh tree and rerun lookup commands before trusting node ids.

### Interaction

- Prefer built-in `interact click`, `interact type`, `interact press`, and `interact wait`.
- Keep selectors deterministic and CSS-based.
- Run `session doctor` first to confirm `supportsBuiltInInteract`.

### Profiler

- Treat profiler output as commit-oriented analysis, not full DevTools frontend state.
- Use `profiler start`, `profiler stop`, `profiler summary`, `profiler commits`, `profiler commit`, `profiler ranked`, `profiler flamegraph`, and `profiler compare` for drill-down.
- Use `node inspect --commit <commitId>` only with profiler-local node ids from that commit.

## Publish Checks

- Build with `npm run build`.
- Verify the package payload with:

```bash
npm pack --dry-run
npm publish --dry-run
```

- Expect publish artifacts to contain `dist/` and required metadata, not repo-only docs, `test-app/`, or handoff artifacts.
