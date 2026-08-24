# Evidence-driven policy calibration

M12 turns measured benchmark comparisons into advisory policy recommendations. It does not change the runtime policy automatically.

## Evidence boundary

Calibration accepts benchmark comparisons whose observations are `source: "measured"`. Synthetic fixtures can test the calibration code path, but they are not evidence for production policy changes.

The calibration layer operates after the benchmark harness has already aggregated paired baseline/ACR observations and enforced its quality/success gate. The analyzer groups comparisons by `case.strategy` and compares measured total-token deltas with the current strategy `estimatedSavingRatio` from `policies/default.yaml`.

## Conservative defaults

The default calibration thresholds require:

- at least 2 distinct benchmark cases for a strategy;
- at least 3 measured samples per arm for every case;
- at least 5% mean total-token reduction before a promotion recommendation;
- a proposed `estimatedSavingRatio` no greater than 0.90.

A case without a strategy is retained as a control and excluded from strategy calibration. A case that names a strategy absent from the current policy is skipped rather than guessed or remapped.

## Recommendations

A strategy may receive one of four advisory dispositions:

- `promote`: evidence is sufficient, every quality gate passes, and mean measured total-token reduction clears the promotion threshold;
- `hold`: evidence is sufficient and safe, but the measured benefit is not strong enough to justify changing the current estimate;
- `demote`: at least one quality/success gate fails, or measured ACR token use is materially worse than baseline;
- `insufficient-evidence`: there are too few distinct cases or too few samples per arm.

Quality regression has precedence over token savings. A strategy that reduces tokens but fails a quality/success gate cannot be promoted.

## Policy mutation boundary

Every report and recommendation carries `policyMutation: false`. `acr calibrate analyze` is advisory only and rejects `--apply` and `--write-policy`.

A recommended `proposedEstimatedSavingRatio` is evidence for a human-reviewed policy change, not an automatic write. Any future policy mutation workflow must remain a separate explicit checkpoint with regression tests and review of the underlying measured benchmark evidence.

## CLI

```bash
acr calibrate analyze \
  --file benchmark-case-a.json \
  --file benchmark-case-b.json \
  --json
```

The command reads benchmark inputs, computes measured comparisons through the existing benchmark harness, loads the current policy, and produces an advisory calibration report. It does not execute Claude Code, run adapters, modify `policies/default.yaml`, or claim that an unmeasured strategy has improved.

## Relationship to M10 and M11

M10 established provider-reported measurement plumbing. M11 defined a pinned real benchmark corpus and experimental validity controls. M12 consumes measured A/B comparisons produced from that evidence path and turns them into auditable policy recommendations.

The output of M12 should only be treated as policy-calibration evidence when the input benchmark observations come from real paired runs that satisfy the M11 controls. CI fixtures remain explicitly synthetic validation data.
