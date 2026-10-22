import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Cache } from '../types'
import { costOf, tierOf } from './prices'
import { NO_CACHE, NO_MAIN, NO_SAVINGS } from './state'

// The state lib's scan reads an atom only where its reference is written, so each file declares the ones it uses.
const cache = atom({ plugin: 'pennycrab', key: 'cache' } as const, NO_CACHE)
const main = atom({ plugin: 'pennycrab', key: 'main' } as const, NO_MAIN)
const savings = atom({ plugin: 'pennycrab', key: 'savings' } as const, NO_SAVINGS)

type Usage = Parameters<typeof costOf>[1]

export type KeepWarm = 'auto' | 'off' | '30m' | '1h' | '2h' | '4h' | '8h'
const MINUTE = 60_000
const TTL = { '5m': 5 * MINUTE, '1h': 60 * MINUTE } as const
type Ttl = keyof typeof TTL
const isTtl = (v: unknown): v is Ttl => v === '5m' || v === '1h'
const ttlName = (ms: number): Ttl => (ms >= TTL['1h'] ? '1h' : '5m')

// How long after the person's last turn the cache is kept warm; undefined when off. `auto` keeps it warm while
// the pings of one absence cost at most AUTO_SHARE of the rewrite they spare, so that coming back once pays them
// back four times, for AUTO_MAX at most: a few pings an hour on a 5-minute cache, one an hour on a 1-hour cache.
export type WarmPolicy = { windowMs: number; isAuto: boolean }
const AUTO_SHARE = 0.25
const AUTO_MAX = 8 * 60 * MINUTE
export function keepWarmOf(option: KeepWarm | undefined): WarmPolicy | undefined {
  const k = option ?? 'auto'
  if (k === 'off') return undefined
  if (k === 'auto') return { windowMs: AUTO_MAX, isAuto: true }
  return { windowMs: Number(k.slice(0, -1)) * (k.endsWith('h') ? 60 : 1) * MINUTE, isAuto: false }
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
  // Projected here: a `{ key }` read can answer with the whole object (2.1.302's test kit does), not the key's value.
  const setting = (await $.settings.read()).promptCacheTtl
  if (isTtl(setting)) return { ttlMs: TTL[setting], ttlSource: 'setting' }
  const isBedrock = Boolean(await $.env.get('CLAUDE_CODE_USE_BEDROCK'))
  if ((await $.env.get('ENABLE_PROMPT_CACHING_1H')) || (isBedrock && (await $.env.get('ENABLE_PROMPT_CACHING_1H_BEDROCK')))) {
    return { ttlMs: TTL['1h'], ttlSource: 'env' }
  }
  const isCloud = isBedrock || Boolean((await $.env.get('CLAUDE_CODE_USE_VERTEX')) || (await $.env.get('CLAUDE_CODE_USE_FOUNDRY')))
  const { rateLimits } = await $.session.usage()
  if (isCloud) return { ttlMs: TTL['5m'], ttlSource: 'cloud' }
  if (!rateLimits.some(r => r.kind === 'five_hour' || r.kind === 'seven_day')) return { ttlMs: TTL['5m'], ttlSource: 'api' }
  return rateLimits.some(r => r.percentUsed >= 100) ? { ttlMs: TTL['5m'], ttlSource: 'plan-over' } : { ttlMs: TTL['1h'], ttlSource: 'plan' }
}

export async function onMainTurnStart($: EngineInterface) {
  await update($, cache, c => ({ ...c, isTurnOpen: true }))
}

// The person's turn is over: the keep-warm window starts, at the TTL the session caches with now, which it returns.
export async function onMainTurnEnd($: EngineInterface) {
  const at = await $.clock.now()
  const ttl = await ttlOf($)
  await update($, cache, c => ({ ...c, ...ttl, isTurnOpen: false, isHalted: false, lastTurnAt: at }))
  return ttl
}

// What it costs to write `tokens` to the cache rather than read them from it.
function rewriteOf(model: string, tokens: number, ttl: Ttl) {
  const none = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const write = costOf(model, { ...none, cache_creation_input_tokens: tokens }, ttl)
  const readUsd = costOf(model, { ...none, cache_read_input_tokens: tokens }, ttl)
  return write === undefined || readUsd === undefined ? 0 : write - readUsd
}

