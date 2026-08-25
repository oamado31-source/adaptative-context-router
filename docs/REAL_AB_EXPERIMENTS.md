# Real A/B experiments — M14

M14 adds an operator-managed evidence ledger that connects the versioned real benchmark corpus to measured benchmark inputs. It does **not** execute Claude Code or external adapters.

The purpose is to make real A/B collection reproducible without turning provider calls, reviewer judgments or client-estimated cost into stronger evidence than they are.

## Evidence boundary

An experiment plan always records:

- `evidenceMode: real`
- `execution: false`
- provider `claude-code`
- the corpus ID and pinned repository revision
- an explicitly operator-pinned model string
- the exact corpus case snapshot
- SHA-256 fingerprints of the task and quality rubric
- the deterministic alternating A/B schedule

The model string is operator provenance, not provider-verified model metadata. M14 does not infer a model from Claude Code JSON.

Raw Claude result text is never copied into the experiment ledger. The ledger stores the normalized provider measurement, a hash of the structured result file, a hashed session identifier, and the quality score supplied after blinded review.

Claude Code `total_cost_usd` remains a **client estimate**. It may exist in the normalized experiment record for provenance but is intentionally omitted from finalized `BenchmarkObservation.costUsd`, because the M6 benchmark contract reserves cost comparison for measured cost data.

## Experiment arms

For every corpus case, M14 creates the number of repetitions required by the corpus controls. `real-v1` uses three repetitions per arm with alternating order:

```text
repetition 1: baseline → ACR
repetition 2: ACR → baseline
repetition 3: baseline → ACR
```

The protocols are:

- `direct-provider`: baseline. Run the corpus task directly against the pinned repository revision using the pinned provider/model and a fresh session.
- `acr-guided`: treatment arm for an optimized case. Use the same user task/provider/model/fresh-session controls, while applying the context treatment specified by the ACR strategy being evaluated.
- `acr-no-optimization-control`: ACR arm for corpus cases whose expected strategy is `NO_OPTIMIZATION`. These remain controls and do not become calibration recommendations for a strategy.

M14 records these runs; it does not produce the treatment context itself. Automated/context-producing experiment execution remains a separate future capability and must preserve the same evidence controls.

## CLI workflow

Prepare an experiment from a real corpus case:

```bash
acr benchmark experiment prepare \
  --corpus benchmarks/corpus/real-v1.json \
  --case acr-symbol-classifier-profile \
  --model <explicit-model-id> \
  --output /tmp/acr-experiment.json \
  --json
```

Inspect progress and the next required slot:

```bash
acr benchmark experiment inspect \
  --file /tmp/acr-experiment.json \
  --json
```

M14 intentionally does not print or execute a provider command. Run the next slot yourself in a **fresh Claude session**, preserving the corpus prompt and pinned experimental conditions, and save the structured Claude Code JSON result.

After the output has been scored against the corpus rubric by a blinded reviewer, record the result:

```bash
acr benchmark experiment record \
  --file /tmp/acr-experiment.json \
  --slot acr-symbol-classifier-profile:r1:baseline \
  --result /tmp/claude-result.json \
  --quality-score 0.98 \
  --review-blinded \
  --output /tmp/acr-experiment.json \
  --json
```

`record` rejects:

- missing explicit `--review-blinded` confirmation;
- a slot other than the next pending slot;
- Claude result JSON without a session ID;
- reuse of a Claude session already present in the experiment;
- reuse of the same result evidence;
- invalid quality scores.

Once all slots are recorded, finalize the experiment:

```bash
acr benchmark experiment finalize \
  --file /tmp/acr-experiment.json \
  --output /tmp/acr-benchmark.json \
  --json
```

The output is a normal measured `BenchmarkInput`, so the existing flow remains:

```bash
acr benchmark compare --file /tmp/acr-benchmark.json --json
acr calibrate analyze --file /tmp/acr-benchmark.json --json
```

A single real case is still insufficient for M12 promotion because calibration requires evidence from multiple cases per strategy.

## Quality floor

M11 corpus cases include an absolute `quality.minimumScore`. Before M14 this floor existed in the corpus manifest but the generic benchmark comparison only enforced quality relative to baseline.

M14 propagates the corpus value as `BenchmarkCase.minimumQualityScore`. The benchmark quality gate now uses the stricter of:

1. baseline mean quality minus the configured relative tolerance; and
2. the corpus absolute minimum quality.

If the baseline itself is below the corpus absolute minimum, the comparison is rejected as invalid evidence rather than using a weak baseline to justify an optimization.

Therefore token savings can never rescue a run that falls below the corpus quality floor.

## Session isolation

The M11 corpus specifies `sessionPersistence: false`. M14 turns that control into verifiable ledger behavior by requiring a Claude `session_id` for each recorded result, hashing it, and rejecting duplicate session fingerprints inside the experiment.

The original session ID is not stored.

## What M14 proves — and what it does not

M14 can prove that an experiment artifact follows the declared schedule, contains unique fresh-session provider measurements, carries blinded quality scores, preserves corpus provenance, and can be finalized into the measured benchmark format.

M14 does **not** prove that a strategy saves tokens. Only completed real provider runs, followed by benchmark comparison and sufficient M12 calibration evidence, can support that conclusion.

Synthetic JSON used in unit tests or CI validates this mechanism only and must never be presented as real ACR performance evidence.
