import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { RULE } from './delegate'

// The Agent tool's description on the Pro plan, as 2.1.302 writes it.
const PRO =
  'Launch a new agent.\n\n**Do not spawn agents unless the user asks.** Each spawn starts cold and re-derives context you already have — it\'s the expensive path on this plan. A task with "multiple angles," "thorough," or several parts is not a request to spawn; handle it inline with your own tools. Only use this tool when the user explicitly says to use a subagent, or names one of the available agent types.\n\nWhen using the Agent tool, specify a subagent_type.'

// The test's hooks stand for the engine: its own sections, and the Agent description it computed.
function engine(on: On, env: Record<string, string> = {}) {
  mock.env(on, env)
  mock.clock(on, { now: Date.parse('2026-10-23T10:00:00Z') })
  on('prompt.compose', async () => ({ sections: [{ id: 'core', text: 'You are Claude Code.', scope: 'shared' }] }) as never)
  on('tool.describe', async (_$, e) => ({ description: e.description }) as never)
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [] } }) as never)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    yield { kind: 'stop', stopReason: 'tool_use', usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage }
  })
  on('tool.call', async () => ({ result: 'ok' }) as never)
}

// A main-thread turn on `model`: its first step tells pennycrab the session's model.
async function mainTurn($: Engine, id: string, model = 'claude-opus-5-5') {
  await $.turn.start({ text: 'go', turnId: id })
  const stream = $.turn.step({ turnId: id, index: 0, model, messageCount: 1 })
  for (;;) if ((await stream.next()).done) break
}
const notesOf = async ($: Engine, call: object) => ((await $.tool.call(call as never)) as { context?: string[] }).context ?? []
const readFile = (file_path: string) => ({ tool: 'Read', file_path })
const compose = async ($: Engine, model = 'claude-opus-5-5') =>
  (await $.prompt.compose({ model, promptModel: model, surfaces: [], tools: ['Agent'], outputStyle: null, traits: [] } as never)).sections.map(s => s.id)
const agentText = async ($: Engine) => (await $.tool.describe({ tool: 'Agent', description: PRO, provider: { plugin: 'engine', tier: 'core' } } as never)).description

test('on Opus, the rule is added last, and the Pro line is kept for code alone', async ($: Engine, on) => {
  engine(on)
  expect(await compose($)).toEqual(['core', 'pennycrab:subagents'])
  const text = await agentText($)
  expect(text).toContain('**Do not spawn agents to write or change code unless the user asks.**')
  expect(text).not.toContain('Only use this tool when the user explicitly says')
  expect(text.startsWith('Launch a new agent.')).toBe(true)
  expect(text.endsWith('specify a subagent_type.')).toBe(true)
})

test('on Sonnet too: Explore moves to Haiku from any model above it', async ($: Engine, on) => {
  engine(on)
  expect(await compose($, 'claude-sonnet-5-5')).toContain('pennycrab:subagents')
})

test('a session already on Haiku gets no rule: Explore would cost what the session costs', async ($: Engine, on) => {
  engine(on)
  expect(await compose($, 'claude-haiku-5-5')).toEqual(['core'])
})

for (const router of ['prudent', 'off']) {
  test(`router "${router}" moves no Explore to Haiku: no rule, the engine's line as it is`, { options: { router } }, async ($: Engine, on) => {
    engine(on)
    expect(await compose($)).toEqual(['core'])
    expect(await agentText($)).toBe(PRO)
  })
}

test('delegate "off": no rule, the engine\'s line as it is', { options: { delegate: 'off' } }, async ($: Engine, on) => {
  engine(on)
  expect(await compose($)).toEqual(['core'])
  expect(await agentText($)).toBe(PRO)
})

