# ACR — Adaptative Context Router

**v0.1.0 MVP** · Adaptive context-engineering router for Claude Code workflows.

ACR classifies a task, evaluates precision/risk and context pressure, detects available optimization capabilities, selects or rejects strategies, produces safe adapter plans, records privacy-safe telemetry, compares measured A/B runs behind a quality gate, and generates a self-contained evidence dashboard.

> **Evidence boundary:** routing savings are estimates used for decision-making. ACR does **not** claim project-level token savings unless they come from measured benchmark inputs. The built-in demo is synthetic and explicitly labeled as such.

## Core thesis

There is no universally best token-saving technique. ACR treats optimization as a routing problem:

```text
TASK
  ↓
TASK / PRECISION / RISK CLASSIFIER
  ↓
CONTEXT + CAPABILITY ANALYSIS
  ↓
POLICY ENGINE
  ↓
STRATEGY OR NO_OPTIMIZATION
  ↓
ADAPTER PLAN
  ↓
TELEMETRY + MEASURED BENCHMARKS
  ↓
EVIDENCE DASHBOARD
```

The central rule is:

> **Optimize only when expected benefit exceeds expected overhead and risk.**

`NO_OPTIMIZATION` is therefore a first-class result, not an error or fallback of last resort.

## MVP capabilities

The v0.1.0 router includes:

- deterministic task, precision, and risk classification
- environment-aware capability discovery with `acr doctor`
- explainable policy scoring and negative routing
- precision-aware blocking for risky/lossy strategies such as pxpipe on exact data
- typed adapter plans for native progressive disclosure, Serena, jCodeMunch, RTK, Context Mode, Token Optimizer MCP, and pxpipe
- guarded execution semantics with explicit external executor bridges
- privacy-safe JSONL telemetry under `.acr/telemetry/events.jsonl`
- measured-only A/B benchmark comparison with a quality gate
- self-contained HTML evidence dashboard with no remote dependencies
- explicit separation of estimated routing signals from measured evidence
- Node.js 20 and 22 CI coverage

## Important execution boundary

v0.1.0 is the **router + evidence framework MVP**.

External tools are never silently installed and ACR does not fabricate MCP/CLI commands. The adapter layer can detect, estimate, plan, block, and execute only through an explicitly supplied `AdapterExecutor` bridge. The default CLI remains planning-safe when no real external bridge is present.

Likewise, telemetry can store measured token/cost/latency/quality observations, but the project does not yet claim an end-to-end measured savings percentage for real Claude Code workloads.

## Quick start

Requirements:

- Node.js 20 or newer
- npm

```bash
git clone https://github.com/oamado31-source/adaptative-context-router.git
cd adaptative-context-router
npm install
npm run build
node dist/cli/router.js help
```

Optional local command registration:

```bash
npm link
acr help
```

## CLI

### Runtime and capability discovery

```bash
node dist/cli/router.js version
node dist/cli/router.js status
node dist/cli/router.js doctor
node dist/cli/router.js doctor --json
```

Expected release identity:

```text
version: 0.1.0
milestone: M8
status: mvp-ready
mode: guarded
```

### Classify a task

```bash
node dist/cli/router.js classify \
  "Find where authenticateUser is defined."
```

### Route a task

```bash
node dist/cli/router.js route \
  --context-ratio 0.61 \
  --available serena,jcodemunch \
  "Find where authenticateUser is defined."
```

### Build a safe adapter plan

```bash
node dist/cli/router.js plan \
  --context-ratio 0.61 \
  --available serena \
  "Find where authenticateUser is defined."
```

With no external executor injected, an external adapter is reported as `planned`, not silently executed.

### Record local telemetry

```bash
node dist/cli/router.js plan \
  --record \
  --context-ratio 0.11 \
  "Change the button color."

node dist/cli/router.js telemetry summary
```

Raw task text is not stored by default; telemetry uses a SHA-256 task fingerprint plus structured metadata.

### Compare measured A/B observations

```bash
node dist/cli/router.js benchmark compare \
  --file benchmark.json
```

Benchmark inputs must use:

```json
"source": "measured"
```

Estimated observations are rejected. A large token reduction is reported as `quality-regression` when the quality/success gate fails.

### Generate the evidence dashboard

Local telemetry:

```bash
node dist/cli/router.js dashboard build \
  --output /tmp/acr-dashboard.html
```

Synthetic reproducible demo:

```bash
node dist/cli/router.js demo dashboard \
  --output /tmp/acr-demo-dashboard.html
```

The demo carries a prominent `SYNTHETIC DEMO` warning so fixture values cannot be mistaken for project benchmark evidence.

## Supported strategy adapters

| Adapter / strategy | Primary workload | v0.1.0 behavior |
| --- | --- | --- |
| Native Claude progressive disclosure | code/repository/long-context work | local guidance, low overhead |
| Serena | targeted code search / repository exploration | symbolic retrieval plan |
| jCodeMunch | targeted code search / repository exploration | AST/symbol retrieval plan |
| RTK | large logs | deterministic filtering/rewrite plan |
| Context Mode | logs / structured data | external guarded plan; exact/secret-sensitive work blocked |
| Token Optimizer MCP | logs / structured / implementation / debugging | external guarded plan |
| pxpipe | semantic long context | external guarded plan; structural/exact/secret-sensitive work blocked |

## Evidence discipline

ACR deliberately separates three concepts:

1. **Estimated saving** — a policy-engine input used to choose a route.
2. **Measured observation** — actual tokens/cost/latency/quality supplied as telemetry or benchmark evidence.
3. **Synthetic fixture** — deterministic test/demo data, never a project performance claim.

This separation is enforced by tests, CLI parsing, telemetry schema, benchmark quality gates, and dashboard labels.

## Development and release checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
```

CI runs the quality gates on Node.js 20 and 22 and includes compiled smoke tests for routing, adapter planning, telemetry privacy, measured benchmark comparison, and the dashboard.

## Milestones

- M0 Bootstrap ✅
- M1 Capability Registry ✅
- M2 Task / Risk Classifier ✅
- M3 Policy Engine ✅
- M4 Adapter Layer ✅
- M5 Telemetry ✅
- M6 Benchmark Harness ✅
- M7 Dashboard / Reproducible Demo ✅
- M8 Release v0.1.0 — release candidate validation

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for implementation and integration policy details.

## License

MIT for the ACR core. Third-party tools retain their own licenses and are not bundled, automatically installed, or relicensed by this repository.
