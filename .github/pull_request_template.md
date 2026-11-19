## Problem and resulting behavior

Describe the trigger, current behavior and change. Link a relevant issue if one exists.

## Validation

List the checks actually run and their outcome (`npm run typecheck`, `npm test`). For docs, include links/anchors
and visual review. Distinguish source tests, artifact checks, installed smoke and
live payment acceptance; mark unverified layers explicitly.
If you changed `src/`, confirm that you ran `npm run build` and committed the regenerated `dist/` files.

## Payment or custody boundaries, if affected

Explain changes to approvals, frozen facts, idempotency, durable state, replay
rules or provider custody. Omit this section when it does not apply. Do not
attach signing material, credentials or raw provider authentication output.
