import type { Tier } from '../types'

type Price = { input: number; write5m: number; write1h: number; read: number; output: number }
type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// USD per million tokens, Anthropic list prices checked on 2026-10-22. Only the 5.x family:
// older models price differently, and a wrong number is worse than none.
const PRICES: Record<'opus' | 'sonnet' | 'haiku' | 'haikuLong' | 'fable', Price> = {
  opus: { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 },
  sonnet: { input: 2, write5m: 2.5, write1h: 4, read: 0.1, output: 10 },
  haiku: { input: 0.1, write5m: 0.125, write1h: 0.2, read: 0.01, output: 0.5 },
  // Haiku 5.5 bills a request whose prompt passes 100K tokens at this higher rate.
  haikuLong: { input: 0.5, write5m: 0.625, write1h: 1, read: 0.05, output: 2.5 },
  fable: { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 },
}

export const HAIKU_LONG_PROMPT = 100_000

export function tierOf(model: string): Tier {
  const m = model.toLowerCase()
  for (const t of ['haiku', 'sonnet', 'opus', 'fable'] as const) if (m.includes(t)) return t
  return 'other'
}

// An alias (`haiku`) or a 5.x id (`claude-haiku-5-5`, `claude-fable-5-1`); undefined for anything else.
function priceOf(model: string, promptTokens: number): Price | undefined {
  const m = model.toLowerCase()
  const tier = tierOf(m)
  if (tier === 'other') return undefined
  if (m !== tier && !new RegExp(`${tier}-5(\\D|$)`).test(m)) return undefined
  if (tier === 'haiku' && promptTokens > HAIKU_LONG_PROMPT) return PRICES.haikuLong
  return PRICES[tier]
}

export function promptTokens(u: Usage): number {
  return u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
}

// What one request cost; cache writes at the TTL the request wrote (subagents always write 5m).
export function costOf(model: string, u: Usage, ttl: '5m' | '1h'): number | undefined {
  const p = priceOf(model, promptTokens(u))
  if (!p) return undefined
  const write = ttl === '1h' ? p.write1h : p.write5m
  return (u.input_tokens * p.input + u.cache_creation_input_tokens * write + u.cache_read_input_tokens * p.read + u.output_tokens * p.output) / 1e6
}
