import type { BenchmarkComparison } from '../benchmark/contracts.js';
import type {
  DashboardModel,
  DashboardRunSummary,
} from './model.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function nullablePercent(value: number | null): string {
  return value === null ? '—' : formatPercent(value);
}

function nullableNumber(value: number | null): string {
  return value === null ? '—' : formatInteger(value);
}

function nullableScore(value: number | null): string {
  return value === null ? '—' : value.toFixed(3);
}

function outcomeClass(outcome: BenchmarkComparison['outcome']): string {
  switch (outcome) {
    case 'acr-better':
      return 'positive';
    case 'quality-regression':
    case 'baseline-better':
      return 'negative';
    case 'no-material-difference':
      return 'neutral';
  }
}

function renderMetric(label: string, value: string, detail: string): string {
  return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function renderStrategyBars(model: DashboardModel): string {
  const counts = new Map(Object.entries(model.telemetry.selectedStrategies));
  if (model.telemetry.noOptimizationRuns > 0) {
    counts.set('NO_OPTIMIZATION', model.telemetry.noOptimizationRuns);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return '<p class="empty">No routing decisions recorded yet.</p>';
  }
  const max = Math.max(...entries.map(([, count]) => count));
  return entries
    .map(([strategy, count]) => {
      const width = max === 0 ? 0 : (count / max) * 100;
      return `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(strategy)}</span><b>${count}</b></div><div class="bar-track"><span style="width:${width.toFixed(1)}%"></span></div></div>`;
    })
    .join('');
}

function runRow(run: DashboardRunSummary): string {
  return `<tr>
    <td><code>${escapeHtml(run.runId.slice(0, 8))}</code></td>
    <td>${escapeHtml(run.taskType ?? 'unknown')}</td>
    <td>${escapeHtml(run.risk ?? 'unknown')}</td>
    <td>${escapeHtml(run.selectedStrategy ?? 'NO_OPTIMIZATION')}</td>
    <td>${nullablePercent(run.utilizationRatio)}</td>
    <td>${nullablePercent(run.estimatedSavingRatio)}</td>
    <td>${escapeHtml(run.pipelineStatus ?? '—')}</td>
    <td>${run.measured ? '<span class="badge measured">measured</span>' : '<span class="badge estimate">unmeasured</span>'}</td>
    <td>${nullableNumber(run.inputTokens)}</td>
    <td>${nullableScore(run.qualityScore)}</td>
  </tr>`;
}

function renderRuns(model: DashboardModel): string {
  if (model.runs.length === 0) {
    return '<p class="empty">No telemetry runs available.</p>';
  }
  return `<div class="table-wrap"><table>
    <thead><tr><th>Run</th><th>Task type</th><th>Risk</th><th>Selected</th><th>Context</th><th>Est. saving</th><th>Pipeline</th><th>Evidence</th><th>Input tokens</th><th>Quality</th></tr></thead>
    <tbody>${model.runs.slice(0, 30).map(runRow).join('')}</tbody>
  </table></div>`;
}

function renderBenchmark(comparison: BenchmarkComparison): string {
  const tokenDelta = formatPercent(comparison.deltas.totalTokenReductionRatio);
  const latencyDelta = formatPercent(comparison.deltas.latencyReductionRatio);
  const costDelta = comparison.deltas.costReductionRatio;
  const costText = costDelta === undefined ? 'not comparable' : formatPercent(costDelta);
  const cls = outcomeClass(comparison.outcome);
  return `<article class="benchmark-card">
    <div class="benchmark-head"><div><span class="eyebrow">${escapeHtml(comparison.case.taskType)}</span><h3>${escapeHtml(comparison.case.id)}</h3></div><span class="outcome ${cls}">${escapeHtml(comparison.outcome)}</span></div>
    <div class="benchmark-grid">
      <div><span>Total-token reduction</span><strong>${escapeHtml(tokenDelta)}</strong></div>
      <div><span>Latency reduction</span><strong>${escapeHtml(latencyDelta)}</strong></div>
      <div><span>Cost reduction</span><strong>${escapeHtml(costText)}</strong></div>
      <div><span>Quality gate</span><strong>${comparison.qualityGate.passed ? 'PASS' : 'FAIL'}</strong></div>
    </div>
    <div class="ab-grid"><div><span>Baseline tokens</span><b>${formatInteger(comparison.baseline.meanTotalTokens)}</b></div><div><span>ACR tokens</span><b>${formatInteger(comparison.acr.meanTotalTokens)}</b></div><div><span>Baseline quality</span><b>${comparison.baseline.meanQualityScore.toFixed(3)}</b></div><div><span>ACR quality</span><b>${comparison.acr.meanQualityScore.toFixed(3)}</b></div></div>
    <p class="evidence-line"><span class="badge measured">measured A/B</span> ${escapeHtml(comparison.case.strategy ?? 'NO_OPTIMIZATION')}</p>
    <ul>${comparison.rationale.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
  </article>`;
}

function renderBenchmarks(model: DashboardModel): string {
  if (model.benchmarks.length === 0) {
    return '<p class="empty">No measured benchmark comparisons attached to this dashboard.</p>';
  }
  return `<div class="benchmark-list">${model.benchmarks.map(renderBenchmark).join('')}</div>`;
}

export function renderDashboardHtml(model: DashboardModel): string {
  const synthetic = model.evidenceMode === 'synthetic-demo';
  const measuredTokens =
    model.telemetry.measuredInputTokens + model.telemetry.measuredOutputTokens;
  const totalDecisions =
    Object.values(model.telemetry.selectedStrategies).reduce((sum, value) => sum + value, 0) +
    model.telemetry.noOptimizationRuns;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ACR Evidence Dashboard</title>
<style>
:root{color-scheme:dark;--bg:#080b12;--panel:#111724;--panel2:#161e2e;--text:#edf3ff;--muted:#8f9bb3;--line:#283249;--accent:#78a8ff;--positive:#77d9ad;--negative:#ff8d9b;--neutral:#e6c86e;--warning:#ffb86b}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% -10%,#182846 0,transparent 42%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1240px;margin:0 auto;padding:42px 24px 72px}.synthetic-banner{border:1px solid var(--warning);background:#2a1c0e;color:#ffd7a4;padding:12px 16px;border-radius:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;margin-bottom:22px}.top{display:flex;justify-content:space-between;gap:30px;align-items:flex-end;margin-bottom:28px}.brand{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);font-weight:800}.top h1{font-size:42px;letter-spacing:-.04em;margin:6px 0 8px}.top p{margin:0;color:var(--muted);max-width:760px;line-height:1.55}.generated{text-align:right;color:var(--muted);font-size:12px;white-space:nowrap}.notice{background:var(--panel);border:1px solid var(--line);border-left:4px solid ${synthetic ? 'var(--warning)' : 'var(--accent)'};border-radius:12px;padding:14px 16px;color:#c9d4e8;margin-bottom:22px}.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:22px}.metric{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:15px;padding:18px}.metric span,.metric small{display:block;color:var(--muted)}.metric span{font-size:12px;text-transform:uppercase;letter-spacing:.08em}.metric strong{display:block;font-size:30px;margin:9px 0 5px;letter-spacing:-.03em}.metric small{font-size:11px}.section{background:rgba(17,23,36,.88);border:1px solid var(--line);border-radius:16px;padding:21px;margin-top:16px}.section-head{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:17px}.section h2{margin:0;font-size:19px}.section-head p{margin:0;color:var(--muted);font-size:12px}.bar-row{margin:13px 0}.bar-label{display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px}.bar-track{height:8px;background:#202a3d;border-radius:99px;overflow:hidden}.bar-track span{display:block;height:100%;background:linear-gradient(90deg,#527be8,var(--accent));border-radius:99px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;font-size:12px;min-width:1000px}th,td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em;background:#111827}tbody tr:last-child td{border-bottom:0}code{color:#b8ccff}.badge{display:inline-block;border-radius:99px;padding:3px 8px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.measured{background:#17372e;color:#9cf0ce}.estimate{background:#2d2b22;color:#e7cf84}.benchmark-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.benchmark-card{border:1px solid var(--line);background:#0d1320;border-radius:14px;padding:18px}.benchmark-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.benchmark-card h3{margin:4px 0 14px}.outcome{font-size:10px;text-transform:uppercase;font-weight:900;padding:5px 8px;border-radius:7px}.outcome.positive{background:#17372e;color:var(--positive)}.outcome.negative{background:#401e27;color:var(--negative)}.outcome.neutral{background:#37321c;color:var(--neutral)}.benchmark-grid,.ab-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.benchmark-grid div,.ab-grid div{background:#151c2a;border-radius:9px;padding:10px}.benchmark-grid span,.ab-grid span{display:block;font-size:10px;color:var(--muted);margin-bottom:5px}.benchmark-grid strong{font-size:18px}.ab-grid{margin-top:8px}.evidence-line{font-size:12px;color:var(--muted)}.benchmark-card ul{color:#aab6ca;font-size:12px;line-height:1.5;padding-left:18px}.discipline{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.discipline div{background:#101827;border:1px solid var(--line);border-radius:12px;padding:14px}.discipline b{display:block;margin-bottom:6px}.discipline span{color:var(--muted);font-size:12px;line-height:1.45}.empty{color:var(--muted);font-style:italic}.footer{margin-top:28px;color:#657189;font-size:11px;text-align:center}@media(max-width:900px){.metrics{grid-template-columns:repeat(2,1fr)}.benchmark-list{grid-template-columns:1fr}.top{display:block}.generated{text-align:left;margin-top:12px}.discipline{grid-template-columns:1fr}}@media(max-width:560px){.metrics{grid-template-columns:1fr}.top h1{font-size:34px}.wrap{padding:28px 14px 50px}}
</style>
</head>
<body>
<main class="wrap">
${synthetic ? `<div class="synthetic-banner">${escapeHtml(model.disclaimer)}</div>` : ''}
<header class="top"><div><div class="brand">ACR · Adaptative Context Router</div><h1>Evidence Dashboard</h1><p>${escapeHtml(model.sourceLabel)} · A compact view of routing behavior, measured coverage and A/B benchmark evidence.</p></div><div class="generated">Generated<br>${escapeHtml(model.generatedAt)}</div></header>
${synthetic ? '' : `<div class="notice">${escapeHtml(model.disclaimer)}</div>`}
<section class="metrics">
${renderMetric('Runs', formatInteger(model.telemetry.totalRuns), `${formatInteger(totalDecisions)} routing decisions`)}
${renderMetric('Measured coverage', formatPercent(model.measuredCoverageRatio), `${formatInteger(model.telemetry.measuredRuns)} measured runs`)}
${renderMetric('No optimization', formatInteger(model.telemetry.noOptimizationRuns), 'first-class routing outcome')}
${renderMetric('Measured tokens', formatInteger(measuredTokens), 'input + output only')}
${renderMetric('Measured cost', `$${model.telemetry.measuredCostUsd.toFixed(4)}`, 'only recorded cost events')}
</section>
<section class="section"><div class="section-head"><h2>Routing distribution</h2><p>Selected strategies + explicit NO_OPTIMIZATION decisions</p></div>${renderStrategyBars(model)}</section>
<section class="section"><div class="section-head"><h2>Recent runs</h2><p>Estimated savings stay visually separate from measured evidence</p></div>${renderRuns(model)}</section>
<section class="section"><div class="section-head"><h2>Measured A/B benchmarks</h2><p>Quality gate is evaluated before an optimization win is declared</p></div>${renderBenchmarks(model)}</section>
<section class="section"><div class="section-head"><h2>Evidence discipline</h2><p>Rules applied to this dashboard</p></div><div class="discipline"><div><b>Routing ≠ proof</b><span>Policy-engine saving ratios are estimates used to choose a strategy. They are not benchmark claims.</span></div><div><b>Measured-only A/B</b><span>Benchmark comparisons accept measured observations and reject estimated evidence.</span></div><div><b>Quality before savings</b><span>A large token reduction is reported as quality regression when the quality/success gate fails.</span></div></div></section>
<div class="footer">Self-contained HTML · no external scripts, fonts, trackers or network dependencies.</div>
</main>
</body>
</html>`;
}
