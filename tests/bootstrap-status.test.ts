import { describe, expect, it } from 'vitest';

import { ACR_MILESTONE, ACR_VERSION, createBootstrapStatus } from '../src/core/bootstrap-status.js';

describe('createBootstrapStatus', () => {
  it('returns guarded adaptive-ready status by default', () => {
    expect(createBootstrapStatus()).toEqual({
      name: 'ACR — Adaptative Context Router',
      version: ACR_VERSION,
      milestone: ACR_MILESTONE,
      mode: 'guarded',
      status: 'adaptive-ready',
    });
  });

  it('accepts another supported mode', () => {
    expect(createBootstrapStatus('observe').mode).toBe('observe');
  });
});
