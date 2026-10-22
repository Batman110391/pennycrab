import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnUsage } from 'claude-code'

import type { Agent } from '../types'
import { budgetOf, tripOf } from './guard'

const row = (over: Partial<Agent>): Agent => ({
  id: 'a1',
  description: 'Find the auth flow',
  type: 'Explore',
  model: 'sonnet',
  tier: 'sonnet',
  background: false,
  status: 'running',
  startedAt: 0,
  steps: 0,
  contextTokens: 0,
  contextWindow: 1_000_000,
  costUsd: 0,
  savedUsd: 0,
  ...over,
})

test('the guard trips on the budget, and on Haiku past its long-prompt line', () => {
  expect(tripOf(row({ costUsd: 1.99 }), 2)).toBeUndefined()
  expect(tripOf(row({ costUsd: 2 }), 2)).toBe('budget')
  expect(tripOf(row({ tier: 'haiku', contextTokens: 100_001 }), 2)).toBe('haiku-context')
  expect(tripOf(row({ tier: 'haiku', contextTokens: 100_000 }), 2)).toBeUndefined()
  expect(tripOf(row({ contextTokens: 400_000 }), 2)).toBeUndefined()
})

test('the budget option reads as dollars, off as no guard, unset as $2', () => {
  expect([budgetOf('0.50'), budgetOf('5'), budgetOf(undefined), budgetOf('off')]).toEqual([0.5, 5, 2, undefined])
})

// 1M tokens written to the 5-minute cache on Sonnet: $2.50, past the default budget in one step.
const COSTLY: TurnUsage = { model: 'claude-sonnet-5-5', input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1_000_000 }

// The test's hooks stand for the engine: an Opus session whose Explore runs on Sonnet as a1, each request
// costing COSTLY and asking for a tool, and every tool answering 'ok'.
async function session($: Engine, on: On) {
  const sent = { steps: 0, tools: 0, toasts: [] as string[] }
  mock.env(on, {})
  mock.clock(on, { now: Date.parse('2026-10-22T10:00:00Z') })
  on('agent.spawn', async (_$, e) => ({ model: e.model ?? e.parentModel, agentId: 'a1' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', async (_$, e) => {
    sent.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('turn.step', async function* (_$, e) {
    sent.steps++
    yield { kind: 'stop', stopReason: 'tool_use', usage: COSTLY }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: COSTLY }
  })
  on('tool.call', async () => {
    sent.tools++
    return { result: 'ok' } as never
  })
  on('turn.complete', async () => ({ text: '' }))
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'Find the auth flow', subagentType: 'Explore', parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
  return sent
}

async function step($: Engine, index: number) {
  const stream = $.turn.step({ turnId: 'turn1', index, model: 'sonnet', messageCount: 1, agentId: 'a1' })
  // The step's result is the stream's return value, which for-await drops.
  for (;;) {
    const r = await stream.next()
    if (r.done) return r.value
  }
}

test('past its budget a subagent is refused its tools, then stopped if it keeps calling them', async ($: Engine, on) => {
  const sent = await session($, on)
  await step($, 0)
  const tool = await $.tool.call({ tool: 'Read', file_path: 'src/auth.ts', agentId: 'a1' })
  const main = await $.tool.call({ tool: 'Read', file_path: 'src/auth.ts' })
  await step($, 1)
  await step($, 2)
  const last = await step($, 3)
  const ui = await $.ui.mount({ plugin: 'pennycrab', surface: 'terminal', component: 'Pane', requestId: 'pennycrab', props: { title: 'Pennycrab', isFocused: false, bodyColumns: 60, placement: 'dock' } as never })
  const guard = (await ui.findAll({ type: 'Text', text: /^Guard · 1$/ })).length
  const why = (await ui.findAll({ type: 'Text', text: /⚑ over budget/ })).length
  await ui.unmount()
  expect(tool.deny).toContain('reached its $2.00 budget')
  expect(main.deny).toBeUndefined()
  expect({ steps: sent.steps, tools: sent.tools }).toEqual({ steps: 3, tools: 1 })
  expect(sent.toasts).toEqual(['Pennycrab handed over "Find the auth flow": it reached its $2.00 budget.'])
  expect(last.answer).toContain('Stopped by pennycrab')
  expect(last.toolUses.length).toBe(0)
  expect({ guard, why }).toEqual({ guard: 1, why: 1 })
})

test('off: the guard never steps in', { options: { budget: 'off' } }, async ($: Engine, on) => {
  const sent = await session($, on)
  for (const i of [0, 1, 2, 3]) await step($, i)
  const tool = await $.tool.call({ tool: 'Read', file_path: 'src/auth.ts', agentId: 'a1' })
  expect(tool.deny).toBeUndefined()
  expect({ steps: sent.steps, tools: sent.tools, toasts: sent.toasts.length }).toEqual({ steps: 4, tools: 1, toasts: 0 })
})

test('a handed-over subagent that ended and is resumed gets its wrap-up steps again', async ($: Engine, on) => {
  const sent = await session($, on)
  for (const i of [0, 1, 2]) await step($, i)
  await $.turn.complete({ reason: 'answer', answer: 'Partial findings', durationMs: 1, isAborted: false, turnId: 'turn1', agentId: 'a1' })
  const resumed = await step($, 0)
  expect(resumed.answer).not.toContain('Stopped by pennycrab')
  expect(sent.steps).toBe(4)
})
