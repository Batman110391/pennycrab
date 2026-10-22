import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit, TurnUsage } from 'claude-code'

import type { Cache } from '../types'
import { hasLapsed, keepWarmOf, pingDueAt } from './cache'
import { PRICING_PAGE } from './pricing.fixture'
import { parsePricing } from './prices'
import { cacheLine } from './ui'
import { NO_CACHE } from './state'

const MIN = 60_000
const T0 = Date.parse('2026-10-22T10:00:00Z')

test('the keep-warm option reads as a window after the last turn, auto (the default) as up to 8 hours weighed, off as none', () => {
  expect([keepWarmOf('30m'), keepWarmOf('8h'), keepWarmOf(undefined), keepWarmOf('off')]).toEqual([
    { windowMs: 30 * MIN, isAuto: false },
    { windowMs: 480 * MIN, isAuto: false },
    { windowMs: 480 * MIN, isAuto: true },
    undefined,
  ])
})

test('a ping is due 45s before a 5-minute entry lapses, and never while a 1-hour entry outlasts the window', () => {
  const idle: Cache = { ...NO_CACHE, ttlMs: 5 * MIN, ttlSource: 'api', lastRequestAt: T0, lastTurnAt: T0 }
  expect(pingDueAt(idle, 30 * MIN)).toBe(T0 + 5 * MIN - 45_000)
  // The last entry already reaches past the window's end: no ping.
  expect(pingDueAt({ ...idle, lastRequestAt: T0 + 26 * MIN }, 30 * MIN)).toBeUndefined()
  expect(pingDueAt({ ...idle, ttlMs: 60 * MIN }, 30 * MIN)).toBeUndefined()
  expect(pingDueAt({ ...idle, isTurnOpen: true }, 30 * MIN)).toBeUndefined()
  expect(pingDueAt({ ...idle, isHalted: true }, 30 * MIN)).toBeUndefined()
  expect(pingDueAt({ ...idle, ttlMs: null }, 30 * MIN)).toBeUndefined()
})

test('an entry past its end has lapsed: no ping is sent into it', () => {
  const c: Cache = { ...NO_CACHE, ttlMs: 5 * MIN, lastRequestAt: T0, lastTurnAt: T0 }
  expect([hasLapsed(c, T0 + 5 * MIN - 1), hasLapsed(c, T0 + 5 * MIN), hasLapsed({ ...c, lastRequestAt: null }, T0 + 9 * MIN)]).toEqual([false, true, false])
})

test('the cache line says how long the cache stays warm and what the pings cost', () => {
  const c: Cache = { ...NO_CACHE, ttlMs: 5 * MIN, lastRequestAt: T0, lastTurnAt: T0, pings: 2, pingUsd: 0.04 }
  expect(cacheLine(c, T0 + 61_000)).toBe('Cache warm · 4m left · 2 pings ≈$0.04')
  expect(cacheLine({ ...c, pings: 0 }, T0 + 6 * MIN)).toBe('Cache expired')
  expect(cacheLine({ ...c, isTurnOpen: true, pings: 0 }, T0)).toBe('Cache in use')
  expect(cacheLine(NO_CACHE, T0)).toBeUndefined()
})

// The test's hooks stand for the engine: its settings and the status line's figures, a main turn whose one request
// answers over a 100K-token context, and a fork that reads it all from the cache.
type World = { env?: Record<string, string>; settings?: Record<string, unknown>; rateLimits?: SessionRateLimit[]; noPrices?: boolean }
function engine(on: On, o: World = {}) {
  const sent = { forks: 0, read: 100_000 }
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, o.env ?? {})
  mock.store(on, o.noPrices ? {} : { prices: { fetchedAt: T0, models: parsePricing(PRICING_PAGE) } })
  on('settings.read', async () => ({ value: o.settings ?? {} }) as never)
  on('session.usage', async () => ({ value: { startedAt: T0, context: { tokens: 100_000, window: 1_000_000, percent: 10 }, rateLimits: o.rateLimits ?? [], cost: { usd: 0 } } }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  on('turn.step', async function* (_$, e) {
    const usage: TurnUsage = { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 50, cache_read_input_tokens: sent.read, cache_creation_input_tokens: 100_000 - sent.read }
    yield { kind: 'stop', stopReason: 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: 'done', toolUses: [], stopReason: 'end_turn', usage }
  })
  on('model.fork', async () => {
    sent.forks++
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 40, output_tokens: 2, cache_read_input_tokens: sent.read, cache_creation_input_tokens: 100_000 - sent.read } } } as never
  })
  return { sent, clock }
}

