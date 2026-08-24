# Release process — v0.1.0

This document defines the release discipline for ACR's first MVP tag.

## Release identity

- package/runtime version: `0.1.0`
- milestone: `M8`
- runtime status: `mvp-ready`
- default optimization mode: `guarded`
- distribution target: GitHub source release/tag
- npm publication: intentionally out of scope for v0.1.0

## Required automated checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
```

CI must pass on Node.js 20 and 22.

The compiled CLI must report:

```text
0.1.0
```

and `status --json` must contain:

```json
{
  "version": "0.1.0",
  "milestone": "M8",
  "mode": "guarded",
  "status": "mvp-ready"
}
```

## MVP gate audit

| Gate | v0.1.0 evidence |
| --- | --- |
| G1 `acr doctor` | capability registry + local unavailable-path validation |
| G2 classify ≥5 workloads | deterministic classifier regression suite |
| G3 precision/risk classification | exact/structural/semantic/secret-sensitive + risk mapping |
| G4 select ≥4 strategies | policy catalog routes among seven strategy adapters |
| G5 `NO_OPTIMIZATION` | policy + CLI + telemetry/dashboard regressions |
| G6 block pxpipe for exact data | policy and adapter defense-in-depth tests |
| G7 integrate ≥3 external engines | capability-aware typed adapter integrations for Serena, jCodeMunch, RTK, Context Mode, Token Optimizer, and pxpipe; real execution still requires an explicit host bridge |
| G8 decision/explanation logging | routing rationale + privacy-safe telemetry |
| G9 token measurement infrastructure | measured telemetry event schema and measured-only benchmark inputs; automatic provider token collection remains a post-v0.1.0 integration |
| G10 correctness protection | benchmark quality/success gate |
| G11 comparative report | measured A/B CLI report |
| G12 reproducible demo | self-contained synthetic evidence dashboard with explicit synthetic labeling |

## Evidence boundary

The tag must not imply that ACR has already achieved a measured project-wide token-saving percentage.

- policy saving ratios are estimates used by routing
- synthetic demo values are fixtures
- measured A/B inputs are accepted only when marked `source: measured`
- quality regression overrides token savings
- telemetry does not store raw task text by default

## External execution boundary

v0.1.0 ships the adapter contract, capability detection, routing, safety blocking, planning, and executor interface. Third-party tools are not silently installed. The default CLI does not fabricate or execute external MCP/CLI invocations without a supplied bridge.

## Final local checkpoint

Before merge/tag on macOS:

```bash
git switch feature/release-v0.1.0
git pull --ff-only origin feature/release-v0.1.0
npm install --no-package-lock
npm run release:check
node dist/cli/router.js doctor
node dist/cli/router.js demo dashboard --output /tmp/acr-v0.1.0-demo.html
open /tmp/acr-v0.1.0-demo.html
git status --short
```

Expected final state:

- release check succeeds
- `version` is `0.1.0`
- runtime status is `M8 / mvp-ready`
- demo opens and remains clearly labeled synthetic
- workspace is clean except intentionally ignored `.acr/` telemetry

## Tagging

Only after CP-LOCAL and explicit CP-MERGE approval:

1. squash merge the M8 release PR into `main`
2. verify CI on the merge commit
3. create annotated release tag `v0.1.0`
4. publish GitHub release notes from `CHANGELOG.md`
