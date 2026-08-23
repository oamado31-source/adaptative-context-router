# Development Workflow

ACR uses GitHub as the source of truth and milestone branches as validation boundaries.

## Branch model

- `main` — stable checkpoints only.
- `feature/bootstrap` — M0 bootstrap.
- `feature/capability-registry` — M1 capability discovery.
- `feature/task-classifier` — M2 task and precision/risk classification.
- `feature/policy-engine` — M3 explainable routing policy.
- `feature/adapters` — M4 specialist integrations.
- `feature/telemetry` — M5 accounting and decision evidence.
- `feature/benchmark-harness` — M6 paired A/B evaluation.
- `feature/dashboard` — M7 presentation dashboard and demo mode.

## Checkpoints

1. **CP-CODE** — typecheck, lint, unit tests and build pass in CI.
2. **CP-BEHAVIOR** — milestone behavior is covered by reproducible tests.
3. **CP-LOCAL** — only when behavior depends on a real Claude Code / MCP / hook environment.
4. **CP-MERGE** — review the milestone and merge to `main` only after required checks pass.

## Commit convention

Use concise conventional prefixes: `feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`.

## Local validation

After a branch reaches a local checkpoint:

```bash
git fetch origin
git checkout <branch>
git pull
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

M1 will add the first environment-dependent command: `acr doctor`.

## Security rules

- Never commit API keys or secrets.
- Never commit raw Claude session contents.
- Use synthetic fixtures for CI.
- Avoid absolute local paths in telemetry exports.
- Do not silently install third-party optimization tools.
