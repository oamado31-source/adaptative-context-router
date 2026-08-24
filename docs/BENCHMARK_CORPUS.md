# Real Benchmark Corpus

M11 defines a reproducible corpus for future measured baseline-vs-ACR experiments. The corpus is an experimental specification, not a result set and not evidence that ACR saves tokens.

## Evidence boundary

`benchmarks/corpus/real-v1.json` is explicitly `evidenceMode: "real"`. Its tasks point to durable files in the public ACR repository at a full pinned Git commit. Synthetic fixtures used by tests or demos remain useful for validating software behavior, but they must never be presented as benchmark evidence.

The initial target is:

- repository: `oamado31-source/adaptative-context-router`
- revision: `7fb35b8a8777cc39b986ec4661e21b66875b1623`

A full commit SHA is required so later runs can evaluate the same source state even after `main` changes.

## Experimental controls

Each future baseline/ACR pair must preserve the corpus controls:

- three repetitions per arm at minimum;
- identical task prompt across the paired arms;
- the same provider and model across paired arms;
- session persistence disabled;
- alternating arm order to reduce simple ordering bias;
- output quality evaluated against a blinded rubric;
- each case pins `routingContextRatio`, because ACR routing decisions depend on context utilization.

These controls reduce obvious confounders. They do not by themselves prove causality or statistical significance.

## Cases and quality rubrics

Each case contains:

- a stable case ID and workload type;
- the exact task prompt;
- a pinned routing-context ratio;
- repository-relative target paths;
- capabilities required by the intended ACR arm;
- an `expectedStrategy` routing hypothesis;
- a quality threshold and explicit rubric assertions.

`expectedStrategy` is not proof that the named strategy is beneficial. It records the intended routing treatment for the case so later experiments can detect routing drift. Actual benefit must come from measured paired observations that pass the quality gate.

Two cases deliberately expect `NO_OPTIMIZATION`. This is required by the ACR thesis: optimization is not universally beneficial, and a correct router must be allowed to decide that expected overhead or risk exceeds expected savings.

## Honest coverage

`real-v1` does not manufacture workloads merely to make the matrix look complete.

- `large_logs` is omitted because the repository does not yet contain a durable, versioned real log corpus. Ephemeral CI logs are not used as evidence inputs.
- `large_structured_data` is omitted until a durable real structured dataset can be pinned without introducing private data or synthetic evidence.

A later corpus revision can add these workloads when suitable real artifacts exist.

## Validation

Validate the manifest with:

```bash
node dist/cli/router.js benchmark corpus validate \
  --file benchmarks/corpus/real-v1.json
```

For machine-readable output:

```bash
node dist/cli/router.js benchmark corpus validate \
  --file benchmarks/corpus/real-v1.json \
  --json
```

Validation checks manifest structure and experimental controls only. It does **not**:

- invoke Claude Code;
- execute Serena, RTK, pxpipe, Token Optimizer or any other adapter;
- produce baseline/ACR observations;
- claim token, latency or cost savings.

## Relationship to measurement and calibration

M10 established provider-measurement plumbing for real Claude Code token/cache/latency data with explicit provenance. M11 defines the repeatable workloads and quality criteria needed to collect paired evidence. Later benchmark execution will feed measured observations into the existing benchmark harness, and M12 can calibrate policy only from evidence that preserves quality and success-rate gates.

Routing-estimated savings and provider-measured benchmark results remain separate concepts throughout this process.
