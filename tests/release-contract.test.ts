import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  ACR_MILESTONE,
  ACR_VERSION,
  createBootstrapStatus,
} from '../src/core/bootstrap-status.js';

interface PackageMetadata {
  version: string;
  private: boolean;
  license?: string;
  bin?: Readonly<Record<string, string>>;
}

async function readPackageMetadata(): Promise<PackageMetadata> {
  const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as PackageMetadata;
}

describe('v0.2.0 release contract', () => {
  it('keeps runtime and package versions synchronized', async () => {
    const packageMetadata = await readPackageMetadata();

    expect(packageMetadata.version).toBe('0.2.0');
    expect(ACR_VERSION).toBe(packageMetadata.version);
    expect(ACR_MILESTONE).toBe('M13');
    expect(createBootstrapStatus().status).toBe('adaptive-ready');
  });

  it('keeps the supported CLI entrypoint and release metadata stable', async () => {
    const packageMetadata = await readPackageMetadata();

    expect(packageMetadata.private).toBe(true);
    expect(packageMetadata.license).toBe('MIT');
    expect(packageMetadata.bin?.acr).toBe('dist/cli/router.js');
  });
});
