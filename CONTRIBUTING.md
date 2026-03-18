# Contributing

Thanks for contributing to `react-devtool-cli`.

## Maintainer Model

- This repository is maintained by one person.
- Review, triage, and releases happen on a best-effort basis.
- The bar for accepting new surface area is intentionally high. Features that increase long-term maintenance cost without clear user value may be declined.

## Before Opening An Issue

- Confirm you are on the latest published version.
- Read the current `README.md` and command semantics carefully.
- Reduce the report to a minimal, reproducible command sequence.
- Include concrete environment details:
  - `rdt --version`
  - OS and Node.js version
  - browser / transport mode
  - React version and app stack

## Good Issue Reports

- Bug reports should include exact commands, observed output, expected behavior, and whether the behavior is stable or intermittent.
- Feature requests should describe the user problem first, not just the proposed flag or command shape.
- Documentation issues should point to the exact section that is wrong, ambiguous, or outdated.

## Pull Requests

- Open an issue first for non-trivial behavior changes.
- Keep changes narrowly scoped.
- Add or update tests when behavior changes.
- Preserve the CLI's bias toward deterministic, structured output.
- Do not bundle unrelated refactors into the same PR.

## Development

```bash
npm ci
npm run build
npm test
```

## What To Expect

- Small bug fixes and documentation improvements are the easiest to review.
- Large feature PRs may sit until there is a clear maintenance story.
- Stale issues or PRs may be closed if they cannot be reproduced or do not have enough detail to act on.
