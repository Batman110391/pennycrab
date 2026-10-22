import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Cache } from '../types'
import { costOf } from './prices'
import { NO_CACHE, NO_MAIN, NO_SAVINGS } from './state'

// The state lib's scan reads an atom only where its reference is written, so each file declares the ones it uses.
const cache = atom({ plugin: 'pennycrab', key: 'cache' } as const, NO_CACHE)
const main = atom({ plugin: 'pennycrab', key: 'main' } as const, NO_MAIN)
const savings = atom({ plugin: 'pennycrab', key: 'savings' } as const, NO_SAVINGS)

type Usage = Parameters<typeof costOf>[1]

export type KeepWarm = 'off' | '15m' | '30m' | '1h' | '2h'
const MINUTE = 60_000
const TTL = { '5m': 5 * MINUTE, '1h': 60 * MINUTE } as const
type Ttl = keyof typeof TTL
const isTtl = (v: unknown): v is Ttl => v === '5m' || v === '1h'
const ttlName = (ms: number): Ttl => (ms >= TTL['1h'] ? '1h' : '5m')

// How long after the person's last turn the cache is kept warm; undefined when off.
export function keepWarmOf(option: KeepWarm | undefined): number | undefined {
  const k = option ?? '30m'
  if (k === 'off') return undefined
  return Number(k.slice(0, -1)) * (k.endsWith('h') ? 60 : 1) * MINUTE
}

// A ping goes out this long before the entry would lapse: the read lands at the request's start, and the
// one-second tick or a slow reply must not make it late.
const LEAD_MS = 45_000
// A ping that had to write more than this share of the main context found the entry mostly gone. Less is the
// norm: a fork re-sends the conversation as the transcript holds it, which can differ from how its first request
// went out, and writes that part again once; the next turn then reads it all.
const MAX_REWRITE = 0.5
const PING = 'pennycrab keep-alive: this message only keeps the prompt cache warm while the person is away. Reply with the single word ok.'

// The main thread's TTL, resolved in the engine's own order: FORCE_PROMPT_CACHING_5M, CLAUDE_CODE_PROMPT_CACHE_TTL,
// the promptCacheTtl setting, ENABLE_PROMPT_CACHING_1H, then the account: 1h on a Claude subscription within its
// limits (whose responses report the five_hour and seven_day windows), 5m on an API key or a cloud provider.
export async function ttlOf($: EngineInterface): Promise<Pick<Cache, 'ttlMs' | 'ttlSource'>> {
  if (await $.env.get('DISABLE_PROMPT_CACHING')) return { ttlMs: null, ttlSource: 'env' }
  if (await $.env.get('FORCE_PROMPT_CACHING_5M')) return { ttlMs: TTL['5m'], ttlSource: 'env' }
  const env = await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL')
  if (isTtl(env)) return { ttlMs: TTL[env], ttlSource: 'env' }
  const setting = await $.settings.read({ key: 'promptCacheTtl' })
  if (isTtl(setting)) return { ttlMs: TTL[setting], ttlSource: 'setting' }
  const isBedrock = Boolean(await $.env.get('CLAUDE_CODE_USE_BEDROCK'))
  if ((await $.env.get('ENABLE_PROMPT_CACHING_1H')) || (isBedrock && (await $.env.get('ENABLE_PROMPT_CACHING_1H_BEDROCK')))) {
    return { ttlMs: TTL['1h'], ttlSource: 'env' }
  }
  const isCloud = isBedrock || Boolean((await $.env.get('CLAUDE_CODE_USE_VERTEX')) || (await $.env.get('CLAUDE_CODE_USE_FOUNDRY')))
  const { rateLimits } = await $.session.usage()
  const isPlan = !isCloud && rateLimits.some(r => r.kind === 'five_hour' || r.kind === 'seven_day')
  const isOver = rateLimits.some(r => r.percentUsed >= 100)
  return { ttlMs: TTL[isPlan && !isOver ? '1h' : '5m'], ttlSource: 'auth' }
}

