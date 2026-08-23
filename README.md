# ACR — Adaptative Context Router

Adaptive context-engineering orchestrator for Claude Code. ACR routes, combines, and measures token-optimization strategies according to workload, context state, precision requirements, risk, and observed evidence.

## Core idea

There is no universally best token-saving technique. ACR treats optimization as a routing problem:

```text
Task → classify → assess context/risk → discover capabilities → score strategies → route → measure
```

The router must also be able to select **no optimization** when projected overhead or quality risk is greater than the expected saving.

## Development status

Current milestone: **M0 — Bootstrap**

M0 establishes:

- TypeScript + Node.js project scaffold
- `acr` CLI entrypoint
- core contracts for task profiles, context snapshots, capabilities, routing decisions, adapters, and telemetry
- Vitest test harness
- ESLint + strict TypeScript checks
- GitHub Actions CI on Node 20 and 22
- architecture, development workflow, and third-party integration policy

The first environment-aware feature, `acr doctor`, is planned for **M1 — Capability Registry**.

## CLI

```bash
npm install
npm run build
node dist/src/cli/index.js status
node dist/src/cli/index.js status --json
```

Expected M0 status:

```text
ACR — Adaptative Context Router
version: 0.0.0
milestone: M0
mode: guarded
status: bootstrap-ready
```

## Quality gates

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the checkpoint-based GitHub workflow.

## Design principles

- Optimize only when expected benefit exceeds overhead and risk.
- Keep measured and estimated savings separate.
- Use adapters instead of bundling every optimizer into one monolith.
- Make negative routing and `NO_OPTIMIZATION` first-class decisions.
- Default to guarded execution until evidence justifies broader automation.
- Never silently install third-party tools.

Third-party integration policy is tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT for the ACR core. Third-party tools retain their own licenses and are not automatically relicensed by this repository.
