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
- Real browser launch was verified once with:

```bash
node bin/rdt.js session open --url data:text/html,%3Chtml%3E%3Cbody%3Ehello%3C/body%3E%3C/html%3E --session smoke-open-escalated --timeout 5000
node bin/rdt.js session status --session smoke-open-escalated
node bin/rdt.js session close --session smoke-open-escalated
```

- The smoke page was not a React app, so `reactDetected` was correctly `false`.
- `session connect` error path was verified against an invalid endpoint and returned a structured failure.

## Important Constraints

- Browser launch may require sandbox escalation in this environment.
- `attach` is Chromium-only and lower fidelity than Playwright protocol transport.
- Current React inspection uses a custom runtime script, not `react-devtools-core` yet.
- Session state is stored under `.react-devtool-cli/sessions` in the repo by default.

## Next Priority

Primary next milestone:

- validate `rdt` against a real React page and fix runtime gaps

Concrete tasks:

1. Create or run a minimal React test page locally.
2. Verify `rdt session open --url <react-app>` returns `reactDetected: true`.
3. Verify `rdt tree get` returns stable roots and nodes.
4. Verify `rdt node inspect <id>` returns meaningful `props`, `state`, `hooks`, `context`, `source`, and `dom`.
5. Verify `rdt profiler start/stop/summary/export` captures commit data during React updates.
6. Fix any hook injection or fiber traversal bugs found during the real-app run.

## Suggested Execution Order

1. Re-read [TASK.md](./TASK.md), [README.md](./README.md), and [skills/react-devtool-cli/SKILL.md](./skills/react-devtool-cli/SKILL.md).
2. Run:

```bash
npm test
node bin/rdt.js --help
```

3. Launch a real React target.
4. Run:

```bash
node bin/rdt.js session open --url http://localhost:3000 --session app --timeout 10000
node bin/rdt.js tree get --session app
node bin/rdt.js node search App --session app
node bin/rdt.js profiler start --session app
node bin/rdt.js profiler stop --session app
node bin/rdt.js profiler summary --session app
node bin/rdt.js profiler export --session app --compress
node bin/rdt.js session close --session app
```

5. If browser launch is blocked, rerun the launch command with sandbox escalation.

## Definition of Done for Next Session

- `rdt` works against a real React app with `reactDetected: true`.
- `tree get` and `node inspect` return credible data from that app.
- profiler flow captures at least one real React update.
- any discovered defects are either fixed or documented in this file with exact repro steps.

## If You Need To Change Direction

- Update this file first.
- Record:
  - what changed
  - why it changed
  - what still works
  - what remains unverified
