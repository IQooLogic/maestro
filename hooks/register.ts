import type { Register } from 'claude-code'

// The main loop (no agentId) is the orchestrator and runs on this model.
const ORCHESTRATOR_MODEL = 'fable'

// Subagent type → model it is pinned to, whatever the Agent call asked for.
// Types not listed here keep the engine's choice (Plan inherits the orchestrator).
const SPAWN_MODELS: Record<string, string> = {
  'maestro:scout': 'haiku',
  'maestro:implementer-sonnet': 'sonnet',
  'maestro:implementer-opus': 'opus',
  Explore: 'haiku',
  'general-purpose': 'sonnet',
  claude: 'sonnet',
}

// Files the orchestrator may still edit itself: docs, plans, notes, and
// Claude's own config and memory. Everything else goes to an implementer.
const ORCHESTRATOR_EDITABLE = [/\.md$/, /(^|\/)\.claude\//]

const ROUTING = `# Maestro: model tiers

You are the orchestrator. You plan, decide, brief, and review. You do not write production code yourself: Edit, Write and NotebookEdit on code files are refused in this session's main loop.

Route every piece of work:
- Broad search or reading across many files → \`maestro:scout\` (Haiku). A single known file or line: read it yourself.
- Well-specified, contained change (one module, tests, boilerplate, mechanical refactor) → \`maestro:implementer-sonnet\`.
- Change that needs judgment (multi-file, concurrency, subtle bug, security- or design-sensitive) → \`maestro:implementer-opus\`.

Brief each implementer fully: goal, files, constraints, what is ruled out, how to verify. Review every result before you call the work done.`

let isEnforcing = true

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'maestro',
      description: 'Model tiers: allow (off) or block (on) code edits in the main session',
      argumentHint: '[on|off|status]',
    })

    return next(e)
  })

  on('command.run', { command: 'maestro' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'on') isEnforcing = true
    else if (arg === 'off') isEnforcing = false
    else if (arg !== '' && arg !== 'status') return { text: `maestro: unknown argument "${arg}" (use on, off or status)` }

    $.ui.status(isEnforcing ? undefined : 'maestro: main edits unlocked')

    return { text: `maestro: main-session code edits are ${isEnforcing ? 'blocked' : 'allowed'}` }
  })

  // Orchestrator model: rewrite only the main loop's requests; subagents,
  // compaction and memory forks all carry an agentId and are left alone.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    return yield* next({ ...e, model: ORCHESTRATOR_MODEL })
  })

  // Implementer and scout models: pinned at spawn so an Agent call's own
  // `model` parameter cannot move work to another tier.
  on('agent.spawn', ($, e, next) => {
    const model = SPAWN_MODELS[e.subagentType]
    if (model === undefined) return next(e)

    return next({ ...e, model })
  }).catch(($, e, next) => {
    $.ui.toast(`maestro: could not pin the model for ${e.subagentType}; it runs on the engine's choice`)
    return next(e)
  })

  // Routing rules ride the conversation's first prompt as hidden context. The
  // prompt.compose and prompt.context events are answered by a plugin above
  // this one and never reach here, so they cannot carry it.
  let hasRouted = false
  on('prompt.submit', ($, e, next) => {
    if (hasRouted) return next(e)
    hasRouted = true

    return next({ ...e, context: [...(e.context ?? []), ROUTING] })
  })

  // A main-loop compaction can summarize the rules away: the next prompt
  // carries them again. Subagent compactions and precomputes change nothing.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) hasRouted = false

    return result
  })

  // A /clear starts a new conversation with no session.start: re-arm here.
  on('session.end', ($, e, next) => {
    if (e.reason === 'clear') hasRouted = false

    return next(e)
  })

  const guardMainEdit = (agentId: string | undefined, path: string, tool: string): string | undefined => {
    if (!isEnforcing || agentId !== undefined) return undefined
    if (ORCHESTRATOR_EDITABLE.some(pattern => pattern.test(path))) return undefined

    return `maestro: the orchestrator does not ${tool} code (${path}). Delegate to maestro:implementer-sonnet or maestro:implementer-opus with a full brief. The person can lift this with /maestro off.`
  }

  on('tool.call', { tool: 'Edit' }, ($, e, next) => {
    const denied = guardMainEdit(e.agentId, e.file_path, 'Edit')
    return denied === undefined ? next(e) : { deny: denied }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'maestro: its edit guard failed.' }))

  on('tool.call', { tool: 'Write' }, ($, e, next) => {
    const denied = guardMainEdit(e.agentId, e.file_path, 'Write')
    return denied === undefined ? next(e) : { deny: denied }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'maestro: its edit guard failed.' }))

  on('tool.call', { tool: 'NotebookEdit' }, ($, e, next) => {
    const denied = guardMainEdit(e.agentId, e.notebook_path, 'NotebookEdit')
    return denied === undefined ? next(e) : { deny: denied }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'maestro: its edit guard failed.' }))
}