// Each real request of the main thread, `sentAt` its start: the entry lives on from there. The first after pings
// settles them: where the entry would have lapsed without them, what it read from the cache is a re-write spared.
export async function onMainStep($: EngineInterface, model: string, u: Usage, sentAt: number) {
  const c = await read($, cache)
  let saved = 0
  if (c.stretchPings > 0) {
    const wouldLapse = c.ttlMs !== null && c.lastTurnAt !== null && sentAt - c.lastTurnAt > c.ttlMs
    saved = (wouldLapse && c.ttlMs !== null ? rewriteOf(model, u.cache_read_input_tokens, ttlName(c.ttlMs)) : 0) - c.stretchUsd
  }
  await update($, cache, v => ({ ...v, lastRequestAt: sentAt, stretchPings: 0, stretchUsd: 0, savedUsd: v.savedUsd + saved }))
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

// Under `auto`, whether one more ping still pays: this absence's pings so far, and the next one, which reads the
// context from the cache, against a quarter of the rewrite they spare. The first ping after a turn can write a
// part of the context again (see MAX_REWRITE), so it can cost more than that quarter alone. Without prices
// nothing can be weighed, and no ping goes out.
function isWorthAnother(c: Cache, model: string, contextTokens: number, ttl: Ttl) {
  const rewrite = rewriteOf(model, contextTokens, ttl)
  const next = costOf(model, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: contextTokens }, ttl)
  return rewrite > 0 && next !== undefined && c.stretchUsd + next <= rewrite * AUTO_SHARE
}

// A ping that reached no cache (an API error, an abort) is tried again this much later, until the entry lapses.
const RETRY_MS = 15_000
let retryAt = 0
let isPinging = false
// Each second: once a ping is due, one fork of the main thread reads its cache, which renews the entry.
export async function keepWarm($: EngineInterface, policy: WarmPolicy | undefined) {
  // Claimed before the first wait, so a slow tick cannot send a second ping beside it.
  if (policy === undefined || isPinging) return
  isPinging = true
  try {
    await pingIfDue($, policy)
  } finally {
    isPinging = false
  }
}

async function pingIfDue($: EngineInterface, policy: WarmPolicy) {
  const c = await read($, cache)
  const due = pingDueAt(c, policy.windowMs)
  const at = await $.clock.now()
  if (due === undefined || at < Math.max(due, retryAt) || c.ttlMs === null) return
  const m = await read($, main)
  const halt = () => update($, cache, v => ({ ...v, isHalted: true }))
  if (hasLapsed(c, at) || (policy.isAuto && !isWorthAnother(c, m.model, m.contextTokens, ttlName(c.ttlMs)))) return halt()
  // After /model the fork runs on the new model, which has no entry: it would write the whole prefix for nothing.
  const [was, is] = [tierOf(m.model), tierOf(await $.session.model())]
  if (was !== 'other' && is !== 'other' && was !== is) return halt()
  const r = await $.model.fork({ prompt: PING })
  if (!('usage' in r)) return halt()
  if (r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens === 0) {
    retryAt = at + RETRY_MS
    return
  }
  const usd = costOf(m.model, r.usage, ttlName(c.ttlMs)) ?? 0
  // Read or written, the whole prefix is in the cache now; a ping that wrote most of it stops the pings.
  const isMiss = r.usage.cache_creation_input_tokens > m.contextTokens * MAX_REWRITE
  // A request of a new turn that went out meanwhile settled the stretch without this ping: it is a cost alone.
  let isLate = false
  await update($, cache, v => {
    isLate = v.lastRequestAt !== c.lastRequestAt
    const counted = { ...v, pings: v.pings + 1, pingUsd: v.pingUsd + usd }
    return isLate
      ? { ...counted, savedUsd: v.savedUsd - usd }
      : { ...counted, lastRequestAt: at, isHalted: isMiss, stretchPings: v.stretchPings + 1, stretchUsd: v.stretchUsd + usd }
  })
  if (isLate && usd > 0) await update($, savings, s => ({ ...s, usd: s.usd - usd }))
  const s = await $.session.usage()
  await update($, main, v => ({ ...v, costUsd: s.cost?.usd ?? v.costUsd }))
}
