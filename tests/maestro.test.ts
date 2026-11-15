import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

test('main loop cannot edit code but can edit markdown and ~/.claude', async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  const code = await $.tool.call({ tool: 'Edit', file_path: '/repo/main.go', old_string: 'a', new_string: 'b' })
  expect(code.deny).toContain('the orchestrator does not Edit code (/repo/main.go)')

  const doc = await $.tool.call({ tool: 'Write', file_path: '/repo/docs/plans/plan.md', content: 'x' })
  expect(doc.isError).not.toBe(true)

  const memory = await $.tool.call({ tool: 'Write', file_path: '/home/u/.claude/memory/x.txt', content: 'x' })
  expect(memory.isError).not.toBe(true)
})

test('under .claude/ the main loop edits memory, plans and settings, not code', async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  const allowed = [
    '/home/u/.claude/projects/-repo/memory/notes.json',
    '/home/u/.claude/plans/plan.txt',
    '/home/u/.claude/settings.json',
    '/repo/.claude/settings.local.json',
  ]
  for (const file_path of allowed) {
    const ran = await $.tool.call({ tool: 'Write', file_path, content: 'x' })
    expect(ran.isError).not.toBe(true)
  }

  const blocked = [
    '/repo/.claude/hooks/check.ts',
    '/home/u/.claude/skills/maestro/hooks/register.ts',
    '/home/u/.claude/plugins/cache/x/index.js',
  ]
  for (const file_path of blocked) {
    const ran = await $.tool.call({ tool: 'Write', file_path, content: 'x' })
    expect(ran.deny).toContain('the orchestrator does not Write')
  }
})

test('a subagent can edit code', async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  const ran = await $.tool.call({ tool: 'Edit', file_path: '/repo/main.go', old_string: 'a', new_string: 'b', agentId: 'a1' })
  expect(ran.isError).not.toBe(true)
})

test('spawn pins each tier to its model, whatever the call asked', async ($, on) => {
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'unset', agentId: 'a1' }))

  const cases = [
    { subagentType: 'maestro:scout', want: 'haiku' },
    { subagentType: 'maestro:implementer-sonnet', want: 'sonnet' },
    { subagentType: 'maestro:implementer-opus', want: 'opus' },
    { subagentType: 'Explore', want: 'haiku' },
    { subagentType: 'general-purpose', want: 'sonnet' },
  ]
  for (const c of cases) {
    const got = await $.agent.spawn({ subagentType: c.subagentType, prompt: 'x', model: 'fable' })
    expect(got.model).toBe(c.want)
  }

  const plan = await $.agent.spawn({ subagentType: 'Plan', prompt: 'x', model: 'fable' })
  expect(plan.model).toBe('fable')
})

test('the routing rules ride the first prompt only', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  const first = await $.prompt.submit({ text: 'hello' })
  expect(first.context?.some(c => c.includes('maestro:scout'))).toBe(true)

  const second = await $.prompt.submit({ text: 'again' })
  expect(second.context ?? []).toEqual([])
})

test('the routing rules ride the first prompt after a /clear', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))

  await $.prompt.submit({ text: 'hello' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const afterClear = await $.prompt.submit({ text: 'fresh' })
  expect(afterClear.context?.some(c => c.includes('maestro:scout'))).toBe(true)
})

test('the routing rules ride the first prompt after a main-loop compaction only', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const summary = [{ role: 'user' as const, text: 'summary', toolUses: [] }]
  on('session.compact', () => ({ messages: summary }))

  await $.prompt.submit({ text: 'hello' })

  await $.session.compact({ trigger: 'auto', messages: summary, agentId: 'a1' })
  const afterSubagent = await $.prompt.submit({ text: 'again' })
  expect(afterSubagent.context ?? []).toEqual([])

  await $.session.compact({ trigger: 'precompute', messages: summary })
  const afterPrecompute = await $.prompt.submit({ text: 'again' })
  expect(afterPrecompute.context ?? []).toEqual([])

  await $.session.compact({ trigger: 'auto', messages: summary })
  const afterMain = await $.prompt.submit({ text: 'again' })
  expect(afterMain.context?.some(c => c.includes('maestro:scout'))).toBe(true)
})

test('/maestro off lets the main loop edit code, /maestro on blocks it again', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('ui.status', () => ({ value: undefined }))

  const off = await $.command.run({ command: 'maestro', args: 'off' })
  expect(off.text).toBe('main-session code edits are allowed')
  const unlocked = await $.tool.call({ tool: 'Edit', file_path: '/repo/main.go', old_string: 'a', new_string: 'b' })
  expect(unlocked.deny).toBeUndefined()

  const status = await $.command.run({ command: 'maestro', args: 'status' })
  expect(status.text).toBe('main-session code edits are allowed')

  const back = await $.command.run({ command: 'maestro', args: 'on' })
  expect(back.text).toBe('main-session code edits are blocked')
  const locked = await $.tool.call({ tool: 'Edit', file_path: '/repo/main.go', old_string: 'a', new_string: 'b' })
  expect(locked.deny).toContain('the orchestrator does not Edit')
})

