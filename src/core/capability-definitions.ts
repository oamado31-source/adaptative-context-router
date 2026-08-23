export interface CapabilityDefinition {
  id: string;
  name: string;
  binaries: readonly string[];
  configTokens: readonly string[];
}

export const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    binaries: ['claude'],
    configTokens: [],
  },
  {
    id: 'serena',
    name: 'Serena',
    binaries: ['serena', 'serena-mcp-server'],
    configTokens: ['serena', 'serena-mcp-server'],
  },
  {
    id: 'rtk',
    name: 'RTK',
    binaries: ['rtk'],
    configTokens: ['rtk'],
  },
  {
    id: 'pxpipe',
    name: 'pxpipe',
    binaries: ['pxpipe'],
    configTokens: ['pxpipe'],
  },
  {
    id: 'context-mode',
    name: 'Context Mode',
    binaries: ['context-mode'],
    configTokens: ['context-mode', 'mksglu/context-mode'],
  },
  {
    id: 'token-optimizer',
    name: 'Token Optimizer MCP',
    binaries: ['token-optimizer-mcp'],
    configTokens: [
      'token-optimizer-mcp',
      'ooples/token-optimizer',
      'cocaxcode/token-optimizer',
    ],
  },
  {
    id: 'jcodemunch',
    name: 'jCodeMunch',
    binaries: ['jcodemunch', 'jcodemunch-mcp'],
    configTokens: ['jcodemunch', 'jcodemunch-mcp'],
  },
] as const;
