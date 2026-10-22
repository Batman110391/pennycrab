import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnUsage } from 'claude-code'

import { PRICING_PAGE } from './pricing.fixture'
import { costOf, parsePricing, priceKeyOf, tierOf, usePrices } from './prices'

const MODELS = parsePricing(PRICING_PAGE)!
usePrices({ fetchedAt: 0, models: MODELS })

const usage = (u: Partial<Record<'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens', number>>) => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  ...u,
})
const micro = (usd: number | undefined) => (usd === undefined ? undefined : Math.round(usd * 1e6))

test('the page gives every version its own price, the older ones included', () => {
  expect(MODELS['claude-opus-5-5']).toEqual({ input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 })
  expect(MODELS['claude-opus-5']).toEqual({ input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 })
  expect(MODELS['claude-sonnet-5']!.read).toBe(0.2)
  expect(MODELS['claude-sonnet-5-5']!.read).toBe(0.1)
  expect(MODELS['claude-fable-5']!.read).toBe(1)
  expect(MODELS['claude-fable-5-1']!.read).toBe(0.25)
  expect(MODELS['claude-opus-4-1']!.output).toBe(75)
})

test('Haiku 5.5 carries its long-prompt price, with the line the page states', () => {
  expect(MODELS['claude-haiku-5-5']).toEqual({
    input: 0.1, write5m: 0.125, write1h: 0.2, read: 0.01, output: 0.5,
    long: { input: 0.5, write5m: 0.625, write1h: 1, read: 0.05, output: 2.5, above: 100_000 },
  })
})

test("a later section's table is not read as model prices", () => {
  expect(MODELS['claude-opus-5-5']!.input).toBe(4)
})

test('a page whose table is gone or changed shape gives no prices', () => {
  expect(parsePricing('<html>Not found</html>')).toBeUndefined()
  expect(parsePricing('## Model pricing\n\n| Model | Price |\n| Claude Opus 5.5 | $4 / MTok |\n')).toBeUndefined()
  expect(parsePricing(PRICING_PAGE.replace(/\$[\d.]+ \/ MTok/g, 'contact us'))).toBeUndefined()
})

test('a model is found by its id, a provider or dated id, or its alias, which is the newest of its family', () => {
  expect(priceKeyOf('claude-opus-5-5', MODELS)).toBe('claude-opus-5-5')
  expect(priceKeyOf('claude-opus-5-5[1m]', MODELS)).toBe('claude-opus-5-5')
  expect(priceKeyOf('us.anthropic.claude-opus-5-5-v1:0', MODELS)).toBe('claude-opus-5-5')
  expect(priceKeyOf('claude-opus-5-20260115', MODELS)).toBe('claude-opus-5')
  expect(priceKeyOf('claude-opus-4-1-20250805', MODELS)).toBe('claude-opus-4-1')
  expect([priceKeyOf('opus', MODELS), priceKeyOf('sonnet', MODELS), priceKeyOf('haiku', MODELS), priceKeyOf('fable', MODELS)]).toEqual([
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-fable-5-1',
  ])
  expect(priceKeyOf('claude-sonnet-50', MODELS)).toBeUndefined()
  expect(priceKeyOf('gpt-5', MODELS)).toBeUndefined()
})

test('a subagent first step pays the 5m write of its whole prompt, on each version its own price', () => {
  // The spike's measured first step: 49,851 tokens written, 108 out.
  const u = usage({ input_tokens: 2, cache_creation_input_tokens: 49_851, output_tokens: 108 })
  expect(micro(costOf('claude-opus-5-5', u, '5m'))).toBe(251_423)
  expect(micro(costOf('claude-opus-5', u, '5m'))).toBe(314_279)
  expect(micro(costOf('claude-haiku-5-5', u, '5m'))).toBe(6_286)
})

test('Haiku switches to the long-prompt price past the line', () => {
  expect(micro(costOf('claude-haiku-5-5', usage({ cache_read_input_tokens: 90_000 }), '5m'))).toBe(900)
  expect(micro(costOf('claude-haiku-5-5', usage({ cache_read_input_tokens: 110_000 }), '5m'))).toBe(5_500)
})

