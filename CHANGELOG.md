# Changelog

All notable changes to ACR are documented here.

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
