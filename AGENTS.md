# Agent Instructions

This repository is maintained under strict branch protection. Treat those protections as part of the repository policy, not as temporary friction to work around.

## Branch Protection Policy

- Never change branch protection rules, rulesets, required reviews, required status checks, or admin enforcement in order to land a change unless the user explicitly asks for that exact repository-governance change.
- Never disable `CODEOWNERS` review requirements, required approving review counts, required conversation resolution, or required CI checks just to merge a PR.
- Never push directly to a protected branch to bypass the normal review or CI path.
- Never use admin merge, force push, or equivalent bypass mechanisms to land a change unless the user explicitly asks for that governance exception.
- If branch protection blocks a merge, stop and tell the user what requirement is still unmet.

## Preferred Flow

1. Make the change on a feature branch.
2. Open a PR.
3. Let required CI checks complete.
4. Wait for the required review state.
5. Merge only through the normal repository policy path.

## If Blocked

- Report the exact protection rule that is blocking progress.
- Ask the user whether they want to satisfy the rule or intentionally change repository governance.
- Treat repository-governance changes as a separate task from the feature or docs change that triggered the block.
