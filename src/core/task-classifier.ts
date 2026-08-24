import type {
  PrecisionRequirement,
  RiskLevel,
  TaskProfile,
  TaskType,
} from './contracts.js';

export interface TaskClassificationInput {
  prompt: string;
}

export interface TaskClassificationResult {
  profile: TaskProfile;
  evidence: readonly string[];
}

interface ScoredTaskType {
  type: TaskType;
  score: number;
  evidence: string;
}

const SECRET_PATTERN =
  /\b(?:api[-_ ]?key|client secret|password|passphrase|private key|access token|refresh token|bearer token|credential(?:s)?)\b/iu;

const EXACT_IDENTIFIER_PATTERN =
  /\b(?:sha(?:-?1|-?256|-?512)?|checksum|hash|uuid|guid|commit sha|exact string|literal value|byte-for-byte|exact path|file path)\b/iu;

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;

const EXACT_ACTION_PATTERN =
  /\b(?:find|extract|return|identify|compare|verify|validate|show|locate|give me|what is)\b/iu;

const LARGE_LOG_PATTERN =
  /\b(?:logs?|stack trace|test output|terminal output|console output|build output|npm test|pytest|thousands? of lines|\d+k lines)\b/iu;

const LARGE_STRUCTURED_PATTERN =
  /\b(?:large|huge|massive|entire|thousands?|megabytes?|mb)\b[\s\S]{0,40}\b(?:json|csv|xml|yaml|payload|api response|mcp response|tool response)\b|\b(?:json|csv|xml|yaml|payload|api response|mcp response|tool response)\b[\s\S]{0,40}\b(?:large|huge|massive|entire|thousands?|megabytes?|mb)\b/iu;

const TARGETED_CODE_SEARCH_PATTERN =
  /\b(?:where is|find|locate|search for|references? to)\b[\s\S]{0,80}\b(?:defined|implemented|function|class|method|symbol|interface|type|constant|variable|handler|endpoint)\b|\b(?:find|locate)\b[\s\S]{0,40}\b(?:function|class|method|symbol|interface|type)\b/iu;

const REPOSITORY_EXPLORATION_PATTERN =
  /\b(?:repository architecture|repo architecture|codebase architecture|understand (?:the )?(?:repo|repository|codebase)|explore (?:the )?(?:repo|repository|codebase)|map (?:the )?(?:modules|architecture|codebase)|how (?:does )?(?:this|the) (?:project|repository|codebase) work)\b/iu;

const DEBUGGING_PATTERN =
  /\b(?:debug|bug|error|exception|failing|failure|stack trace|why .{0,40} fail|fix .{0,40} error|broken)\b/iu;

const SIMPLE_OPERATION_PATTERN =
  /\b(?:rename|change (?:the )?(?:(?:button|text|background|border|icon|link|header|footer|element|component) )?color|fix (?:the )?typo|update (?:the )?text|small edit|one-line change|single-line change)\b/iu;

const IMPLEMENTATION_PATTERN =
  /\b(?:implement|add (?:a |the )?(?:feature|function|method|endpoint|component)|create (?:a |the )?(?:function|class|component|endpoint|module)|build (?:a |the )?(?:feature|component|endpoint|module)|refactor|modify|write (?:a |the )?(?:function|class|component|module))\b/iu;

const SEMANTIC_LONG_CONTEXT_PATTERN =
  /\b(?:summari[sz]e|analy[sz]e|review|synthesi[sz]e)\b[\s\S]{0,80}\b(?:long|document|transcript|conversation|context|pages|report|research|history)\b|\b(?:long|document|transcript|conversation|context|pages|report|research|history)\b[\s\S]{0,80}\b(?:summari[sz]e|analy[sz]e|review|synthesi[sz]e)\b/iu;

function addCandidate(
  candidates: ScoredTaskType[],
  condition: boolean,
  type: TaskType,
  score: number,
  evidence: string,
): void {
  if (condition) {
    candidates.push({ type, score, evidence });
  }
}

function confidenceFromScore(score: number): number {
  if (score >= 7) return 0.97;
  if (score >= 6) return 0.94;
  if (score >= 5) return 0.9;
  if (score >= 4) return 0.84;
  if (score >= 3) return 0.76;
  if (score >= 2) return 0.68;
  return 0.55;
}

