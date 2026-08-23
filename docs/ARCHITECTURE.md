# ACR Architecture

## Purpose

ACR (Adaptative Context Router) is an adaptive context-engineering orchestrator for Claude Code. It does not aim to replace specialist optimizers. Its core responsibility is to classify a workload, assess precision and risk, discover available capabilities, select or compose an optimization strategy, and record the decision with measurable evidence.

## Core pipeline

```text
Task / prompt
   ↓
Task classifier
   ↓
Context + precision/risk analysis
   ↓
Capability registry
   ↓
Policy engine
   ↓
Strategy scoring
   ↓
Pipeline executor
   ↓
Specialist adapters / native Claude capabilities
   ↓
Telemetry + benchmark evidence
```

## Design principles

1. **Optimize only when expected benefit exceeds overhead and risk.**
2. **No universal optimizer.** Strategy is workload-dependent.
3. **Negative routing is first-class.** ACR must be able to reject an optimizer when precision or safety requirements make it unsuitable.
4. **Measured and estimated values remain separate.** No marketing-style aggregation of incomparable counters.
5. **Adapters, not a monolith.** External tools remain replaceable and independently versioned.
6. **Safe default: guarded mode.** Automatic behavior must be limited to high-confidence, low-risk decisions until evidence supports broader automation.
7. **No silent third-party installation.** ACR detects capabilities and reports missing ones; users control installation.

## M0 scope

M0 establishes the TypeScript project, CLI surface, core contracts, tests, CI, and documentation. It intentionally does not implement capability discovery or routing logic; those begin in M1 and M2.

## Planned core modules

- `classifier` — task/workload classification.
- `risk-analyzer` — precision, exact-identifier, secret-sensitive and quality-risk signals.
- `context-analyzer` — context-window state and accounting inputs.
- `capability-registry` — local/native tool detection.
- `policy-engine` — deterministic routing rules with explainable decisions.
- `strategy-scorer` — expected savings, overhead, risk and historical success.
- `pipeline-executor` — adapter composition and guarded execution.
- `telemetry` — decision records, measurements and evidence provenance.

## Planned adapter families

- Claude native context features
- Serena / symbolic retrieval
- RTK / shell-output filtering
- Token Optimizer MCP
- Context Mode
- pxpipe
- jCodeMunch or equivalent symbol-level retrieval

Licensing and redistribution constraints are tracked separately in `THIRD_PARTY_NOTICES.md`.
