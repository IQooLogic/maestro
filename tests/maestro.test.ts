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
  expect(off.text).toBe('maestro: main-session code edits are allowed')
  const unlocked = await $.tool.call({ tool: 'Edit', file_path: '/repo/main.go', old_string: 'a', new_string: 'b' })
  expect(unlocked.deny).toBeUndefined()

  const status = await $.command.run({ command: 'maestro', args: 'status' })
  expect(status.text).toBe('maestro: main-session code edits are allowed')

  const back = await $.command.run({ command: 'maestro', args: 'on' })
  expect(back.text).toBe('maestro: main-session code edits are blocked')
  const locked = await $.tool.call({ tool: 'Edit', file_path: '/repo/main.go', old_string: 'a', new_string: 'b' })
  expect(locked.deny).toContain('the orchestrator does not Edit')
})

test('/maestro refuses an unknown argument and keeps its state', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))

  const bad = await $.command.run({ command: 'maestro', args: 'maybe' })
  expect(bad.text).toBe('maestro: unknown argument "maybe" (use on, off or status)')

  const status = await $.command.run({ command: 'maestro', args: '' })
  expect(status.text).toBe('maestro: main-session code edits are blocked')
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
