# ACR — Adaptative Context Router

**v0.2.0** · Evidence-gated adaptive context-engineering router for Claude Code workflows.

ACR classifies work, evaluates precision/risk and context pressure, discovers optimization capabilities, chooses a strategy or `NO_OPTIMIZATION`, builds safe execution plans, records privacy-safe telemetry, ingests provider measurements, validates reproducible benchmark workloads, analyzes measured evidence, and can apply an explicitly approved adaptive routing profile in memory.

> **Evidence boundary:** routing saving ratios are estimates used by policy. ACR does **not** claim project-wide token savings unless supported by measured benchmark evidence that passes the quality gate. Synthetic fixtures validate mechanics only.

## Core thesis

There is no universally best token-saving technique. ACR treats optimization as a routing problem:

```text
TASK
  ↓
TASK / PRECISION / RISK CLASSIFIER
  ↓
CONTEXT + CAPABILITY ANALYSIS
  ↓
BASE POLICY ENGINE
  ↓
STRATEGY OR NO_OPTIMIZATION
  ↓
PLAN / EXPLICIT BRIDGE
  ↓
PRIVACY-SAFE TELEMETRY + PROVIDER MEASUREMENT
  ↓
MEASURED A/B EVIDENCE
  ↓
ADVISORY CALIBRATION
  ↓
EXPLICITLY APPROVED ADAPTIVE PROFILE
  ↓
IN-MEMORY POLICY OVERLAY + NORMAL POLICY ENGINE
```

The central rule is:

> **Optimize only when expected benefit exceeds expected overhead and risk.**

`NO_OPTIMIZATION` is a first-class result. Quality and safety constraints remain authoritative even when a strategy appears to save tokens.

## What v0.2.0 adds

v0.2.0 extends the v0.1.0 router + evidence MVP with the M9–M13 evidence-to-adaptation path:

- **M9 — Real Execution Bridges:** explicit Serena MCP and RTK bridges with safe process boundaries; ACR never silently installs tools or executes an RTK-rewritten shell command.
- **M10 — Provider Measurement:** import Claude Code structured JSON results and retain provider-reported token/cache/latency/turn metadata with explicit provenance. Claude Code `total_cost_usd` remains a client-side estimate, not measured billing evidence.
- **M11 — Real Benchmark Corpus:** a pinned `real-v1` workload manifest with reproducibility controls, quality rubrics, and `NO_OPTIMIZATION` controls. The corpus defines experiments; it does not itself prove savings.
- **M12 — Evidence-driven Policy Calibration:** measured-only advisory analysis producing `promote`, `hold`, `demote`, or `insufficient-evidence`. Quality regression overrides token savings. Calibration cannot mutate `policies/default.yaml`.
- **M13 — Adaptive Routing:** explicitly approved measured-evidence profiles can tune strategy saving estimates or hard-block quality-regressed strategies on an in-memory policy copy. Base precision/risk/capability/context/utility rules remain authoritative.

## Current safety boundaries

ACR deliberately avoids turning adaptation into unattended self-modification:

- normal routing is unchanged unless `--adaptive-profile <file>` is supplied
- profile creation requires explicit `--approve`
- profiles must declare measured M12 provenance and sufficient evidence
- adaptive changes are applied to an in-memory copy of policy configuration
- `policies/default.yaml` is never automatically rewritten
- quality-regressed strategies can be hard-blocked even when token reduction is positive
- blocking one strategy does not disable other safe base-policy fallbacks
- secret-sensitive `NO_OPTIMIZATION`, precision blocks, capability requirements, context thresholds, and minimum utility remain authoritative
- no background learning loop is enabled
- third-party tools are never silently installed
- raw Claude Code response text and raw session IDs are not persisted by provider measurement ingestion

## Quick start

Requirements:

- Node.js 20 or newer
- npm

```bash
git clone https://github.com/oamado31-source/adaptative-context-router.git
cd adaptative-context-router
npm install --no-package-lock
npm run build
node dist/cli/router.js help
```

Optional local command registration:

```bash
npm link
acr help
```

## Release identity

```bash
node dist/cli/router.js version
node dist/cli/router.js status --json
```

Expected v0.2.0 identity:

```text
version: 0.2.0
milestone: M13
status: adaptive-ready
mode: guarded
```

## Routing and planning

Classify:

```bash
node dist/cli/router.js classify \
  "Find where authenticateUser is defined."
```

Route:

```bash
node dist/cli/router.js route \
  --context-ratio 0.61 \
  --available serena,jcodemunch \
  "Find where authenticateUser is defined."
```

Build a safe plan:

```bash
node dist/cli/router.js plan \
  --context-ratio 0.61 \
  --available serena \
  "Find where authenticateUser is defined."
```

Without an explicit real bridge, an external adapter remains planning-safe.

## Real execution bridges

Supported explicit bridge surfaces include Serena MCP and RTK. Examples:

```bash
node dist/cli/router.js bridge help
node dist/cli/router.js bridge serena --help
node dist/cli/router.js bridge rtk --help
```

RTK rewriting is treated as a transformation step: ACR does not execute the rewritten shell command.

## Provider measurement ingestion

Run Claude Code yourself and save a structured result, then import it into an existing ACR telemetry run:

```bash
node dist/cli/router.js measurement import-claude \
  --file /tmp/claude-result.json \
  --run <acr-run-id> \
  --json
```

