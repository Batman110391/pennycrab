import { expect, test } from 'claude-code/testing'

import type { Agent } from '../types'
import { prune, statusOf } from './telemetry'

const row = (id: string, endedAt?: number): Agent => ({
  id,
  description: id,
  type: 'Explore',
  model: 'sonnet',
  tier: 'sonnet',
  background: false,
  status: endedAt === undefined ? 'running' : 'completed',
  startedAt: 0,
  endedAt,
  steps: 0,
  contextTokens: 0,
  contextWindow: 1_000_000,
  tokens: 0,
  costUsd: 0,
  savedUsd: 0,
})

test('prune keeps every running agent and only the last 20 finished ones', () => {
  const finished = Array.from({ length: 25 }, (_, i) => row(`done${i}`, i + 1))
  const kept = prune([row('live1'), ...finished, row('live2')])
  expect(kept.length).toBe(22)
  expect(kept.some(a => a.id === 'done4')).toBe(false)
  expect(kept.some(a => a.id === 'done5')).toBe(true)
  expect(kept.filter(a => a.id.startsWith('live')).length).toBe(2)
})

test('a teammate, which wakes again with no new spawn, keeps its row however many finish after it', () => {
  const teammate = { ...row('mate', 1), isTeammate: true as const }
  const finished = Array.from({ length: 25 }, (_, i) => row(`done${i}`, i + 2))
  expect(prune([teammate, ...finished]).some(a => a.id === 'mate')).toBe(true)
})

test('a turn reason maps to the row status', () => {
  expect(statusOf('answer')).toBe('completed')
  expect(statusOf('aborted')).toBe('stopped')
  expect(statusOf('error')).toBe('failed')
  expect(statusOf('refusal')).toBe('failed')
})
