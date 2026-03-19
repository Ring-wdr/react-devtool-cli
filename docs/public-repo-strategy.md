# Public Repository Strategy

This repository is run as a solo-maintainer open source project. The operating model is deliberately simple so the project can stay useful without creating an unsustainable review and support burden.

## 1. Scope Control

- Keep the public API small and explicit.
- Favor commands and response fields that are deterministic and agent-friendly.
- Treat feature requests as proposals, not commitments.
- Prefer documentation and diagnostics over adding new flags when the same user problem can be solved with clearer workflows.

## 2. Triage Model

- Bugs with a minimal reproduction get first priority.
- Regressions in existing CLI behavior outrank new feature work.
- Windows, Node, React, and Playwright version details are required for environment-sensitive reports.
- Issues without enough detail to reproduce may be closed after follow-up.

## 3. Release Strategy

- Keep releases small and incremental.
- Require a green CI run plus local maintainer confidence before publishing.
- Prefer shipping focused fixes quickly over batching unrelated changes into larger releases.
- When behavior changes materially, update `README.md` in the same change.

## 4. Contribution Policy

- Accept bug fixes, docs improvements, and narrowly scoped maintainability improvements most readily.
- Review larger features only when the long-term maintenance cost is clear and acceptable.
- Use squash merges to keep history readable.
- Delete merged branches to reduce repository clutter.

## 5. Support Boundary

- The repository is not a general consulting channel for Playwright, React DevTools internals, or app-specific performance debugging.
- Best-effort support is limited to the CLI's documented behavior.
- Non-actionable support requests should be redirected toward reproducible issues or clearer documentation gaps.

## 6. Automation Baseline

- Run CI on push and pull request for the default branch.
- Validate the build and test suite on both Linux and Windows because session/runtime behavior can be platform-sensitive.
- Keep automation intentionally lightweight; avoid adding bots that create more inbox traffic than value.

## 7. Repository Defaults

- Public visibility
- Issues enabled
- Wiki disabled
- Projects disabled
- Discussions disabled unless issue volume justifies a separate support channel
- Secret scanning enabled when available
- Topic metadata kept current so the repo is discoverable without overselling scope

## 8. Governance Guardrails

- Branch protection is part of the maintenance policy, not a convenience setting.
- Do not reduce required reviews, required checks, or code owner enforcement just to land an otherwise-ready PR.
- Do not use admin overrides for normal day-to-day maintenance.
- If a branch protection rule becomes counterproductive, change that governance intentionally in a separate maintainer decision, not as part of shipping an unrelated fix.
