import { expect, test } from 'claude-code/testing'

test('main loop cannot edit code but can edit markdown and ~/.claude', async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  const code = await $.tool.call({ tool: 'Edit', file_path: '/repo/main.go', old_string: 'a', new_string: 'b' })
  expect(code.isError === true || code.deny !== undefined).toBe(true)

  const doc = await $.tool.call({ tool: 'Write', file_path: '/repo/docs/plans/plan.md', content: 'x' })
  expect(doc.isError).not.toBe(true)

  const memory = await $.tool.call({ tool: 'Write', file_path: '/home/u/.claude/memory/x.txt', content: 'x' })
  expect(memory.isError).not.toBe(true)
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