test('cache writes are priced at the TTL they were written with', () => {
  const u = usage({ cache_creation_input_tokens: 10_000 })
  expect(micro(costOf('claude-sonnet-5-5', u, '5m'))).toBe(25_000)
  expect(micro(costOf('claude-sonnet-5-5', u, '1h'))).toBe(40_000)
})

test('a model the page does not list has no price, and nothing has a price before any was fetched', () => {
  expect(costOf('gpt-5', usage({ input_tokens: 1_000 }), '5m')).toBeUndefined()
  usePrices(undefined)
  expect(costOf('claude-opus-5-5', usage({ input_tokens: 1_000 }), '5m')).toBeUndefined()
  usePrices({ fetchedAt: 0, models: MODELS })
})

test('tierOf reads the family from an id or an alias', () => {
  expect(tierOf('claude-fable-5-1')).toBe('fable')
  expect(tierOf('Sonnet')).toBe('sonnet')
  expect(tierOf('mystery-model')).toBe('other')
})

// The test's hooks stand for the engine: a store that starts as given, and a page that answers as given. The
// plugin's prices show through the pane: a Sonnet subagent's one step of 1M cache writes is $2.50.
const T0 = Date.parse('2026-10-22T10:00:00Z')
const DAY = 24 * 3600_000
function world(on: On, stored: unknown, page: { ok: boolean; text: string } | 'down') {
  const fetched: string[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, {})
  mock.store(on, stored === undefined ? {} : { prices: stored })
  on('http.fetch', async (_$, e) => {
    fetched.push(e.url)
    if (page === 'down') throw new Error('offline')
    return { value: { status: page.ok ? 200 : 503, ok: page.ok, headers: {}, text: page.text } } as never
  })
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('agent.spawn', async (_$, e) => ({ model: e.model ?? 'claude-sonnet-5-5', agentId: 'a1' }) as never)
  on('turn.step', async function* (_$, e) {
    const u: TurnUsage = { model: 'claude-sonnet-5-5', input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1_000_000 }
    yield { kind: 'stop', stopReason: 'end_turn', usage: u }
    return { turnId: e.turnId, index: e.index, answer: 'done', toolUses: [], stopReason: 'end_turn', usage: u }
  })
  return { fetched, clock }
}

async function rowCost($: Engine, clock: { settle: () => Promise<void> }) {
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  await $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'Look', subagentType: 'Explore', parentModel: 'claude-sonnet-5-5', background: false, fork: false } as never)
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' })
  for (;;) if ((await stream.next()).done) break
  const ui = await $.ui.mount({ plugin: 'pennycrab', surface: 'terminal', component: 'Pane', requestId: 'pennycrab', props: { title: 'Pennycrab', isFocused: false, bodyColumns: 80, placement: 'dock' } as never })
  const rows = (await ui.findAll({ type: 'Text', text: /ctx \d+%/ })).map(t => (t as { text?: string }).text ?? '')
  await ui.unmount()
  return rows.join(' ')
}

test('with no prices kept, the session fetches the page and prices from it', async ($: Engine, on) => {
  const { fetched, clock } = world(on, undefined, { ok: true, text: PRICING_PAGE })
  expect(await rowCost($, clock)).toContain('≈$2.50')
  expect(fetched).toEqual(['https://platform.claude.com/docs/en/about-claude/pricing.md'])
})

test('prices kept from less than a day ago are used as they are, with no fetch', async ($: Engine, on) => {
  const { fetched, clock } = world(on, { fetchedAt: T0 - 3600_000, models: MODELS }, 'down')
  expect(await rowCost($, clock)).toContain('≈$2.50')
  expect(fetched).toEqual([])
})

test('older prices are fetched again; with the page down or changed, the kept ones stay', async ($: Engine, on) => {
  const { fetched, clock } = world(on, { fetchedAt: T0 - 2 * DAY, models: MODELS }, { ok: true, text: '<html>moved</html>' })
  expect(await rowCost($, clock)).toContain('≈$2.50')
  expect(fetched.length).toBe(1)
})

test('with no prices kept and the page down, costs read as unknown rather than made up', async ($: Engine, on) => {
  const { clock } = world(on, undefined, 'down')
  expect(await rowCost($, clock)).toContain('≈?')
})
