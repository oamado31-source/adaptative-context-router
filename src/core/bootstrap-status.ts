import type { OptimizationMode } from './contracts.js';

export const ACR_VERSION = '0.0.0';
export const ACR_MILESTONE = 'M0';

export interface BootstrapStatus {
  name: string;
  version: string;
  milestone: string;
  mode: OptimizationMode;
  status: 'bootstrap-ready';
}

export function createBootstrapStatus(
  mode: OptimizationMode = 'guarded',
): BootstrapStatus {
  return {
    name: 'ACR — Adaptative Context Router',
    version: ACR_VERSION,
    milestone: ACR_MILESTONE,
    mode,
    status: 'bootstrap-ready',
  };
}
