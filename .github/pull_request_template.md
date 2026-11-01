<!-- PR title: Conventional Commits, e.g. "feat(ledger): add idempotency key to ledger entries" -->

## What

Short summary of the change.

## Why

Link to the Asana task + one sentence of context.

## How to test

Steps, or which tests cover it. Screenshots / a short video for UI changes.

## Notes

Contract changes, migrations, follow-ups, anything reviewers should look at first.

## Checklist

- [ ] Lint, type check and tests pass locally (`npm run lint && npm run typecheck && npm test`)
- [ ] Works against mocks (`npm run dev:mocks`); MSW handlers added/updated for new operations
- [ ] Tests added or updated
- [ ] `schema/` pulled and `src/gql/` regenerated if a backend contract changed (`npm run schema:pull && npm run codegen`)
- [ ] No secrets, tokens or personal data