test('/maestro refuses an unknown argument and keeps its state', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))

  const bad = await $.command.run({ command: 'maestro', args: 'maybe' })
  expect(bad.text).toBe('unknown argument "maybe" (use on, off or status)')

  const status = await $.command.run({ command: 'maestro', args: '' })
  expect(status.text).toBe('main-session code edits are blocked')
})

test('the main loop cannot edit a notebook', async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  const ran = await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/repo/analysis.ipynb', new_source: 'x' })
  expect(ran.deny).toContain('the orchestrator does not NotebookEdit code (/repo/analysis.ipynb)')
})

test('the main loop runs on the orchestrator model, a subagent keeps its own', async ($, on) => {
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: e.model, toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })

  const step = async (agentId?: string) => {
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1, agentId })
    let chunk = await stream.next()
    while (chunk.done !== true) chunk = await stream.next()
    return chunk.value.answer
  }

  expect(await step()).toBe('fable')
  expect(await step('a1')).toBe('opus')
})

test('the claude agent type is pinned to sonnet', async ($, on) => {
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'unset', agentId: 'a1' }))

  const got = await $.agent.spawn({ subagentType: 'claude', prompt: 'x', model: 'opus' })
  expect(got.model).toBe('sonnet')
})

test('the scout runs only listed read-only shell commands', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({
    value: [
      { id: 's1', type: 'maestro:scout', description: 'find', status: 'running' as const },
      { id: 'i1', type: 'maestro:implementer-sonnet', description: 'fix', status: 'running' as const },
    ],
  }))

  const allowed = [
    'git log --oneline -5',
    'git log --format=%h%x09%an%x09%s -- src/a.go',
    'git show HEAD:go.mod',
    'git diff main -- src',
    'git diff --no-ext-diff main',
    'git blame -L 1,9 a.go',
    'ls -la src',
    'wc -l a.go',
  ]
  for (const command of allowed) {
    const ran = await $.tool.call({ tool: 'Bash', command, agentId: 's1' })
    expect(ran.deny).toBeUndefined()
  }

  const refused = [
    'rm -rf src',
    'git commit -m x',
    'git -C /tmp log',
    'git log > out.txt',
    'git log | head',
    'git log; rm a.go',
    'ls && rm a.go',
    'ls $(rm a.go)',
    'ls `rm a.go`',
    'git log\nrm a.go',
    'git diff --output=a.go',
    'git log "--output" a.go',
    'git log --out=a.go',
    'git log --o=a.go',
    'git log --out\\put=a.go',
    'git log --o${x}utput=a.go',
    'git log --{output,x}=a.go',
    'git log --outpu?=a.go',
    "git log --format='%h' a.go",
    'git diff --ext-diff',
    'git diff --textconv',
    'git log\t--output=a.go',
  ]
  for (const command of refused) {
    const ran = await $.tool.call({ tool: 'Bash', command, agentId: 's1' })
    expect(ran.deny).toContain('maestro: the scout is read-only')
  }
})

test('other subagents and the main loop keep their shell', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('process.run', () => run(128, '', 'fatal: not a git repository'))
  on('agent.list', () => ({
    value: [{ id: 'i1', type: 'maestro:implementer-sonnet', description: 'fix', status: 'running' as const }],
  }))

  const implementer = await $.tool.call({ tool: 'Bash', command: 'go test ./... > out.txt', agentId: 'i1' })
  expect(implementer.deny).toBeUndefined()

  const main = await $.tool.call({ tool: 'Bash', command: 'make build && make test' })
  expect(main.deny).toBeUndefined()
})

test('a failed agent lookup refuses the subagent command', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => {
    throw new Error('lookup down')
  })

  const ran = await $.tool.call({ tool: 'Bash', command: 'rm -rf src', agentId: 's1' })
  expect(ran.deny).toBe('maestro: its scout shell guard failed.')
})

