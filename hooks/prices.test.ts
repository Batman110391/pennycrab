import { expect, test } from 'claude-code/testing'

import { costOf, tierOf } from './prices'

const usage = (u: Partial<Record<'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens', number>>) => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  ...u,
})
const micro = (usd: number | undefined) => (usd === undefined ? undefined : Math.round(usd * 1e6))

test('a subagent first step on Opus pays the 5m write of its whole prompt', () => {
  // The spike's measured first step: 49,851 tokens written, 108 out.
  const u = usage({ input_tokens: 2, cache_creation_input_tokens: 49_851, output_tokens: 108 })
  expect(micro(costOf('claude-opus-5-5', u, '5m'))).toBe(251_423)
  expect(micro(costOf('claude-haiku-5-5', u, '5m'))).toBe(6_286)
})

test('Haiku switches to the long-prompt rate past 100K prompt tokens', () => {
  expect(micro(costOf('claude-haiku-5-5', usage({ cache_read_input_tokens: 90_000 }), '5m'))).toBe(900)
  expect(micro(costOf('claude-haiku-5-5', usage({ cache_read_input_tokens: 110_000 }), '5m'))).toBe(5_500)
})

test('cache writes are priced at the TTL they were written with', () => {
  const u = usage({ cache_creation_input_tokens: 10_000 })
  expect(micro(costOf('claude-sonnet-5-5', u, '5m'))).toBe(25_000)
  expect(micro(costOf('claude-sonnet-5-5', u, '1h'))).toBe(40_000)
})

test('only 5.x models and bare aliases have a price', () => {
  const u = usage({ input_tokens: 1_000 })
  expect(micro(costOf('haiku', u, '5m'))).toBe(100)
  expect(micro(costOf('us.anthropic.claude-opus-5-5-v1:0', u, '5m'))).toBe(4_000)
  expect(costOf('claude-opus-4-5', u, '5m')).toBeUndefined()
  expect(costOf('claude-sonnet-50', u, '5m')).toBeUndefined()
  expect(costOf('gpt-5', u, '5m')).toBeUndefined()
})

test('tierOf reads the family from an id or an alias', () => {
  expect(tierOf('claude-fable-5-1')).toBe('fable')
  expect(tierOf('Sonnet')).toBe('sonnet')
  expect(tierOf('mystery-model')).toBe('other')
})
