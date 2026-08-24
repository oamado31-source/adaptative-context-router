# Changelog

All notable changes to ACR are documented here.

## [0.2.0] — 2026-08-24

Evidence-gated adaptive routing release built on the v0.1.0 router + evidence framework.

### Added

- real execution bridges for Serena MCP and RTK with explicit, non-shell process execution boundaries
- Claude Code structured-result measurement ingestion for provider-reported token, cache, latency, turn, and client-estimated cost metadata
- explicit provenance separation between measured cost and Claude Code client-side estimated cost
- privacy-safe Claude Code session fingerprinting without persisting raw session IDs or response text
- `real-v1` benchmark corpus pinned to a real repository revision with reproducibility controls, quality rubrics, and `NO_OPTIMIZATION` controls
- advisory evidence-driven policy calibration with `promote`, `hold`, `demote`, and `insufficient-evidence` outcomes
- quality-regression precedence in calibration: token savings cannot promote a strategy that fails the quality gate
- approved adaptive routing profiles generated from measured M12 calibration output
- in-memory adaptive overlays that tune strategy saving estimates or hard-block quality-regressed strategies while preserving the existing PolicyEngine safety rules
- explicit `--approve` gate for adaptive profile creation and opt-in `--adaptive-profile` routing/planning
- adaptive decision provenance in telemetry using profile ID, SHA-256 fingerprint, applied-rule count, tuned strategies, and blocked strategies
- dedicated Adaptive Routing Smoke workflow in Node.js 20/22

### CLI additions

- `acr bridge ...` for explicit real execution bridge operations
- `acr measurement import-claude --file <result.json> --run <runId>`
- `acr benchmark corpus validate --file <corpus.json>`
- `acr calibrate analyze --file <benchmark.json> [...]`
- `acr adaptive profile create --calibration <report.json> --id <profileId> --output <profile.json> --approve`
- `acr adaptive profile inspect --file <profile.json>`
- `acr route|plan ... --adaptive-profile <profile.json>`

### Safety and evidence boundaries

- v0.2.0 does not claim a project-wide measured token-saving percentage
- the real benchmark corpus defines reproducible workloads; it is not itself A/B savings evidence
- calibration consumes measured benchmark evidence only and remains advisory; it cannot mutate `policies/default.yaml`
- adaptive routing requires an explicitly approved measured-evidence profile and applies changes only to an in-memory policy copy
- a hard-blocked strategy does not disable other safe fallbacks that remain eligible under the base policy
- secret-sensitive `NO_OPTIMIZATION`, precision blocks, capability requirements, context thresholds, and minimum utility remain authoritative
- provider `total_cost_usd` is stored as a Claude Code client estimate, not promoted to measured/billed cost
- synthetic CI/test fixtures validate mechanics only and are never treated as production savings evidence
- no background learning loop, silent tool installation, or automatic policy self-modification is introduced

### Release scope

v0.2.0 advances ACR from the MVP routing/evidence framework to an evidence-gated adaptive routing system: real bridge validation, provider measurement ingestion, reproducible real workload definitions, advisory calibration, and explicitly approved runtime adaptation.

npm publication remains intentionally out of scope; distribution is the GitHub source release/tag.

## [0.1.0] — 2026-08-24

First MVP release of the Adaptative Context Router.

### Added

- strict TypeScript + Node.js project scaffold and CI on Node 20/22
- capability registry and `acr doctor`
- deterministic task, precision, and risk classifier
- explainable policy engine with negative routing and `NO_OPTIMIZATION`
- typed adapter layer for Native Claude progressive disclosure, Serena, jCodeMunch, RTK, Context Mode, Token Optimizer MCP, and pxpipe
- defense-in-depth precision blocking for risky/lossy adapters
- privacy-safe JSONL telemetry with SHA-256 task fingerprints
- measured-only A/B benchmark harness with quality/success gates
- self-contained evidence dashboard and explicitly labeled synthetic demo
- CLI commands for classify, route, plan, telemetry, benchmark, dashboard, status, version, and doctor
- release contract regression keeping runtime and package version metadata synchronized

### Evidence boundary

- policy-engine saving ratios are routing estimates, not project performance claims
- built-in demo values are synthetic fixtures, not benchmark evidence
- measured benchmark comparisons reject `source: estimated`
- quality regression overrides apparent token savings
- external adapter execution requires an explicit executor bridge; the default CLI does not silently install or fabricate third-party invocations

### Release scope

v0.1.0 is the router + evidence framework MVP. It establishes the decision, planning, telemetry, benchmark, and demonstration infrastructure required for later real-world bridge validation and measured Claude Code experiments.
