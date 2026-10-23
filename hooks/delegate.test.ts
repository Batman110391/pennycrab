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
  on('prompt.compose', async () => ({ sections: [{ id: 'core', text: 'You are Claude Code.', scope: 'shared' }] }) as never)
  on('tool.describe', async (_$, e) => ({ description: e.description }) as never)
}
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
  expect(RULE).toContain('the work changes code')
})
