import type { EngineInterface, Register } from 'claude-code'

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

// Files the orchestrator may still edit itself: docs, plans, notes, Claude's
// memory and settings. Everything else goes to an implementer, code under
// .claude/ too (hooks, plugins, and this plugin when linked into skills/).
const ORCHESTRATOR_EDITABLE = [
  /\.md$/,
  /(^|\/)\.claude\/(projects|plans|memory)\//,
  /(^|\/)\.claude\/settings(\.local)?\.json$/,
]

// Shell commands the scout may run: read-only ones its Read, Grep and Glob
// do not cover. A command passes only when it is plain words (so bash runs
// exactly the words checked here), starts with one of these, and names no
// option that writes a file or runs a program.
const SCOUT_COMMANDS = [['git', 'log'], ['git', 'show'], ['git', 'diff'], ['git', 'blame'], ['ls'], ['wc']]

// No quotes, backslashes, $, globs, braces, operators, tabs or newlines: bash
// can neither expand nor split a word differently from the check below.
const PLAIN_WORDS = /^[A-Za-z0-9_\-./:,=@^~%+ ]+$/

// Matched as git matches them, by any unambiguous prefix (--out= is --output=).
const RISKY_OPTIONS = ['--output', '--ext-diff', '--textconv']

const scoutCommandRefusal = (command: string): string | undefined => {
  if (!PLAIN_WORDS.test(command)) return 'it uses shell syntax (quotes, \\, $, globs, braces or operators); use plain words only'

  const words = command.trim().split(/ +/)
  const isListed = SCOUT_COMMANDS.some(prefix => prefix.every((word, i) => words[i] === word))
  if (!isListed) return `it is not one of: ${SCOUT_COMMANDS.map(prefix => prefix.join(' ')).join(', ')}`

  const isRisky = (word: string) => {
    const name = word.split('=')[0]
    return name.startsWith('--') && name.length > 2 && RISKY_OPTIONS.some(option => option.startsWith(name))
  }
  if (words.some(isRisky)) return `it writes a file or runs a program (${RISKY_OPTIONS.join(', ')}, or a prefix of one)`

  return undefined
}

// The work tree's changed files (git status), each with its size and mtime, or
// 'gone' when it no longer exists. Read before and after a main-loop Bash call:
// a shell writes files in too many ways to tell from the command itself.
type WorkTree = Map<string, string>

// Changed paths listed in the report before it is cut to a count.
const REPORT_PATHS = 10

const readWorkTree = async ($: EngineInterface): Promise<WorkTree | undefined> => {
  // Optional locks off: the check itself must not touch the index.
  const env = { GIT_OPTIONAL_LOCKS: '0' }
  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { env })
  if (top.exitCode !== 0) return undefined
  const root = top.stdout.trim()

  const status = await $.process.run(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, env })
  if (status.exitCode !== 0) throw new Error(`git status exited ${status.exitCode}: ${status.stderr.trim()}`)
  if (status.isStdoutTruncated) throw new Error('git status listed more than it can read')

  // Each entry is "XY path"; a rename or copy (X is R or C) is followed by its source path.
  const paths: string[] = []
  const fields = status.stdout.split('\0')
  for (let i = 0; i < fields.length; i++) {
    if (fields[i] === '') continue
    paths.push(`${root}/${fields[i].slice(3)}`)
    if (fields[i][0] === 'R' || fields[i][0] === 'C') i++
  }

  // A deleted file does not stat: that is its state, not a failure.
  const states = await Promise.all(
    paths.map(path => $.fs.stat(path).then(
      stat => `${stat.size}:${stat.mtimeMs}`,
      () => 'gone',
    )),
  )

  return new Map(paths.map((path, i) => [path, states[i]]))
}

const changedCode = (before: WorkTree, after: WorkTree): string[] => {
  const paths = new Set([...before.keys(), ...after.keys()])
  return [...paths].filter(path => before.get(path) !== after.get(path) && !ORCHESTRATOR_EDITABLE.some(pattern => pattern.test(path)))
}

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
    else if (arg !== '' && arg !== 'status') return { text: `unknown argument "${arg}" (use on, off or status)` }

    $.ui.status(isEnforcing ? undefined : 'maestro: main edits unlocked')

    return { text: `main-session code edits are ${isEnforcing ? 'blocked' : 'allowed'}` }
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

  // One Bash hook for both loops: when a hook throws, the plugin's outer .catch
  // answers, so a second Bash hook would fail with this one's text.
  //
  // The scout's Bash is held to SCOUT_COMMANDS. Its type is looked up per call,
  // not remembered from agent.spawn, so a reload mid-run cannot unguard it.
  //
  // The main loop's Bash runs, but code it changes is reported to the model and
  // the person: the work tree is compared before and after. Nothing is undone.
  // Outside a git work tree there is nothing to compare, and the command runs.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.agentId !== undefined) {
      const agents = await $.agent.list()
      const isScout = agents.some(agent => agent.id === e.agentId && agent.type === 'maestro:scout')
      if (!isScout) return next(e)

      const refusal = scoutCommandRefusal(e.command)
      return refusal === undefined ? next(e) : { deny: `maestro: the scout is read-only and cannot run "${e.command}": ${refusal}.` }
    }

    if (!isEnforcing) return next(e)

    const before = await readWorkTree($)
    if (before === undefined) return next(e)

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isReadOnly === true) return ran

    let changed: string[]
    try {
      const after = await readWorkTree($)
      changed = after === undefined ? [] : changedCode(before, after)
    } catch (error) {
      $.ui.toast('maestro: could not check what the last shell command changed')
      const note = `maestro: could not check whether this command changed code files: ${error instanceof Error ? error.message : String(error)}.`
      return { ...ran, context: [...(ran.context ?? []), note] }
    }
    if (changed.length === 0) return ran

    const listed = changed.slice(0, REPORT_PATHS).join(', ')
    const more = changed.length > REPORT_PATHS ? ` and ${changed.length - REPORT_PATHS} more` : ''
    $.ui.toast(`maestro: the main session's shell changed ${changed.length} code file(s)`)
    const note = `maestro: this command changed code files, which the orchestrator does not write: ${listed}${more}. Nothing was undone. Tell the person what changed, and delegate code changes to maestro:implementer-sonnet or maestro:implementer-opus.`

    return { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    if (e.agentId !== undefined) return { deny: 'maestro: its scout shell guard failed.' }

    return { deny: 'maestro: could not read the work tree before this command, so it did not run. The person can lift the check with /maestro off.' }
  })

  on('tool.call', { tool: 'NotebookEdit' }, ($, e, next) => {
    const denied = guardMainEdit(e.agentId, e.notebook_path, 'NotebookEdit')
    return denied === undefined ? next(e) : { deny: denied }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'maestro: its edit guard failed.' }))
}