test('a session that picks its subagent model keeps the router out, and so the rule', async ($: Engine, on) => {
  engine(on, { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' })
  expect(await compose($)).toEqual(['core'])
  expect(await agentText($)).toBe(PRO)
})

test('an Agent description without the Pro line is left as it is', async ($: Engine, on) => {
  engine(on)
  const plain = 'Launch a new agent.'
  expect((await $.tool.describe({ tool: 'Agent', description: plain, provider: { plugin: 'engine', tier: 'core' } } as never)).description).toBe(plain)
})

test('the rule says what moves where, and what stays', () => {
  expect(RULE).toContain('Explore subagents on Haiku')
  expect(RULE).toContain('when you start investigating an area of code you have not read yet')
  expect(RULE).toContain('even when the task ends in a code change')
})

test('the third file read by hand in a turn brings one reminder, and the next turn counts afresh', async ($: Engine, on) => {
  engine(on)
  await mainTurn($, 'm1')
  const seen = []
  for (const f of ['a.ts', 'b.ts', 'a.ts', { tool: 'Bash', command: 'sed -n 1,40p src/c.ts' }, 'd.ts'])
    seen.push((await notesOf($, typeof f === 'string' ? readFile(f) : f)).length)
  // a.ts read twice is one file: the reminder comes with c.ts, the third, and once.
  expect(seen).toEqual([0, 0, 0, 1, 0])
  await mainTurn($, 'm2')
  expect([(await notesOf($, readFile('a.ts'))).length, (await notesOf($, readFile('b.ts'))).length, (await notesOf($, readFile('e.ts'))).length]).toEqual([0, 0, 1])
})

test('the reminder names Explore and gives a ready brief', async ($: Engine, on) => {
  engine(on)
  await mainTurn($, 'm1')
  for (const f of ['a.ts', 'b.ts']) await notesOf($, readFile(f))
  const [note] = await notesOf($, readFile('c.ts'))
  expect(note).toContain('Send the next search to Explore')
  expect(note).toContain('Answer with file:line, at most 10 lines.')
})

test('a turn that already sent an Explore gets no reminder', async ($: Engine, on) => {
  engine(on)
  await mainTurn($, 'm1')
  await notesOf($, { tool: 'Agent', subagent_type: 'Explore', description: 'Find', prompt: 'p' })
  const seen = []
  for (const f of ['a.ts', 'b.ts', 'c.ts']) seen.push((await notesOf($, readFile(f))).length)
  expect(seen).toEqual([0, 0, 0])
})

test('searches and piped reads are not counted as files read', async ($: Engine, on) => {
  engine(on)
  await mainTurn($, 'm1')
  const calls = [
    { tool: 'Grep', pattern: 'x' },
    { tool: 'Bash', command: 'grep -rn x src' },
    { tool: 'Bash', command: 'cat src/a.ts | head' },
    readFile('a.ts'),
    readFile('b.ts'),
  ]
  const seen = []
  for (const c of calls) seen.push((await notesOf($, c)).length)
  expect(seen).toEqual([0, 0, 0, 0, 0])
})

for (const [why, opts, model] of [
  ['delegate "off"', { delegate: 'off' }, 'claude-opus-5-5'],
  ['router "off"', { router: 'off' }, 'claude-opus-5-5'],
  ['a session on Haiku', {}, 'claude-haiku-5-5'],
] as const) {
  test(`${why}: no reminder, however many files`, { options: opts }, async ($: Engine, on) => {
    engine(on)
    await mainTurn($, 'm1', model)
    const seen = []
    for (const f of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) seen.push((await notesOf($, readFile(f))).length)
    expect(seen).toEqual([0, 0, 0, 0])
  })
}

test('a file read before the session\'s model is known still counts', async ($: Engine, on) => {
  engine(on)
  await $.turn.start({ text: 'go', turnId: 'm1' })
  await notesOf($, readFile('a.ts'))
  const stream = $.turn.step({ turnId: 'm1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for (;;) if ((await stream.next()).done) break
  expect([(await notesOf($, readFile('b.ts'))).length, (await notesOf($, readFile('c.ts'))).length]).toEqual([0, 1])
})
