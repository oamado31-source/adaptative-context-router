import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { TaskType } from '../core/contracts.js';
import type { BenchmarkArm } from './contracts.js';
import type {
  BenchmarkCorpusControls,
  BenchmarkCorpusManifest,
  BenchmarkCorpusQuality,
  BenchmarkCorpusTarget,
} from './corpus.js';

export type BenchmarkCampaignCaseStatus = 'ready' | 'blocked';

export interface BenchmarkCampaignCase {
  id: string;
  title: string;
  taskType: TaskType;
  task: string;
  taskFingerprint: string;
  routingContextRatio: number;
  expectedStrategy: string;
  requiredCapabilities: readonly string[];
  missingCapabilities: readonly string[];
  status: BenchmarkCampaignCaseStatus;
  quality: BenchmarkCorpusQuality;
}

export interface BenchmarkCampaignRun {
  id: string;
  caseId: string;
  arm: BenchmarkArm;
  repetition: number;
  sequence: number;
  taskFingerprint: string;
  routingContextRatio: number;
  expectedStrategy: string;
  model: string;
  targetRevision: string;
}

export interface BenchmarkCampaign {
  schemaVersion: 1;
  id: string;
  corpusId: string;
  evidenceMode: 'real';
  provider: 'claude-code';
  model: string;
  target: BenchmarkCorpusTarget;
  controls: BenchmarkCorpusControls;
  availableCapabilities: readonly string[];
  cases: readonly BenchmarkCampaignCase[];
  runs: readonly BenchmarkCampaignRun[];
  externalExecution: false;
}