const run = (exitCode: number, stdout = '', stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

// A git work tree at /repo: `status` is what git status prints next, and
// `files` holds each file's size:mtime ('gone' fails the stat).
const fakeRepo = (on: On) => {
  const repo = { status: '', files: new Map<string, string>(), gitCalls: 0, toasts: [] as string[] }
  on('process.run', (_, e) => {
    repo.gitCalls++
    if (e.argv[1] === 'rev-parse') return run(0, '/repo\n')
    return run(0, repo.status)
  })
  on('fs.stat', (_, e) => {
    const state = repo.files.get(e.path)
    if (state === undefined || state === 'gone') throw new Error(`ENOENT: ${e.path}`)
    const [size, mtimeMs] = state.split(':').map(Number)
    return { value: { kind: 'file' as const, size, mtimeMs, isLink: false } }
  })
  on('ui.toast', (_, e) => {
    repo.toasts.push(e.text)
    return { value: undefined }
  })
  return repo
}

test('a main-loop shell command that changes code is reported, docs are not', async ($, on) => {
  const repo = fakeRepo(on)
  on('tool.call', () => {
    repo.status = ' M main.go\0?? docs/notes.md\0?? pkg/new.go\0'
    repo.files.set('/repo/main.go', '10:2')
    repo.files.set('/repo/docs/notes.md', '5:2')
    repo.files.set('/repo/pkg/new.go', '3:2')
    return { result: { stdout: '', stderr: '' } }
  })

  const ran = await $.tool.call({ tool: 'Bash', command: "sed -i 's/a/b/' main.go" })
  expect(ran.deny).toBeUndefined()
  const note = ran.context?.find(c => c.startsWith('maestro:')) ?? ''
  expect(note).toContain('changed code files, which the orchestrator does not write: /repo/main.go, /repo/pkg/new.go.')
  expect(note).not.toContain('notes.md')
  expect(repo.toasts).toEqual(["maestro: the main session's shell changed 2 code file(s)"])
})

test('a file already changed before the command is reported only if the command changed it again', async ($, on) => {
  const repo = fakeRepo(on)
  repo.status = ' M main.go\0 M util.go\0R  renamed.go\0old.go\0'
  repo.files.set('/repo/main.go', '10:1')
  repo.files.set('/repo/util.go', '7:1')
  repo.files.set('/repo/renamed.go', '4:1')
  on('tool.call', () => {
    repo.files.set('/repo/util.go', '8:2')
    return { result: { stdout: '', stderr: '' } }
  })

  const ran = await $.tool.call({ tool: 'Bash', command: 'make fmt' })
  const note = ran.context?.find(c => c.startsWith('maestro:')) ?? ''
  expect(note).toContain('does not write: /repo/util.go.')
  expect(note).not.toContain('main.go')
  expect(note).not.toContain('old.go')
})

test('a deleted or reverted code file is reported', async ($, on) => {
  const repo = fakeRepo(on)
  repo.status = ' M main.go\0'
  repo.files.set('/repo/main.go', '10:1')
  repo.files.set('/repo/util.go', '7:1')
  on('tool.call', () => {
    repo.status = ' D util.go\0'
    repo.files.set('/repo/util.go', 'gone')
    return { result: { stdout: '', stderr: '' } }
  })

  const ran = await $.tool.call({ tool: 'Bash', command: 'git checkout -- main.go && rm util.go' })
  const note = ran.context?.find(c => c.startsWith('maestro:')) ?? ''
  expect(note).toContain('does not write: /repo/main.go, /repo/util.go.')
})

test('a shell command that changes no code adds nothing', async ($, on) => {
  const repo = fakeRepo(on)
  on('tool.call', () => {
    repo.status = '?? PLAN.md\0'
    repo.files.set('/repo/PLAN.md', '1:1')
    return { result: { stdout: '', stderr: '' } }
  })

  const ran = await $.tool.call({ tool: 'Bash', command: 'echo x > PLAN.md' })
  expect(ran.context ?? []).toEqual([])
  expect(repo.toasts).toEqual([])
})

test('a read-only command is not checked after it runs', async ($, on) => {
  const repo = fakeRepo(on)
  on('tool.call', () => ({ result: { stdout: '', stderr: '' }, isReadOnly: true as const }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(repo.gitCalls).toBe(2)
})

test('a subagent, /maestro off and a folder outside git skip the check', async ($, on) => {
  const repo = fakeRepo(on)
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
  on('agent.list', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))

  await $.tool.call({ tool: 'Bash', command: 'go generate ./...', agentId: 'i1' })
  expect(repo.gitCalls).toBe(0)

  await $.command.run({ command: 'maestro', args: 'off' })
  await $.tool.call({ tool: 'Bash', command: 'go generate ./...' })
  expect(repo.gitCalls).toBe(0)
})

test('outside a git work tree the main loop shell runs unchecked', async ($, on) => {
  let gitCalls = 0
  on('process.run', () => {
    gitCalls++
    return run(128, '', 'fatal: not a git repository')
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'touch main.go' })
  expect(ran.deny).toBeUndefined()
  expect(ran.context ?? []).toEqual([])
  expect(gitCalls).toBe(1)
})

test('a failed read before the command refuses it, one after it is reported', async ($, on) => {
  let statusCalls = 0
  let failAt = 1
  on('process.run', (_, e) => {
    if (e.argv[1] === 'rev-parse') return run(0, '/repo\n')
    statusCalls++
    return statusCalls === failAt ? run(128, '', 'fatal: index file corrupt') : run(0, '')
  })
  on('ui.toast', () => ({ value: undefined }))
  let commandsRun = 0
  on('tool.call', () => {
    commandsRun++
    return { result: { stdout: '', stderr: '' } }
  })

  const refused = await $.tool.call({ tool: 'Bash', command: 'make' })
  expect(refused.deny).toContain('maestro: could not read the work tree before this command')
  expect(commandsRun).toBe(0)

  statusCalls = 0
  failAt = 2
  const ran = await $.tool.call({ tool: 'Bash', command: 'make' })
  expect(commandsRun).toBe(1)
  expect(ran.context?.find(c => c.startsWith('maestro:'))).toContain('could not check whether this command changed code files: git status exited 128: fatal: index file corrupt.')
})
