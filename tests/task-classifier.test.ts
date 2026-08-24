import { describe, expect, it } from 'vitest';

import { classifyTask } from '../src/core/task-classifier.js';

describe('classifyTask', () => {
  it('classifies targeted code search as structural', () => {
    const result = classifyTask('Find where authenticateUser is defined in this repository.');

    expect(result.profile.taskType).toBe('targeted_code_search');
    expect(result.profile.precision).toBe('structural');
    expect(result.profile.risk).toBe('medium');
    expect(result.profile.requiresExactIdentifiers).toBe(false);
  });

  it('classifies exact hashes as high-risk exact data', () => {
    const result = classifyTask('Find the exact SHA-256 hash in this output and return it unchanged.');

    expect(result.profile.taskType).toBe('exact_data');
    expect(result.profile.precision).toBe('exact');
    expect(result.profile.risk).toBe('high');
    expect(result.profile.requiresExactIdentifiers).toBe(true);
  });

  it('classifies UUID retrieval as exact data', () => {
    const result = classifyTask(
      'Verify UUID 550e8400-e29b-41d4-a716-446655440000 and show the exact value.',
    );

    expect(result.profile.taskType).toBe('exact_data');
    expect(result.profile.precision).toBe('exact');
  });

  it('classifies large test output as large logs', () => {
    const result = classifyTask('Analyze these 40k lines of npm test output and identify the failures.');

    expect(result.profile.taskType).toBe('large_logs');
    expect(result.profile.expectedOutputSize).toBe('medium');
  });

  it('classifies large JSON payloads as structured data', () => {
    const result = classifyTask('Analyze this huge MCP response JSON payload and summarize the anomalies.');

    expect(result.profile.taskType).toBe('large_structured_data');
    expect(result.profile.precision).toBe('semantic');
  });

  it('classifies repository architecture exploration', () => {
    const result = classifyTask('Understand the repository architecture and map the modules.');

    expect(result.profile.taskType).toBe('repository_exploration');
    expect(result.profile.precision).toBe('structural');
    expect(result.profile.expectedOutputSize).toBe('large');
  });

  it('classifies short bounded edits as simple operations', () => {
    const result = classifyTask('Change the color of the button.');

    expect(result.profile.taskType).toBe('simple_operation');
    expect(result.profile.risk).toBe('low');
    expect(result.profile.expectedOutputSize).toBe('small');
  });

  it('classifies implementation work', () => {
    const result = classifyTask('Implement a new endpoint for routing telemetry events.');

    expect(result.profile.taskType).toBe('implementation');
    expect(result.profile.precision).toBe('structural');
  });

  it('classifies debugging work', () => {
    const result = classifyTask('Debug why the authentication request fails after refresh.');

    expect(result.profile.taskType).toBe('debugging');
    expect(result.profile.precision).toBe('structural');
  });

  it('elevates secret-sensitive tasks to critical risk', () => {
    const result = classifyTask('Find the API key in this configuration and compare it exactly.');

    expect(result.profile.precision).toBe('secret-sensitive');
    expect(result.profile.risk).toBe('critical');
    expect(result.profile.requiresExactIdentifiers).toBe(true);
    expect(result.evidence).toContain('Secret-sensitive material signal detected.');
  });

  it('falls back to general reasoning when no specialized rule matches', () => {
    const result = classifyTask('Explain the tradeoffs between latency and cost.');

    expect(result.profile.taskType).toBe('general_reasoning');
    expect(result.profile.precision).toBe('semantic');
    expect(result.profile.confidence).toBeLessThan(0.7);
  });
});
