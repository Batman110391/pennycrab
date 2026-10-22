import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { routeFor } from './router'

test('prudent: built-in subagents of an Opus or Fable session run on Sonnet', () => {
  expect(routeFor('prudent', 'Explore', 'claude-opus-5-5')).toEqual({ model: 'sonnet' })
  expect(routeFor('prudent', 'general-purpose', 'claude-fable-5-1')).toEqual({ model: 'sonnet' })
})

test('never routes up, never touches a session already on Sonnet or Haiku in prudent mode', () => {
  expect(routeFor('prudent', 'Explore', 'claude-sonnet-5-5')).toBeUndefined()
  expect(routeFor('prudent', 'Explore', 'claude-haiku-5-5')).toBeUndefined()
  expect(routeFor('aggressive', 'Explore', 'claude-haiku-5-5')).toBeUndefined()
})

test('aggressive: Explore drops to Haiku at low effort, general-purpose to Sonnet', () => {
  expect(routeFor('aggressive', 'Explore', 'claude-sonnet-5-5')).toEqual({ model: 'haiku', effort: 'low' })
  expect(routeFor('aggressive', 'general-purpose', 'claude-opus-5-5')).toEqual({ model: 'sonnet' })
})

test('off, user-defined types and unknown parents are left alone', () => {
  expect(routeFor('off', 'Explore', 'claude-opus-5-5')).toBeUndefined()
  expect(routeFor('prudent', 'Plan', 'claude-opus-5-5')).toBeUndefined()
  expect(routeFor('prudent', 'my-reviewer', 'claude-opus-5-5')).toBeUndefined()
  expect(routeFor('prudent', 'Explore', 'some-gateway-model')).toBeUndefined()
})

// The test's hooks stand for the engine: the spawn answers with whatever model it was asked for.
// The kit exposes no $.state to tests: ui.test.tsx checks the recorded rows through the pane.
function engine(on: On, seen: (string | undefined)[], env: Record<string, string> = {}) {
  mock.env(on, env)
  mock.clock(on, { now: Date.parse('2026-10-22T10:00:00Z') })
  on('agent.spawn', async (_$, e) => {
    seen.push(e.model)
    return { model: e.model ?? e.parentModel, agentId: `a${seen.length}` }
  })
}

const spawn = (over: Record<string, unknown>) =>
  ({ tool_use_id: 't', prompt: 'p', description: 'Find the auth flow', subagentType: 'Explore', parentModel: 'claude-opus-5-5', background: false, fork: false, ...over }) as never

test('a plain Explore spawn of an Opus session reaches the engine asking for Sonnet', async ($: Engine, on) => {
  const seen: (string | undefined)[] = []
  engine(on, seen)
  await $.agent.spawn(spawn({}))
  expect(seen).toEqual(['sonnet'])
})

test('an explicit model and a fork are never rerouted', async ($: Engine, on) => {
  const seen: (string | undefined)[] = []
  engine(on, seen)
  await $.agent.spawn(spawn({ model: 'opus' }))
  await $.agent.spawn(spawn({ fork: true }))
  expect(seen).toEqual(['opus', undefined])
})

test('a set CLAUDE_CODE_SUBAGENT_MODEL keeps the router out', async ($: Engine, on) => {
  const seen: (string | undefined)[] = []
  engine(on, seen, { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-opus-5-5' })
  await $.agent.spawn(spawn({}))
  expect(seen).toEqual([undefined])
})
