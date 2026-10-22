import type { EngineInterface } from 'claude-code'

import type { Tier } from '../types'

// USD per million tokens for one model, as Anthropic's pricing page lists it.
export type Rates = { input: number; write5m: number; write1h: number; read: number; output: number }
// A model priced by prompt length (Haiku 5.5) has a second set past `above` prompt tokens.
export type ModelPrice = Rates & { long?: Rates & { above: number } }
// The prices this session uses, as fetched, kept in the store across sessions.
export type PriceBook = { fetchedAt: number; models: Record<string, ModelPrice> }
type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// Anthropic's own pricing page, as Markdown: the one source, so no price lives in this code.
export const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md'
const STORE_KEY = 'prices'
const MAX_AGE_MS = 24 * 3600_000

let book: PriceBook | undefined
export const priceBook = () => book
// Tests, and the loader: the prices costOf reads from now on.
export function usePrices(next: PriceBook | undefined) {
  book = next
}

export function tierOf(model: string): Tier {
  const m = model.toLowerCase()
  for (const t of ['haiku', 'sonnet', 'opus', 'fable'] as const) if (m.includes(t)) return t
  return 'other'
}

const usdOf = (cell: string) => Number(/\$([\d.]+)\s*\/\s*MTok/.exec(cell)?.[1] ?? NaN)

// The page's "Model pricing" table, one row per model, the version in its name:
// `| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok<sup>2</sup> | $20 / MTok |`.
// A row "(for prompts over 100,000 tokens)" is the long-prompt price of the model on the row before it.
// Undefined for a page whose table is gone or changed shape: a wrong price is worse than none.
export function parsePricing(md: string): Record<string, ModelPrice> | undefined {
  const lines = md.split('\n')
  const from = lines.findIndex(l => l.startsWith('## Model pricing'))
  if (from < 0) return undefined
  const to = lines.findIndex((l, i) => i > from && l.startsWith('## '))
  const models: Record<string, ModelPrice> = {}
  for (const line of lines.slice(from + 1, to < 0 ? undefined : to)) {
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    const name = cells.length === 6 ? /^Claude (Opus|Sonnet|Haiku|Fable|Mythos) (\d+)(?:\.(\d+))?\b/.exec(cells[0]!) : null
    if (!name) continue
    const [input, write5m, write1h, read, output] = cells.slice(1).map(usdOf) as [number, number, number, number, number]
    if (![input, write5m, write1h, read, output].every(Number.isFinite)) continue
    const rates: Rates = { input, write5m, write1h, read, output }
    const id = `claude-${name[1]!.toLowerCase()}-${name[2]}${name[3] ? `-${name[3]}` : ''}`
    const over = /for prompts over ([\d,]+) tokens/.exec(cells[0]!)
    if (over && models[id]) models[id] = { ...models[id]!, long: { ...rates, above: Number(over[1]!.replace(/,/g, '')) } }
    else if (!over) models[id] = rates
  }
  const families = new Set(Object.keys(models).map(id => id.split('-')[1]))
  return ['opus', 'sonnet', 'haiku'].every(f => families.has(f)) ? models : undefined
}

const versionOf = (id: string) => id.split('-').slice(2).map(Number)
// Positive when model id `a` is a later version than `b`, of one family.
const byVersion = (a: string, b: string) => {
  const [x, y] = [versionOf(a), versionOf(b)]
  return (x[0] ?? 0) - (y[0] ?? 0) || (x[1] ?? 0) - (y[1] ?? 0)
}

// The page's row for a model as requests name it: `claude-opus-5-5`, `claude-opus-5-5[1m]`,
// `us.anthropic.claude-opus-5-5-v1:0`, a dated `claude-opus-5-20260115`, or an alias (`opus`), which is its
// family's newest version. Undefined for a model the page does not list.
export function priceKeyOf(model: string, models: Record<string, ModelPrice>): string | undefined {
  const m = model.toLowerCase().replace(/\[.*\]$/, '')
  const v = /(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(m)
  if (v) {
    const id = `claude-${v[1]}-${v[2]}${v[3] ? `-${v[3]}` : ''}`
    return models[id] ? id : undefined
  }
  if (!/^(opus|sonnet|haiku|fable)$/.test(m)) return undefined
  return Object.keys(models)
    .filter(id => id.split('-')[1] === m)
    .reduce<string | undefined>((best, id) => (best === undefined || byVersion(id, best) > 0 ? id : best), undefined)
}

const priceOfModel = (model: string) => {
  const key = book && priceKeyOf(model, book.models)
  return key ? book!.models[key] : undefined
}

export function promptTokens(u: Usage): number {
  return u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
}

// What one request cost; cache writes at the TTL the request wrote (subagents always write 5m). Undefined
// without prices for the model: the page does not list it, or none were ever fetched.
export function costOf(model: string, u: Usage, ttl: '5m' | '1h'): number | undefined {
  const price = priceOfModel(model)
  if (!price) return undefined
  const p = price.long && promptTokens(u) > price.long.above ? price.long : price
  const write = ttl === '1h' ? p.write1h : p.write5m
  return (u.input_tokens * p.input + u.cache_creation_input_tokens * write + u.cache_read_input_tokens * p.read + u.output_tokens * p.output) / 1e6
}

const isBook = (v: unknown): v is PriceBook =>
  typeof v === 'object' && v !== null && typeof (v as PriceBook).fetchedAt === 'number' && typeof (v as PriceBook).models === 'object'

// At session start: the prices kept from an earlier session, at once.
export async function loadStoredPrices($: EngineInterface) {
  const stored = await $.store.get(STORE_KEY).catch(() => undefined)
  if (isBook(stored)) usePrices(stored)
}

// Then the page again, once those are a day old. No network, or a page that does not parse, leaves the kept
// prices; with none kept, costs stay unknown rather than made up.
export async function refreshPrices($: EngineInterface) {
  const at = await $.clock.now()
  if (book && at - book.fetchedAt < MAX_AGE_MS) return
  const r = await $.http.fetch(PRICING_URL)
  const models = r.ok ? parsePricing(r.text) : undefined
  if (!models) return
  usePrices({ fetchedAt: at, models })
  await $.store.set(STORE_KEY, book)
}