export async function onMainTurnStart($: EngineInterface) {
  await update($, cache, c => ({ ...c, isTurnOpen: true }))
}

// The person's turn is over: the keep-warm window starts, at the TTL the session caches with now.
export async function onMainTurnEnd($: EngineInterface) {
  const at = await $.clock.now()
  const ttl = await ttlOf($)
  await update($, cache, c => ({ ...c, ...ttl, isTurnOpen: false, isHalted: false, lastTurnAt: at }))
}

// What it costs to write `tokens` to the cache rather than read them from it.
function rewriteOf(model: string, tokens: number, ttl: Ttl) {
  const none = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const write = costOf(model, { ...none, cache_creation_input_tokens: tokens }, ttl)
  const readUsd = costOf(model, { ...none, cache_read_input_tokens: tokens }, ttl)
  return write === undefined || readUsd === undefined ? 0 : write - readUsd
}

// Each real request of the main thread: the entry lives on from here. The first after pings settles them: where
// the entry would have lapsed without them, what it read from the cache is a re-write spared.
export async function onMainStep($: EngineInterface, model: string, u: Usage) {
  const at = await $.clock.now()
  const c = await read($, cache)
  let saved = 0
  if (c.stretchPings > 0) {
    const wouldLapse = c.ttlMs !== null && c.lastTurnAt !== null && at - c.lastTurnAt > c.ttlMs
    saved = (wouldLapse && c.ttlMs !== null ? rewriteOf(model, u.cache_read_input_tokens, ttlName(c.ttlMs)) : 0) - c.stretchUsd
  }
  await update($, cache, v => ({ ...v, lastRequestAt: at, stretchPings: 0, stretchUsd: 0, savedUsd: v.savedUsd + saved }))
  if (saved !== 0) await update($, savings, s => ({ ...s, usd: s.usd + saved }))
}

// Past its end the entry is gone (the computer slept, say): a ping would pay to write it all again.
export const hasLapsed = (c: Cache, at: number) => c.ttlMs !== null && c.lastRequestAt !== null && at >= c.lastRequestAt + c.ttlMs

// The time the next ping is due, or undefined while none is: a turn is open, the window is covered, or a ping
// found nothing to keep.
export function pingDueAt(c: Cache, windowMs: number): number | undefined {
  if (c.isTurnOpen || c.isHalted || c.ttlMs === null || c.lastRequestAt === null || c.lastTurnAt === null) return undefined
  const lapsesAt = c.lastRequestAt + c.ttlMs
  return lapsesAt >= c.lastTurnAt + windowMs ? undefined : lapsesAt - LEAD_MS
}

let isPinging = false
// Each second: once a ping is due, one fork of the main thread reads its cache, which renews the entry.
export async function keepWarm($: EngineInterface, windowMs: number | undefined) {
  if (windowMs === undefined || isPinging) return
  const c = await read($, cache)
  const due = pingDueAt(c, windowMs)
  const at = await $.clock.now()
  if (due === undefined || at < due || c.ttlMs === null) return
  if (hasLapsed(c, at)) {
    await update($, cache, v => ({ ...v, isHalted: true }))
    return
  }
  isPinging = true
  try {
    const m = await read($, main)
    const r = await $.model.fork({ prompt: PING })
    if (!('usage' in r)) {
      await update($, cache, v => ({ ...v, isHalted: true }))
      return
    }
    const usd = costOf(m.model, r.usage, ttlName(c.ttlMs)) ?? 0
    // Read or written, the whole prefix is in the cache now; a ping that wrote most of it stops the pings.
    const isMiss = r.usage.cache_creation_input_tokens > m.contextTokens * MAX_REWRITE
    await update($, cache, v => ({
      ...v,
      lastRequestAt: at,
      isHalted: isMiss,
      stretchPings: v.stretchPings + 1,
      stretchUsd: v.stretchUsd + usd,
      pings: v.pings + 1,
      pingUsd: v.pingUsd + usd,
    }))
  } finally {
    isPinging = false
  }
}
