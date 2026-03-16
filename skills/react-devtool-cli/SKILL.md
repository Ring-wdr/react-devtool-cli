# react-devtool-cli

Use this skill when you need to inspect a live React app from an agent through `rdt`.

## Architecture

- `rdt` owns Playwright directly through the Node API
- Prefer `rdt session open` as the default path
- Use `rdt session connect` for a Playwright `wsEndpoint`
- Use `rdt session attach` only for Chromium CDP compatibility

## Preconditions

- `rdt` is available on `PATH`
- A Playwright runtime is available through one of:
  - local `playwright`
  - local `playwright-core`
  - global `playwright`
  - global `playwright-core`
  - `RDT_PLAYWRIGHT_PATH`

## Recommended flow

1. Start a session with the transport that matches your environment.

```bash
rdt session open --url http://localhost:3000 --session app
```

Use `connect` when you already have a Playwright server endpoint.

```bash
rdt session connect --ws-endpoint ws://127.0.0.1:3000/ --target-url localhost:3000 --session app
```

Use `attach` only for Chromium CDP fallback.

```bash
rdt session attach --cdp-url http://127.0.0.1:9222 --target-url localhost:3000 --session app
```

2. Read the tree and find a target component.

```bash
rdt tree get --session app
rdt node search App --session app --snapshot <snapshotId>
```

3. Inspect a node in detail.

```bash
rdt node inspect n1 --session app --snapshot <snapshotId>
rdt source reveal n1 --session app --snapshot <snapshotId>
```

4. For compact human review, switch output format.

```bash
rdt profiler summary --session app --format yaml
```

5. For large profiler payloads, export NDJSON instead of YAML.

```bash
rdt profiler start --session app
rdt profiler stop --session app
rdt profiler export --session app --compress
```

6. Close the session when finished.

```bash
rdt session close --session app
```

## Rules

- Use `JSON` as the default machine interface.
- Treat `tree get` as the start of a lookup cycle and persist its `snapshotId`.
- Prefer explicit `--snapshot <id>` on follow-up node and source commands.
- If `snapshot-expired` is returned, collect a fresh tree and do not reuse old node IDs.
- Use [docs/devtools-concept-mapping.md](/Users/kimmanjoong/private-project/rdt-cli/docs/devtools-concept-mapping.md) when you need to compare current payload semantics to official DevTools concepts.
- Use `YAML` only for compact summaries.
- Do not request `YAML` for raw profiler export.
- Prefer `open` over `connect`, and prefer `connect` over `attach`.
- Do not wrap `rdt` around another CLI subprocess for browser control; `rdt` should speak to Playwright directly.