export interface BuildBenchmarkCampaignOptions {
  model: string;
  availableCapabilities: readonly string[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireNonEmptyString(value: string, label: string): string {
  if (value.trim() === '') throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function normalizedCapabilities(
  capabilities: readonly string[],
): readonly string[] {
  const normalized = capabilities.map((item) =>
    requireNonEmptyString(item, 'available capability'),
  );
  return [...new Set(normalized)].sort();
}

function campaignId(
  corpus: BenchmarkCorpusManifest,
  model: string,
  capabilities: readonly string[],
): string {
  const fingerprint = sha256(
    [corpus.id, corpus.target.revision, model, capabilities.join(',')].join('\0'),
  ).slice(0, 16);
  return `${corpus.id}-${fingerprint}`;
}

function armOrder(repetition: number): readonly BenchmarkArm[] {
  return repetition % 2 === 1 ? ['baseline', 'acr'] : ['acr', 'baseline'];
}

export function buildBenchmarkCampaign(
  corpus: BenchmarkCorpusManifest,
  options: BuildBenchmarkCampaignOptions,
): BenchmarkCampaign {
  const model = requireNonEmptyString(options.model, 'model');
  const availableCapabilities = normalizedCapabilities(
    options.availableCapabilities,
  );
  const available = new Set(availableCapabilities);
  const cases: BenchmarkCampaignCase[] = [];
  const runs: BenchmarkCampaignRun[] = [];
  let sequence = 0;

  for (const corpusCase of corpus.cases) {
    const taskFingerprint = sha256(corpusCase.task);
    const missingCapabilities = corpusCase.requiredCapabilities.filter(
      (capability) => !available.has(capability),
    );
    const status: BenchmarkCampaignCaseStatus =
      missingCapabilities.length === 0 ? 'ready' : 'blocked';

    const campaignCase: BenchmarkCampaignCase = {
      id: corpusCase.id,
      title: corpusCase.title,
      taskType: corpusCase.taskType,
      task: corpusCase.task,
      taskFingerprint,
      routingContextRatio: corpusCase.routingContextRatio,
      expectedStrategy: corpusCase.expectedStrategy,
      requiredCapabilities: [...corpusCase.requiredCapabilities],
      missingCapabilities,
      status,
      quality: {
        minimumScore: corpusCase.quality.minimumScore,
        assertions: [...corpusCase.quality.assertions],
      },
    };
    cases.push(campaignCase);

    if (status === 'blocked') continue;

    for (
      let repetition = 1;
      repetition <= corpus.controls.repetitionsPerArm;
      repetition += 1
    ) {
      for (const arm of armOrder(repetition)) {
        sequence += 1;
        runs.push({
          id: `${corpusCase.id}--r${repetition}--${arm}`,
          caseId: corpusCase.id,
          arm,
          repetition,
          sequence,
          taskFingerprint,
          routingContextRatio: corpusCase.routingContextRatio,
          expectedStrategy: corpusCase.expectedStrategy,
          model,
          targetRevision: corpus.target.revision,
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    id: campaignId(corpus, model, availableCapabilities),
    corpusId: corpus.id,
    evidenceMode: 'real',
    provider: 'claude-code',
    model,
    target: { ...corpus.target },
    controls: { ...corpus.controls },
    availableCapabilities,
    cases,
    runs,
    externalExecution: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((item, index) => requireString(item, `${label}[${index}]`));
}

function parseCampaignCase(value: unknown, index: number): BenchmarkCampaignCase {
  const prefix = `campaign.cases[${index}]`;
  if (!isRecord(value)) throw new Error(`${prefix} must be an object.`);
  if (value.status !== 'ready' && value.status !== 'blocked') {
    throw new Error(`${prefix}.status must be ready or blocked.`);
  }
  if (!isRecord(value.quality)) {
    throw new Error(`${prefix}.quality must be an object.`);
  }
  const minimumScore = value.quality.minimumScore;
  if (
    typeof minimumScore !== 'number' ||
    !Number.isFinite(minimumScore) ||
    minimumScore < 0 ||
    minimumScore > 1
  ) {
    throw new Error(`${prefix}.quality.minimumScore must be between 0 and 1.`);
  }
  const routingContextRatio = value.routingContextRatio;
  if (
    typeof routingContextRatio !== 'number' ||
    !Number.isFinite(routingContextRatio) ||
    routingContextRatio < 0 ||
    routingContextRatio > 1
  ) {
    throw new Error(`${prefix}.routingContextRatio must be between 0 and 1.`);
  }

  return {
    id: requireString(value.id, `${prefix}.id`),
    title: requireString(value.title, `${prefix}.title`),
    taskType: requireString(value.taskType, `${prefix}.taskType`) as TaskType,
    task: requireString(value.task, `${prefix}.task`),
    taskFingerprint: requireString(
      value.taskFingerprint,
      `${prefix}.taskFingerprint`,
    ),
    routingContextRatio,
    expectedStrategy: requireString(
      value.expectedStrategy,
      `${prefix}.expectedStrategy`,
    ),
    requiredCapabilities: requireStringArray(
      value.requiredCapabilities,
      `${prefix}.requiredCapabilities`,
    ),
    missingCapabilities: requireStringArray(
      value.missingCapabilities,
      `${prefix}.missingCapabilities`,
    ),
    status: value.status,
    quality: {
      minimumScore,
      assertions: requireStringArray(
        value.quality.assertions,
        `${prefix}.quality.assertions`,
      ),
    },
  };
}

function parseCampaignRun(value: unknown, index: number): BenchmarkCampaignRun {
  const prefix = `campaign.runs[${index}]`;
  if (!isRecord(value)) throw new Error(`${prefix} must be an object.`);
  if (value.arm !== 'baseline' && value.arm !== 'acr') {
    throw new Error(`${prefix}.arm must be baseline or acr.`);
  }
  const repetition = value.repetition;
  const sequence = value.sequence;
  const routingContextRatio = value.routingContextRatio;
  if (
    typeof repetition !== 'number' ||
    !Number.isInteger(repetition) ||
    repetition < 1
  ) {
    throw new Error(`${prefix}.repetition must be a positive integer.`);
  }
  if (
    typeof sequence !== 'number' ||
    !Number.isInteger(sequence) ||
    sequence < 1
  ) {
    throw new Error(`${prefix}.sequence must be a positive integer.`);
  }
  if (
    typeof routingContextRatio !== 'number' ||
    !Number.isFinite(routingContextRatio) ||
    routingContextRatio < 0 ||
    routingContextRatio > 1
  ) {
    throw new Error(`${prefix}.routingContextRatio must be between 0 and 1.`);
  }

  return {
    id: requireString(value.id, `${prefix}.id`),
    caseId: requireString(value.caseId, `${prefix}.caseId`),
    arm: value.arm,
    repetition,
    sequence,
    taskFingerprint: requireString(
      value.taskFingerprint,
      `${prefix}.taskFingerprint`,
    ),
    routingContextRatio,
    expectedStrategy: requireString(
      value.expectedStrategy,
      `${prefix}.expectedStrategy`,
    ),
    model: requireString(value.model, `${prefix}.model`),
    targetRevision: requireString(
      value.targetRevision,
      `${prefix}.targetRevision`,
    ),
  };
}

export function parseBenchmarkCampaign(value: unknown): BenchmarkCampaign {
  if (!isRecord(value)) throw new Error('campaign must be an object.');
  if (value.schemaVersion !== 1) {
    throw new Error('campaign.schemaVersion must be 1.');
  }
  if (value.evidenceMode !== 'real' || value.provider !== 'claude-code') {
    throw new Error('campaign must use real Claude Code evidence.');
  }
  if (value.externalExecution !== false) {
    throw new Error('campaign.externalExecution must be false.');
  }
  if (!isRecord(value.target) || !isRecord(value.controls)) {
    throw new Error('campaign target and controls must be objects.');
  }
  if (!Array.isArray(value.cases) || !Array.isArray(value.runs)) {
    throw new Error('campaign cases and runs must be arrays.');
  }

  const targetRevision = requireString(
    value.target.revision,
    'campaign.target.revision',
  );
  if (!/^[0-9a-f]{40}$/u.test(targetRevision)) {
    throw new Error('campaign.target.revision must be a full commit SHA.');
  }
  const repetitionsPerArm = value.controls.repetitionsPerArm;
  if (
    typeof repetitionsPerArm !== 'number' ||
    !Number.isInteger(repetitionsPerArm) ||
    repetitionsPerArm < 3
  ) {
    throw new Error('campaign.controls.repetitionsPerArm must be >= 3.');
  }
  if (
    value.controls.samePrompt !== true ||
    value.controls.sameProviderModel !== true ||
    value.controls.sessionPersistence !== false ||
    value.controls.order !== 'alternating' ||
    value.controls.qualityEvaluation !== 'blinded-rubric'
  ) {
    throw new Error('campaign controls do not preserve the real corpus contract.');
  }

  const cases = value.cases.map(parseCampaignCase);
  const runs = value.runs.map(parseCampaignRun);
  const caseIds = new Set(cases.map((item) => item.id));
  if (caseIds.size !== cases.length) {
    throw new Error('campaign case IDs must be unique.');
  }
  const runIds = new Set(runs.map((item) => item.id));
  if (runIds.size !== runs.length) {
    throw new Error('campaign run IDs must be unique.');
  }
  for (const run of runs) {
    const campaignCase = cases.find((item) => item.id === run.caseId);
    if (!campaignCase || campaignCase.status !== 'ready') {
      throw new Error(`campaign run ${run.id} references a non-ready case.`);
    }
    if (
      run.model !== value.model ||
      run.targetRevision !== targetRevision ||
      run.taskFingerprint !== campaignCase.taskFingerprint
    ) {
      throw new Error(`campaign run ${run.id} violates pinned campaign provenance.`);
    }
  }

  return {
    schemaVersion: 1,
    id: requireString(value.id, 'campaign.id'),
    corpusId: requireString(value.corpusId, 'campaign.corpusId'),
    evidenceMode: 'real',
    provider: 'claude-code',
    model: requireString(value.model, 'campaign.model'),
    target: {
      repository: requireString(
        value.target.repository,
        'campaign.target.repository',
      ),
      revision: targetRevision,
    },
    controls: {
      repetitionsPerArm,
      samePrompt: true,
      sameProviderModel: true,
      sessionPersistence: false,
      order: 'alternating',
      qualityEvaluation: 'blinded-rubric',
    },
    availableCapabilities: requireStringArray(
      value.availableCapabilities,
      'campaign.availableCapabilities',
    ),
    cases,
    runs,
    externalExecution: false,
  };
}

export async function loadBenchmarkCampaign(
  path: string,
): Promise<BenchmarkCampaign> {
  const raw = await readFile(path, 'utf8');
  return parseBenchmarkCampaign(JSON.parse(raw) as unknown);
}
