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
rdt node search App --session demo
rdt profiler start --session demo
rdt profiler stop --session demo
rdt profiler export --session demo --compress
```

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
- `profiler export` intentionally rejects `YAML`; use `profiler summary` for compact summaries
- Global CLI distribution is preferred; Playwright does not need to be pinned as a repo dependency
