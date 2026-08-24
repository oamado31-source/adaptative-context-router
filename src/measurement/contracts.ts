export type MeasurementProvider = 'claude-code';
export type MeasurementSource = 'claude-code-json';
export type TokenProvenance = 'provider-reported';
export type LatencyProvenance = 'provider-reported';
export type CostProvenance = 'claude-code-client-estimate' | 'unavailable';

export interface ProviderMeasurement {
  provider: MeasurementProvider;
  source: MeasurementSource;
  measured: true;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  apiLatencyMs?: number;
  estimatedCostUsd?: number;
  tokenProvenance: TokenProvenance;
  latencyProvenance: LatencyProvenance;
  costProvenance: CostProvenance;
  success: boolean;
  turns?: number;
  sessionFingerprint?: string;
}
