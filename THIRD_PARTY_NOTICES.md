# Third-Party Notices and Integration Policy

ACR is designed to integrate with external context-optimization tools through adapters. The core repository must not silently redistribute or embed third-party code unless its license is explicitly compatible and attribution requirements are satisfied.

## Initial integration targets

| Tool / project | Planned use in ACR | Initial policy |
|---|---|---|
| Anthropic Claude Code native features | Hooks, Skills, Tool Search, compaction and related context controls | Native integration; no vendoring |
| Serena | Symbolic / semantic code retrieval | External adapter; no vendoring by default |
| RTK | Shell-output filtering | External CLI adapter |
| ooples/token-optimizer-mcp | Measurement, cache/diff and MCP optimization patterns | Prefer external integration; selectively adapt MIT-licensed patterns with attribution if needed |
| cocaxcode/token-optimizer-mcp | Orchestration, detection and coaching patterns | Prefer external integration; selectively adapt MIT-licensed patterns with attribution if needed |
| pxpipe | Optical context compression | External proxy adapter; preserve exact-data safety guard |
| Context Mode | Tool-output sandboxing / filtering | External adapter only unless a later license review explicitly approves another use |
| jCodeMunch | Symbol-level retrieval | External adapter only; do not redistribute without explicit license approval |

## Rules

1. Every incorporated source fragment must retain required copyright and license notices.
2. External tools should remain independently installable and replaceable whenever practical.
3. `acr doctor` will detect capabilities; ACR will not silently install third-party tools.
4. License status must be rechecked before any public release that changes the integration model.
5. Commercialization requires a dedicated license review for all enabled adapters.