ACR records provider-reported input/output/cache tokens, latency, optional API latency, turns, success, and a SHA-256 session fingerprint when available. Raw response text and raw session IDs are not persisted.

`total_cost_usd`, when supplied by Claude Code, is kept as `estimatedCostUsd` with `claude-code-client-estimate` provenance. It is not promoted to measured/billed `costUsd`.

## Real benchmark corpus

Validate the pinned real workload definition:

```bash
node dist/cli/router.js benchmark corpus validate \
  --file benchmarks/corpus/real-v1.json
```

The validator checks reproducibility and evidence controls only. It does not execute Claude Code, run adapters, or claim token savings.

## Compare measured A/B observations

```bash
node dist/cli/router.js benchmark compare \
  --file benchmark.json
```

Benchmark observations must declare:

```json
"source": "measured"
```

A token reduction is reported as `quality-regression` when success/quality falls outside the case tolerance.

## Evidence-driven calibration

Analyze multiple measured benchmark cases:

```bash
node dist/cli/router.js calibrate analyze \
  --file benchmark-a.json \
  --file benchmark-b.json \
  --json
```

Calibration is advisory only. It cannot apply changes automatically and rejects `--apply`.

Possible dispositions:

- `promote`
- `hold`
- `demote`
- `insufficient-evidence`

## Approved adaptive profiles

Create a profile from measured M12 calibration output only after explicit approval:

```bash
node dist/cli/router.js adaptive profile create \
  --calibration calibration-report.json \
  --id measured-profile-v1 \
  --output adaptive-profile.json \
  --approve \
  --json
```

Inspect it:

```bash
node dist/cli/router.js adaptive profile inspect \
  --file adaptive-profile.json \
  --json
```

Opt in during routing or planning:

```bash
node dist/cli/router.js route \
  --adaptive-profile adaptive-profile.json \
  --context-ratio 0.61 \
  --available serena,jcodemunch \
  "Find where authenticateUser is defined."
```

The profile modifies an in-memory policy copy and then the normal `PolicyEngine` re-ranks candidates. It does not bypass safety rules or rewrite the base policy.

## Telemetry

Record a run:

```bash
node dist/cli/router.js plan \
  --record \
  --context-ratio 0.61 \
  --available serena \
  "Find where authenticateUser is defined."

node dist/cli/router.js telemetry summary --json
```

Raw task text is not stored by default; telemetry uses a SHA-256 task fingerprint plus structured metadata. Adaptive decisions add compact profile provenance (ID, fingerprint, applied rules, tuned/blocked strategy IDs) without storing the raw profile path or rationale.

## Evidence dashboard

Local evidence:

```bash
node dist/cli/router.js dashboard build \
  --output /tmp/acr-dashboard.html
```

Synthetic reproducible demo:

```bash
node dist/cli/router.js demo dashboard \
  --output /tmp/acr-demo-dashboard.html
```

The demo is visibly labeled `SYNTHETIC DEMO`; fixture numbers must not be treated as project performance evidence.

## Supported strategies and execution status

| Adapter / strategy | Primary workload | v0.2.0 behavior |
| --- | --- | --- |
| Native Claude progressive disclosure | code/repository/long-context work | local guidance, low overhead fallback |
| Serena | targeted code search / repository exploration | typed plan + explicit real MCP bridge |
| jCodeMunch | targeted code search / repository exploration | typed AST/symbol plan |
| RTK | large logs | typed plan + explicit real rewrite bridge; rewritten command is not executed |
| Context Mode | logs / structured data | guarded external plan; exact/secret-sensitive work blocked |
| Token Optimizer MCP | logs / structured / implementation / debugging | guarded external plan |
| pxpipe | semantic long context | guarded external plan; structural/exact/secret-sensitive work blocked |

## Evidence discipline

ACR separates these concepts deliberately:

1. **Estimated saving** — policy input used for routing.
2. **Provider-reported measurement** — structured token/cache/latency metadata imported from a provider client.
3. **Measured benchmark observation** — A/B evidence used by the benchmark/calibration path.
4. **Real benchmark corpus** — reproducible workload definition, not a measured result.
5. **Synthetic fixture** — deterministic CI/test/demo data, never a production performance claim.
6. **Adaptive profile** — explicitly approved runtime overlay derived from measured calibration evidence, not autonomous learning.

## Development and release checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
```

CI covers Node.js 20 and 22. The main quality workflow validates release identity and M0–M12 smoke surfaces; the dedicated Adaptive Routing Smoke validates approved-profile creation, tuning, quality hard blocks, safe fallback preservation, telemetry provenance, and base-policy immutability.

## Milestones

- M0 Bootstrap ✅
- M1 Capability Registry ✅
- M2 Task / Risk Classifier ✅
- M3 Policy Engine ✅
- M4 Adapter Layer ✅
- M5 Telemetry ✅
- M6 Benchmark Harness ✅
- M7 Dashboard / Reproducible Demo ✅
- M8 Release v0.1.0 ✅
- M9 Real Execution Bridges ✅
- M10 Provider Measurement ✅
- M11 Real Benchmark Corpus ✅
- M12 Evidence-driven Policy Calibration ✅
- M13 Adaptive Routing ✅
- Release v0.2.0 — release validation

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), [docs/RELEASE.md](docs/RELEASE.md), [docs/ADAPTIVE_ROUTING.md](docs/ADAPTIVE_ROUTING.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT for the ACR core. Third-party tools retain their own licenses and are not bundled, automatically installed, or relicensed by this repository.
