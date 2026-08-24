# Release process — v0.2.0

This document defines the release discipline for ACR v0.2.0, the evidence-gated adaptive routing release covering M9 through M13.

## Release identity

- package/runtime version: `0.2.0`
- milestone: `M13`
- runtime status: `adaptive-ready`
- default optimization mode: `guarded`
- distribution target: GitHub source release/tag
- npm publication: intentionally out of scope for v0.2.0

## Required automated checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
```

The main CI must pass on Node.js 20 and 22. The dedicated Adaptive Routing Smoke must also pass on Node.js 20 and 22.

The compiled CLI must report:

```text
0.2.0
```

and `status --json` must contain:

```json
{
  "version": "0.2.0",
  "milestone": "M13",
  "mode": "guarded",
  "status": "adaptive-ready"
}
```

## v0.2.0 gate audit

| Gate | v0.2.0 evidence |
| --- | --- |
| M9 real execution bridges | Serena MCP and RTK real local bridge validation; explicit process boundaries and no rewritten-command execution |
| M10 provider measurement | real Claude Code structured result imported locally; provider tokens/cache/latency/turn metadata captured; raw response/session not persisted |
| M10 cost provenance | Claude Code `total_cost_usd` remains `estimatedCostUsd` / `claude-code-client-estimate`; it is not promoted to measured billing cost |
| M11 real corpus | `real-v1` pinned to a real repository revision with six reproducible workloads, quality rubrics, routing context, and `NO_OPTIMIZATION` controls |
| M11 evidence boundary | corpus validation does not execute Claude Code/adapters and does not claim token savings |
| M12 calibration | measured-only advisory calibration with promote/hold/demote/insufficient-evidence outcomes and sample thresholds |
| M12 quality protection | quality regression overrides token savings and prevents promotion |
| M12 policy immutability | `policyMutation: false`; `--apply` rejected; no automatic writes to `policies/default.yaml` |
| M13 explicit approval | adaptive profile creation fails without `--approve` and leaves no artifact |
| M13 in-memory adaptation | approved profile tunes/block strategies on an in-memory policy copy; default routing remains unchanged without a profile |
| M13 hard block | a quality-regressed strategy cannot be selected, while unrelated safe fallbacks remain eligible |
| M13 base safety | precision/risk/capability/context/minimum-utility rules and secret-sensitive `NO_OPTIMIZATION` remain authoritative |
| M13 telemetry provenance | profile ID/fingerprint/rule count/tuned/blocked IDs recorded without raw profile path/rationale |
| M13 policy immutability | local and CI checks confirm unchanged base policy hash/diff after adaptive routing |

## Evidence boundary

The v0.2.0 tag must not imply that ACR has already achieved a measured project-wide token-saving percentage.

- policy saving ratios are routing estimates
- provider measurements report what the provider client exposes; provider client cost estimates are not billed-cost proof
- `real-v1` is a reproducible workload definition, not an A/B result
- calibration accepts measured benchmark evidence only and remains advisory
- adaptive profiles require explicit approval and are not autonomous learning
- synthetic CI/test/demo values validate mechanics only
- quality regression overrides apparent savings
- telemetry does not store raw task text by default and provider ingestion does not persist raw Claude response/session IDs

## External execution boundary

v0.2.0 includes explicit real bridge surfaces for Serena MCP and RTK. Third-party tools are not silently installed. Bridge operations are explicit, and RTK rewrite output is never automatically executed as a shell command.

Other adapters retain their guarded planning/integration boundaries unless a supported explicit executor is provided.

## Adaptive routing boundary

Adaptive routing is opt-in:

1. measured benchmark evidence is analyzed by M12
2. calibration remains advisory and does not mutate policy
3. a profile is created only with explicit `--approve`
4. routing/planning uses that profile only when `--adaptive-profile <file>` is supplied
5. the overlay is applied to an in-memory policy copy
6. the normal `PolicyEngine` performs routing with all base safety rules still active

There is no background learning loop and no automatic self-modification of `policies/default.yaml`.

## Final local checkpoint

Before merge/tag on macOS:

```bash
git fetch origin
git switch release/v0.2.0
git pull --ff-only origin release/v0.2.0
npm install --no-package-lock
npm run release:check
node dist/cli/router.js version
node dist/cli/router.js status --json
node dist/cli/router.js doctor
node dist/cli/router.js benchmark corpus validate --file benchmarks/corpus/real-v1.json --json
node dist/cli/router.js calibrate help
node dist/cli/router.js adaptive help
npm test -- --run tests/release-contract.test.ts tests/bootstrap-status.test.ts tests/adaptive-routing.test.ts tests/adaptive-cli.test.ts
git status --short
```

Expected final state:

- release check succeeds
- `version` is `0.2.0`
- runtime identity is `M13 / adaptive-ready / guarded`
- real corpus manifest validates without execution
- calibration help preserves the advisory/no-policy-mutation boundary
- adaptive help preserves explicit approval and opt-in profile usage
- focused release/adaptive tests pass
- workspace is clean except intentionally ignored local telemetry artifacts

The final release checkpoint does **not** require running Claude Code or any external third-party bridge. Provider and bridge behavior were validated in their milestone checkpoints; the release candidate verifies integration and identity without incurring external execution or provider cost.

## Merge, tag, and GitHub release

Only after CP-LOCAL and explicit CP-MERGE approval:

1. squash merge the v0.2.0 release PR into `main` with an expected-head SHA guard
2. verify `main` points to the release merge commit
3. verify CI on the merged state
4. create annotated tag `v0.2.0` at the verified release commit
5. publish the GitHub release using the v0.2.0 section of `CHANGELOG.md`

Do not tag a release-branch commit before merge. The tag must identify the verified `main` release commit.
