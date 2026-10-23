import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnUsage } from 'claude-code'

import type { Agent } from '../types'
import { budgetOf, tripOf } from './guard'
import { PRICING_PAGE } from './pricing.fixture'
import { parsePricing } from './prices'

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
  tokens: 0,
  costUsd: 0,
  savedUsd: 0,
  ...over,
})

const CAP = { budgetUsd: 2, forecast: 'off' } as const

test('the budget trips on spend alone: a Haiku subagent past its long-prompt line still costs less than on any other model', () => {
  expect(tripOf(row({ costUsd: 1.99 }), CAP)).toBeUndefined()
  expect(tripOf(row({ costUsd: 2 }), CAP)).toBe('budget')
  expect(tripOf(row({ tier: 'haiku', model: 'claude-haiku-5-5', contextTokens: 400_000, costUsd: 0.3 }), CAP)).toBeUndefined()
})

test('the forecast trips at twice it, only when on and only for a run that has one', () => {
  const on = { budgetUsd: undefined, forecast: 'on' } as const
  expect(tripOf(row({ tokens: 1_199_999, forecast: 600_000 }), on)).toBeUndefined()
  expect(tripOf(row({ tokens: 1_200_000, forecast: 600_000 }), on)).toBe('forecast')
  expect(tripOf(row({ tokens: 1_200_000, forecast: 600_000 }), { ...on, forecast: 'nudge' })).toBeUndefined()
  expect(tripOf(row({ tokens: 9_000_000 }), on)).toBeUndefined()
})

test('the budget option reads as dollars, off as no cap, unset as off', () => {
  expect([budgetOf('1'), budgetOf('50'), budgetOf(undefined), budgetOf('off')]).toEqual([1, 50, undefined, undefined])
})

// 1M tokens written to the 5-minute cache on Sonnet: $2.50, past a $2 budget in one step.
const COSTLY: TurnUsage = { model: 'claude-sonnet-5-5', input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1_000_000 }

