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
type Page = { ok: boolean; text: string } | 'down'
// `ctx`: the main context, and the window the engine compacts at, which it names only when asked for a breakdown.
function world(on: On, stored: unknown, page: Page | (() => Page), ctx?: { tokens: number; compactAt: number }) {
  const fetched: string[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, {})
  mock.store(on, stored === undefined ? {} : { prices: stored })
  on('http.fetch', async (_$, e) => {
    fetched.push(e.url)
    const p = typeof page === 'function' ? page() : page
    if (p === 'down') throw new Error('offline')
    return { value: { status: p.ok ? 200 : 503, ok: p.ok, headers: {}, text: p.text } } as never
  })
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('session.usage', async (_$, e) => {
    const breakdown = e.breakdown && ctx ? { rawMaxTokens: ctx.compactAt } : undefined
    return { value: { startedAt: 0, context: { tokens: ctx?.tokens ?? 0, window: 1_000_000, percent: 0, breakdown }, rateLimits: [] } } as never
  })
  on('agent.spawn', async (_$, e) => ({ model: e.model ?? 'claude-sonnet-5-5', agentId: 'a1' }) as never)
  on('turn.step', async function* (_$, e) {
    const u: TurnUsage = { model: e.model, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1_000_000 }
    yield { kind: 'stop', stopReason: 'end_turn', usage: u }
    return { turnId: e.turnId, index: e.index, answer: 'done', toolUses: [], stopReason: 'end_turn', usage: u }
  })
  return { fetched, clock }
}

const start = async ($: Engine, clock: { settle: () => Promise<void> }) => {
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
}

// One subagent of a `parent` session, one step on `model`: its row, and the pane's summary.
async function pane($: Engine, model = 'claude-sonnet-5-5', parent = 'claude-sonnet-5-5') {
  await $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'Look', subagentType: 'Explore', parentModel: parent, background: false, fork: false } as never)
  const stream = $.turn.step({ turnId: 't1', index: 0, model, messageCount: 1, agentId: 'a1' })
  for (;;) if ((await stream.next()).done) break
  const ui = await $.ui.mount({ plugin: 'pennycrab', surface: 'terminal', component: 'Pane', requestId: 'pennycrab', props: { title: 'Pennycrab', isFocused: false, bodyColumns: 80, placement: 'dock' } as never })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => (t as { text?: string }).text ?? '')
  await ui.unmount()
  return texts
}

async function rowCost($: Engine, clock: { settle: () => Promise<void> }, model?: string) {
  await start($, clock)
  return (await pane($, model)).filter(t => /ctx \d+%/.test(t)).join(' ')
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
  expect(await rowCost($, clock)).toContain(' · ? · ')
})

test('with the page down at the start, it is asked again ten minutes later, and prices from then on', { timeoutMs: 30_000 }, async ($: Engine, on) => {
  let page: Page = 'down'
  const { fetched, clock } = world(on, undefined, () => page)
  await start($, clock)
  page = { ok: true, text: PRICING_PAGE }
  await clock.advance(10 * 60_000)
  const row = (await pane($)).filter(t => /ctx \d+%/.test(t)).join(' ')
  expect(fetched.length).toBe(2)
  expect(row).toContain('≈$2.50')
})

test('a subagent on a model the page does not list reads ?, not $0.00', async ($: Engine, on) => {
  const { clock } = world(on, { fetchedAt: T0, models: MODELS }, 'down')
  expect(await rowCost($, clock, 'my-gateway-model')).toContain(' · ? · ')
})

test('an Explore of a Fable session would run on Opus without pennycrab: its savings are counted against Opus', async ($: Engine, on) => {
  const { clock } = world(on, { fetchedAt: T0, models: MODELS }, 'down')
  await start($, clock)
  // 1M tokens written on Haiku 5.5 past its 100K line: $0.625, against $5.00 on Opus 5.5 ($12.50 on Fable).
  const texts = await pane($, 'claude-haiku-5-5', 'claude-fable-5-1')
  expect(texts).toContain('  Haiku · low · ↓ from Opus')
  expect(texts.some(t => t.includes('saved $4.38'))).toBe(true)
})

// On Desktop a '?' explains itself: the drawing that shows it is interactive, with a <title> tooltip on the figure.
async function deskSvgs($: Engine) {
  const ui = await $.ui.mount({ plugin: 'pennycrab', surface: 'desktop', component: 'Pane', requestId: 'pennycrab', props: { title: 'Pennycrab', isFocused: false, bodyColumns: 80, placement: 'dock' } as never })
  const svgs = (await ui.findAll({ type: 'Svg' })).map(e => (e as unknown as { props: { source: string; isInteractive?: boolean } }).props)
  await ui.unmount()
  return svgs
}

test('Desktop: a row on an unlisted model says why its cost is ?, on hover', async ($: Engine, on) => {
  const { clock } = world(on, { fetchedAt: T0, models: MODELS }, 'down')
  await rowCost($, clock, 'my-gateway-model')
  const tipped = (await deskSvgs($)).filter(p => p.isInteractive && p.source.includes('<title>'))
  expect(tipped.map(p => /<title>([^<]*)/.exec(p.source)![1])).toEqual(['Unknown: a request of it ran on a model the pricing page does not list.'])
})

test('Desktop: with no prices yet, the head says why it reads ?, on hover', async ($: Engine, on) => {
  const { clock } = world(on, undefined, 'down')
  await rowCost($, clock)
  const tips = (await deskSvgs($)).filter(p => p.isInteractive).map(p => /<title>([^<]*)/.exec(p.source)?.[1])
  expect(tips).toContain('No prices yet: pennycrab reads them from the Anthropic pricing page once it is reached.')
})

// units "tokens": the same dollar figures, in tokens of the main model at its input price (Opus 5.5: $4 per M).
async function mainStep($: Engine) {
  const stream = $.turn.step({ turnId: 'm', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for (;;) if ((await stream.next()).done) break
}

test('units "tokens": a $2.50 row reads ≈625K, in Opus tokens once Opus is the main model', { options: { units: 'tokens' } }, async ($: Engine, on) => {
  const { clock } = world(on, { fetchedAt: T0, models: MODELS }, 'down')
  await start($, clock)
  await mainStep($)
  const row = (await pane($)).filter(t => /ctx \d+%/.test(t)).join(' ')
  expect(row).toContain(' · ≈625K · ')
  const svgs = await deskSvgs($)
  expect(svgs[0]!.source).toContain('>Opus tokens<')
})

test('units "tokens" with no prices: ?, never a made-up figure', { options: { units: 'tokens' } }, async ($: Engine, on) => {
  const { clock } = world(on, undefined, 'down')
  await start($, clock)
  await mainStep($)
  expect((await pane($)).filter(t => /ctx \d+%/.test(t)).join(' ')).toContain(' · ? · ')
})

test('main context is a share of the window the engine compacts at, not of the model\'s', async ($: Engine, on) => {
  const { clock } = world(on, { fetchedAt: T0, models: MODELS }, 'down', { tokens: 373_000, compactAt: 400_000 })
  await start($, clock)
  await mainStep($)
  expect((await deskSvgs($))[0]!.source).toContain('Main context 93%')
})