async function turn($: Engine, id: string) {
  await $.turn.start({ text: 'go', turnId: id })
  const stream = $.turn.step({ turnId: id, index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for (;;) if ((await stream.next()).done) break
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: id })
}

const PANE = { plugin: 'pennycrab', surface: 'terminal', component: 'Pane', requestId: 'pennycrab', props: { title: 'Pennycrab', isFocused: false, bodyColumns: 80, placement: 'dock' } as never } as const
async function paneText($: Engine, re: RegExp) {
  const ui = await $.ui.mount(PANE)
  const found = await ui.findAll({ type: 'Text', text: re })
  await ui.unmount()
  return found.map(f => (f as { text?: string }).text ?? JSON.stringify(f))
}

const start = ($: Engine) => $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)

const PLAN: SessionRateLimit[] = [{ kind: 'five_hour', percentUsed: 40 }]
const TTL_CASES: [string, World, string | undefined][] = [
  ['FORCE_PROMPT_CACHING_5M wins over every other source', { env: { FORCE_PROMPT_CACHING_5M: '1', CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' }, rateLimits: PLAN }, '5m'],
  ['CLAUDE_CODE_PROMPT_CACHE_TTL wins over the setting', { env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' }, settings: { promptCacheTtl: '5m' } }, '1h00m'],
  ['the promptCacheTtl setting wins over the account', { settings: { promptCacheTtl: '5m' }, rateLimits: PLAN }, '5m'],
  ['ENABLE_PROMPT_CACHING_1H gives an API key an hour', { env: { ENABLE_PROMPT_CACHING_1H: '1' } }, '1h00m'],
  ['a subscription within its limits caches for an hour', { rateLimits: PLAN }, '1h00m'],
  ['a subscription past its limits caches for 5 minutes', { rateLimits: [{ kind: 'five_hour', percentUsed: 100 }] }, '5m'],
  ['an API key caches for 5 minutes', {}, '5m'],
  ['a cloud provider caches for 5 minutes', { env: { CLAUDE_CODE_USE_VERTEX: '1' }, rateLimits: PLAN }, '5m'],
  ['DISABLE_PROMPT_CACHING: no cache, no line', { env: { DISABLE_PROMPT_CACHING: '1' } }, undefined],
]
for (const [name, world, left] of TTL_CASES) {
  test(`TTL: ${name}`, async ($: Engine, on) => {
    engine(on, world)
    await start($)
    await turn($, 'm1')
    const lines = await paneText($, /^Cache /)
    expect(lines).toEqual(left === undefined ? [] : [`Cache warm · ${left} left`])
  })
}

test('on a 5-minute cache a 30-minute window takes 6 pings, and the turn after them reads the cache: a re-write spared', { options: { keepWarm: '30m' } }, async ($: Engine, on) => {
  const { sent, clock } = engine(on)
  await start($)
  await turn($, 'm1')
  await clock.advance(30 * MIN)
  expect(sent.forks).toBe(6)
  const away = await paneText($, /^Cache /)
  await turn($, 'm2')
  const summary = await paneText($, /saved/)
  // 100K tokens read rather than written on Opus: $0.48 spared, less 6 pings of about $0.0202 each.
  expect(away).toEqual(['Cache warm · 1m left · 6 pings ≈$0.12'])
  expect(summary.some(t => t.includes('saved $0.36'))).toBe(true)
})

test('on a 1-hour cache a 30-minute window needs no ping', async ($: Engine, on) => {
  const { sent, clock } = engine(on, { rateLimits: PLAN })
  await start($)
  await turn($, 'm1')
  await clock.advance(30 * MIN)
  expect(sent.forks).toBe(0)
})

test('a ping that rewrites a part of the conversation goes on; one that rewrites most of it stops the pings', { options: { keepWarm: '30m' } }, async ($: Engine, on) => {
  const { sent, clock } = engine(on)
  await start($)
  await turn($, 'm1')
  sent.read = 78_000
  await clock.advance(30 * MIN)
  expect(sent.forks).toBe(6)
})

test('a ping that finds the entry gone stops the pings until the next turn', async ($: Engine, on) => {
  const { sent, clock } = engine(on)
  await start($)
  await turn($, 'm1')
  sent.read = 0
  await clock.advance(30 * MIN)
  expect(sent.forks).toBe(1)
})

test('no ping while a turn is open', async ($: Engine, on) => {
  const { sent, clock } = engine(on)
  await start($)
  await turn($, 'm1')
  await $.turn.start({ text: 'a long one', turnId: 'm2' })
  await clock.advance(30 * MIN)
  expect(sent.forks).toBe(0)
})

test('with keep-warm off, no ping', { options: { keepWarm: 'off' } }, async ($: Engine, on) => {
  const { sent, clock } = engine(on)
  await start($)
  await turn($, 'm1')
  await clock.advance(30 * MIN)
  expect(sent.forks).toBe(0)
})

// auto, with the fake engine's numbers on Opus 5.5: a ping reads 100K tokens for $0.0202; a rewrite of them costs
// $0.48 more than reading them on a 5-minute cache, $0.78 more on a 1-hour cache.
test('auto on a 5-minute cache stops once the pings would pass a quarter of the rewrite: 5 pings', async ($: Engine, on) => {
  const { sent, clock } = engine(on)
  await start($)
  await turn($, 'm1')
  await clock.advance(60 * MIN)
  expect(sent.forks).toBe(5)
})

test('auto on a subscription: away 1 hour 5 minutes, one ping at 59 minutes, and the return reads the cache', async ($: Engine, on) => {
  const { sent, clock } = engine(on, { rateLimits: PLAN })
  await start($)
  await turn($, 'm1')
  await clock.advance(65 * MIN)
  expect(sent.forks).toBe(1)
  await turn($, 'm2')
  const summary = await paneText($, /saved/)
  // $0.78 of rewrite spared, less the one ping.
  expect(summary.some(t => t.includes('saved $0.76'))).toBe(true)
})

test('auto on a subscription keeps the cache warm 8 hours at most: 8 pings, one an hour', { timeoutMs: 60_000 }, async ($: Engine, on) => {
  const { sent, clock } = engine(on, { rateLimits: PLAN })
  await start($)
  await turn($, 'm1')
  // The kit resolves at most 10,000 waits an advance: ten hours of one-second ticks go an hour at a time.
  for (let h = 0; h < 10; h++) await clock.advance(60 * MIN)
  expect(sent.forks).toBe(8)
})

test('auto with no prices to weigh the pings sends none', async ($: Engine, on) => {
  const { sent, clock } = engine(on, { noPrices: true })
  await start($)
  await turn($, 'm1')
  await clock.advance(30 * MIN)
  expect(sent.forks).toBe(0)
})

test('after the first turn one toast says what pennycrab chose for the account; the next turn says nothing', async ($: Engine, on) => {
  const toasts: string[] = []
  engine(on, { rateLimits: PLAN })
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  await start($)
  await turn($, 'm1')
  await turn($, 'm2')
  expect(toasts).toEqual([
    'pennycrab is set for your Claude subscription: 1-hour cache, one ping an hour while you are away (up to 8 h) · Explore on Haiku, general-purpose on Sonnet · $2.00 cap per subagent. /plugin configure pennycrab to change it.',
  ])
})

test('pay-per-token use is told its 5-minute cache is kept warm as long as the pings pay for themselves', async ($: Engine, on) => {
  const toasts: string[] = []
  engine(on)
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  await start($)
  await turn($, 'm1')
  expect(toasts[0]).toContain('set for pay-per-token use: 5-minute cache, pings while you are away as long as they pay for themselves')
})

test('a subscription past its limits is told so, with the 5-minute cache it then has', async ($: Engine, on) => {
  const toasts: string[] = []
  engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 100 }] })
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  await start($)
  await turn($, 'm1')
  expect(toasts[0]).toContain('set for your Claude subscription, past its limits: 5-minute cache')
})