// The test's hooks stand for the engine: an Opus session whose Explore runs on Sonnet as a1, each request
// costing COSTLY and asking for a tool (or, `isFinal`, answering), every tool answering 'ok', and the prices
// of the pricing page already kept.
async function session($: Engine, on: On, isFinal = false, isUsageDown = false, history: Record<string, number[]> = {}) {
  const sent = { steps: 0, tools: 0, toasts: [] as string[] }
  const T0 = Date.parse('2026-10-22T10:00:00Z')
  mock.env(on, {})
  mock.clock(on, { now: T0 })
  mock.store(on, { prices: { fetchedAt: T0, models: parsePricing(PRICING_PAGE) }, history })
  on('agent.spawn', async (_$, e) => ({ model: e.model ?? e.parentModel, agentId: 'a1' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', async (_$, e) => {
    sent.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  // The session's own cost: what the subagent's requests cost so far.
  on('session.usage', async () => {
    if (isUsageDown) throw new Error('down')
    return { value: { startedAt: T0, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [], cost: { usd: sent.steps * 2.5 } } } as never
  })
  on('turn.step', async function* (_$, e) {
    sent.steps++
    const stopReason = isFinal ? 'end_turn' : 'tool_use'
    yield { kind: 'stop', stopReason, usage: COSTLY }
    const toolUses = isFinal ? [] : [{ name: 'Read', input: { file_path: 'src/auth.ts' } }]
    return { turnId: e.turnId, index: e.index, answer: isFinal ? 'The auth flow is in src/auth.ts.' : '', toolUses, stopReason, usage: COSTLY }
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

async function step($: Engine, index: number, chunks: unknown[] = []) {
  const stream = $.turn.step({ turnId: 'turn1', index, model: 'sonnet', messageCount: 1, agentId: 'a1' })
  // The step's result is the stream's return value, which for-await drops.
  for (;;) {
    const r = await stream.next()
    if (r.done) return r.value
    chunks.push(r.value)
  }
}

async function paneTexts($: Engine) {
  const ui = await $.ui.mount({ plugin: 'pennycrab', surface: 'terminal', component: 'Pane', requestId: 'pennycrab', props: { title: 'Pennycrab', isFocused: false, bodyColumns: 60, placement: 'dock' } as never })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => (t as { text?: string }).text ?? '')
  await ui.unmount()
  return texts
}

test('past its budget a subagent is refused its tools, then stopped if it keeps calling them', { options: { budget: '2' } }, async ($: Engine, on) => {
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

test('a handed-over subagent that ended and is resumed gets its wrap-up steps again', { options: { budget: '2' } }, async ($: Engine, on) => {
  const sent = await session($, on)
  for (const i of [0, 1, 2]) await step($, i)
  await $.turn.complete({ reason: 'answer', answer: 'Partial findings', durationMs: 1, isAborted: false, turnId: 'turn1', agentId: 'a1' })
  const resumed = await step($, 0)
  expect(resumed.answer).not.toContain('Stopped by pennycrab')
  expect(sent.steps).toBe(4)
})

test('a subagent whose final answer crosses its budget had finished by itself: no handover, no toast', { options: { budget: '2' } }, async ($: Engine, on) => {
  const sent = await session($, on, true)
  await step($, 0)
  const tool = await $.tool.call({ tool: 'Read', file_path: 'src/auth.ts', agentId: 'a1' })
  const ui = await $.ui.mount({ plugin: 'pennycrab', surface: 'terminal', component: 'Pane', requestId: 'pennycrab', props: { title: 'Pennycrab', isFocused: false, bodyColumns: 60, placement: 'dock' } as never })
  const guard = (await ui.findAll({ type: 'Text', text: /^Guard/ })).length
  await ui.unmount()
  expect({ deny: tool.deny, toasts: sent.toasts.length, guard }).toEqual({ deny: undefined, toasts: 0, guard: 0 })
})

test('a subagent resumed after its handover keeps its spend, and is handed over again at its first tool call', { options: { budget: '2' } }, async ($: Engine, on) => {
  const sent = await session($, on)
  await step($, 0)
  await $.turn.complete({ reason: 'answer', answer: 'Partial findings', durationMs: 1, isAborted: false, turnId: 'turn1', agentId: 'a1' })
  await $.agent.spawn({ tool_use_id: 't2', prompt: 'Go on', description: 'Find the auth flow', subagentType: 'Explore', parentModel: 'claude-opus-5-5', background: false, fork: false, resume: { agentId: 'a1' } } as never)
  const resumed = (await paneTexts($)).filter(t => /ctx \d+%/.test(t)).join(' ')
  await step($, 0)
  const tool = await $.tool.call({ tool: 'Read', file_path: 'src/auth.ts', agentId: 'a1' })
  expect(resumed).toContain('≈$2.50')
  expect(tool.deny).toContain('reached its $2.00 budget')
  expect(sent.toasts.length).toBe(2)
})

test('the session\'s cost follows its subagents\' spend, not only the main thread\'s steps', async ($: Engine, on) => {
  await session($, on)
  await step($, 0)
  const summary = (await paneTexts($)).find(t => t.includes('saved'))
  expect(summary?.startsWith('≈$2.50')).toBe(true)
})

test('a hook that fails after the model answered is skipped: the step stays as the model gave it, its stream whole and once', async ($: Engine, on) => {
  await session($, on, false, true)
  const chunks: unknown[] = []
  const result = await step($, 0, chunks)
  expect(chunks).toEqual([{ kind: 'stop', stopReason: 'tool_use', usage: COSTLY }])
  expect(result.toolUses.length).toBe(1)
})

// Ten finished Explore runs on Haiku of 400K tokens each: a forecast of 600K. Each COSTLY step is 1M tokens.
const RUNS = { 'Explore · haiku': Array(10).fill(400_000) }
const read = { tool: 'Read', file_path: 'src/auth.ts', agentId: 'a1' } as const
const notesOf = (r: unknown) => ((r as { context?: string[] }).context ?? []).join(' ')

test('past its forecast a subagent is nudged once; past twice it, handed over with its numbers', async ($: Engine, on) => {
  const sent = await session($, on, false, false, RUNS)
  await step($, 0)
  const first = await $.tool.call(read)
  const second = await $.tool.call({ ...read, file_path: 'src/b.ts' })
  await step($, 1)
  const tool = await $.tool.call(read)
  const why = (await paneTexts($)).filter(t => /over forecast/.test(t)).length
  // On a narrow desktop pane the reason's chip still shows, whatever else gives way.
  const desk = await $.ui.mount({ plugin: 'pennycrab', surface: 'desktop', component: 'Pane', requestId: 'pennycrab', props: { title: 'Pennycrab', isFocused: false, bodyColumns: 38, placement: 'dock' } as never })
  const chip = (await desk.findAll({ type: 'Svg' })).some(e => String((e as { props?: { source?: unknown } }).props?.source).includes('⚑ over forecast'))
  await desk.unmount()
  expect(chip).toBe(true)
  expect(notesOf(first)).toContain('usually finish within 400K')
  expect(notesOf(second)).toBe('')
  expect(tool.deny).toContain('Stopped by pennycrab: it used 2.0M tokens, past twice its forecast of 600K')
  expect(sent.toasts).toEqual(['Pennycrab handed over "Find the auth flow": it used 2.0M tokens, past twice its forecast of 600K.'])
  expect(why).toBe(1)
})

test('forecast "nudge": the note, never a handover', { options: { forecast: 'nudge' } }, async ($: Engine, on) => {
  const sent = await session($, on, false, false, RUNS)
  await step($, 0)
  const first = await $.tool.call(read)
  for (const i of [1, 2, 3]) await step($, i)
  const later = await $.tool.call({ ...read, file_path: 'src/b.ts' })
  expect(notesOf(first)).toContain('wrap up')
  expect({ deny: later.deny, toasts: sent.toasts.length }).toEqual({ deny: undefined, toasts: 0 })
})

test('forecast "off": no note, no handover', { options: { forecast: 'off' } }, async ($: Engine, on) => {
  await session($, on, false, false, RUNS)
  for (const i of [0, 1, 2]) await step($, i)
  const calls = []
  for (let i = 0; i < 6; i++) calls.push(await $.tool.call(read))
  expect(calls.map(c => [c.deny, notesOf(c)])).toEqual(Array(6).fill([undefined, '']))
})

test('fewer than ten runs of its kind: no forecast, so no note however many tokens', async ($: Engine, on) => {
  await session($, on, false, false, { 'Explore · haiku': Array(9).fill(400_000) })
  for (const i of [0, 1, 2]) await step($, i)
  const tool = await $.tool.call(read)
  expect([tool.deny, notesOf(tool)]).toEqual([undefined, ''])
})

test('the same call with the same result: a note at the third, a handover at the fifth; another call in between starts over', async ($: Engine, on) => {
  const sent = await session($, on)
  const calls = []
  for (const f of ['a', 'a', 'b', 'a', 'a', 'a', 'a', 'a', 'a']) calls.push(await $.tool.call({ ...read, file_path: f }))
  const notes = calls.map(c => (notesOf(c).includes('same call') ? 'note' : c.deny ? 'deny' : '-'))
  expect(notes).toEqual(['-', '-', '-', '-', '-', 'note', '-', '-', 'deny'])
  expect(calls[8]!.deny).toContain('the same tool call with the same result 5 times in a row')
  expect(sent.toasts.length).toBe(1)
})

// Nine runs of its kind: the tenth, once it answers, makes the next spawn's forecast.
const NINE = { 'Explore · haiku': Array(9).fill(400_000) }
const again = ($: Engine) =>
  $.agent.spawn({ tool_use_id: 't2', prompt: 'p', description: 'Find the auth flow', subagentType: 'Explore', parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
const tokText = async ($: Engine) => (await paneTexts($)).filter(t => / tok · /.test(t)).join(' ')

test('a run that answers joins the history of its kind: the next run like it has a forecast', async ($: Engine, on) => {
  await session($, on, true, false, NINE)
  await step($, 0)
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'turn1', agentId: 'a1' })
  await again($)
  expect(await tokText($)).toContain('0 / 600K tok')
})

test('a run handed over stays out of the history', { options: { budget: '2' } }, async ($: Engine, on) => {
  await session($, on, false, false, NINE)
  for (const i of [0, 1]) await step($, i)
  await $.turn.complete({ reason: 'answer', answer: 'Stopped by pennycrab', durationMs: 1, isAborted: false, turnId: 'turn1', agentId: 'a1' })
  await again($)
  expect(await tokText($)).not.toContain(' / ')
})
