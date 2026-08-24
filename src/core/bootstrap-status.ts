import type { OptimizationMode } from './contracts.js';

export const ACR_VERSION = '0.1.0';
export const ACR_MILESTONE = 'M8';

export interface BootstrapStatus {
  name: string;
  version: string;
  milestone: string;
  mode: OptimizationMode;
  status: 'mvp-ready';
}

export function createBootstrapStatus(
  mode: OptimizationMode = 'guarded',
): BootstrapStatus {
  return {
    name: 'ACR — Adaptative Context Router',
    version: ACR_VERSION,
    milestone: ACR_MILESTONE,
    mode,
    status: 'mvp-ready',
  };
}
