# Adaptive Routing — M13

M13 connects the measured-evidence chain established by M10–M12 to runtime routing without turning ACR into a self-modifying policy system.

## Evidence chain

1. **M10 — Provider Measurement** captures provider-reported token/cache/latency measurements with provenance.
2. **M11 — Real Benchmark Corpus** defines reproducible baseline-vs-ACR workloads and quality controls.
3. **M12 — Policy Calibration** converts measured comparisons into advisory `promote`, `hold`, `demote`, or `insufficient-evidence` recommendations while keeping `policyMutation: false`.
4. **M13 — Adaptive Routing** can convert sufficiently supported M12 recommendations into an explicitly approved runtime profile.

The runtime profile is a separate JSON artifact. It never replaces or silently rewrites `policies/default.yaml`.

## Explicit approval

Profile creation requires an explicit approval flag:

```bash
acr adaptive profile create \
  --calibration calibration-report.json \
  --id measured-v1 \
  --output .acr/profiles/measured-v1.json \
  --approve
```

Without `--approve`, profile creation fails and no artifact is written.

A valid profile must declare:

- `source: "m12-calibration"`
- `evidenceMode: "measured"`
- `approved: true`
- at least 2 measured cases and 6 samples per arm for every included rule
- no quality failures on a `tune` rule

`hold` and `insufficient-evidence` recommendations do not create runtime tuning rules.

## Runtime opt-in

Normal routing is unchanged. Adaptive routing occurs only when a profile is supplied explicitly:

```bash
acr route \
  --adaptive-profile .acr/profiles/measured-v1.json \
  --context-ratio 0.61 \
  --available serena,jcodemunch \
  "Find where authenticateUser is defined."
```

The same opt-in is supported by `acr plan`.

## Overlay semantics

The profile is applied to an in-memory copy of the default `PolicyConfig` before the normal `PolicyEngine` evaluates the task.

A `tune` rule may adjust only `estimatedSavingRatio` for an existing strategy. It does not add strategies or alter task matching, precision requirements, risk classes, capabilities, context thresholds, or minimum utility rules.

A `demote` recommendation caused by a measured quality/success failure becomes a hard runtime block. A strategy carrying this block is rejected before scoring and cannot recover through a high base score, estimated saving, or confidence value.

A measured demotion to zero saving is also represented as a runtime block.

Unknown strategy IDs are rejected rather than guessed or added to the base policy.

## Safety invariants

Adaptive routing cannot bypass the existing policy engine. In particular:

- secret-sensitive tasks still resolve to `NO_OPTIMIZATION` under the default guarded policy;
- forbidden precision rules still apply;
- unavailable capabilities still block a strategy;
- context utilization thresholds still apply;
- minimum utility still applies;
- a profile never installs tools;
- a profile never executes adapters by itself;
- a profile never writes `policies/default.yaml`.

There is no background learning loop and no automatic promotion from telemetry directly into runtime policy.

## Auditability

Every adaptive decision carries compact provenance:

- `profileId`
- SHA-256 `profileFingerprint`
- number of applied rules
- tuned strategy IDs
- blocked strategy IDs

When telemetry is enabled, the decision event records this compact provenance. The raw profile content and the profile file path are not persisted by telemetry.

## Profile inspection

```bash
acr adaptive profile inspect \
  --file .acr/profiles/measured-v1.json \
  --json
```

Inspection validates the profile before reporting its fingerprint and rule summary.

## What M13 does not prove

An adaptive profile is only as strong as the measured evidence used to create it. Synthetic tests and CI fixtures validate the mechanism but are not evidence that any strategy saves tokens in production.

Real policy adaptation still requires measured baseline-vs-ACR results from the controlled benchmark methodology established in M11 and analyzed in M12.