function expectedOutputSize(taskType: TaskType): 'small' | 'medium' | 'large' {
  switch (taskType) {
    case 'targeted_code_search':
    case 'exact_data':
    case 'simple_operation':
      return 'small';
    case 'repository_exploration':
    case 'semantic_long_context':
      return 'large';
    default:
      return 'medium';
  }
}

function precisionFor(
  taskType: TaskType,
  containsSecret: boolean,
  containsExactIdentifier: boolean,
): PrecisionRequirement {
  if (containsSecret) return 'secret-sensitive';
  if (containsExactIdentifier) return 'exact';

  switch (taskType) {
    case 'targeted_code_search':
    case 'repository_exploration':
    case 'implementation':
    case 'debugging':
      return 'structural';
    default:
      return 'semantic';
  }
}

function riskFor(precision: PrecisionRequirement): RiskLevel {
  switch (precision) {
    case 'secret-sensitive':
      return 'critical';
    case 'exact':
      return 'high';
    case 'structural':
      return 'medium';
    case 'semantic':
      return 'low';
  }
}

export function classifyTask(
  input: string | TaskClassificationInput,
): TaskClassificationResult {
  const prompt = typeof input === 'string' ? input : input.prompt;
  const normalized = prompt.trim();
  const containsSecret = SECRET_PATTERN.test(normalized);
  const containsExactIdentifier =
    EXACT_IDENTIFIER_PATTERN.test(normalized) || UUID_PATTERN.test(normalized);
  const candidates: ScoredTaskType[] = [];

  addCandidate(
    candidates,
    containsExactIdentifier && EXACT_ACTION_PATTERN.test(normalized),
    'exact_data',
    7,
    'Exact identifier/value retrieval signal detected.',
  );
  addCandidate(
    candidates,
    LARGE_LOG_PATTERN.test(normalized),
    'large_logs',
    6,
    'Large log or terminal-output signal detected.',
  );
  addCandidate(
    candidates,
    LARGE_STRUCTURED_PATTERN.test(normalized),
    'large_structured_data',
    6,
    'Large structured-data payload signal detected.',
  );
  addCandidate(
    candidates,
    TARGETED_CODE_SEARCH_PATTERN.test(normalized),
    'targeted_code_search',
    6,
    'Targeted symbol/code-location search signal detected.',
  );
  addCandidate(
    candidates,
    REPOSITORY_EXPLORATION_PATTERN.test(normalized),
    'repository_exploration',
    5,
    'Repository-wide architecture/exploration signal detected.',
  );
  addCandidate(
    candidates,
    SIMPLE_OPERATION_PATTERN.test(normalized) && normalized.length <= 220,
    'simple_operation',
    5,
    'Short, bounded edit signal detected.',
  );
  addCandidate(
    candidates,
    SEMANTIC_LONG_CONTEXT_PATTERN.test(normalized),
    'semantic_long_context',
    5,
    'Long semantic-context analysis signal detected.',
  );
  addCandidate(
    candidates,
    DEBUGGING_PATTERN.test(normalized),
    'debugging',
    4,
    'Debugging/failure-analysis signal detected.',
  );
  addCandidate(
    candidates,
    IMPLEMENTATION_PATTERN.test(normalized),
    'implementation',
    3,
    'Implementation/refactoring signal detected.',
  );

  const selected = candidates.sort((a, b) => b.score - a.score)[0] ?? {
    type: 'general_reasoning' as const,
    score: 1,
    evidence: 'No specialized workload rule matched; using general reasoning.',
  };

  const precision = precisionFor(
    selected.type,
    containsSecret,
    containsExactIdentifier,
  );
  const evidence = [selected.evidence];

  if (containsSecret) {
    evidence.push('Secret-sensitive material signal detected.');
  } else if (containsExactIdentifier) {
    evidence.push('Exact identifier/value precision required.');
  }

  return {
    profile: {
      taskType: selected.type,
      precision,
      risk: riskFor(precision),
      confidence: confidenceFromScore(selected.score),
      requiresExactIdentifiers:
        precision === 'exact' || precision === 'secret-sensitive',
      expectedOutputSize: expectedOutputSize(selected.type),
    },
    evidence,
  };
}
