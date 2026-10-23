import type { EngineInterface } from 'claude-code'

import type { Agent } from '../types'

export type ForecastMode = 'on' | 'nudge' | 'off'

const STORE_KEY = 'history'
// Runs kept per key, and the fewest a forecast is made from: below that one odd run would set it.
const KEEP = 30
const MIN_RUNS = 10
// Past the 90th percentile by half again: about one normal run in ten passes the percentile itself.
const MARGIN = 1.5

// Token totals of finished runs, oldest first, under `type · tier[ · fork]`, once for every project together and
// once under `<project> | <key>` for the project alone.
type History = Record<string, number[]>

export const forecastModeOf = (o: unknown): ForecastMode => (o === 'nudge' || o === 'off' ? o : 'on')
export const keyOf = (type: string, tier: string, fork: boolean) => `${type} · ${tier}${fork ? ' · fork' : ''}`

export function forecastOf(runs: readonly number[]): number | undefined {
  if (runs.length < MIN_RUNS) return undefined
  const sorted = [...runs].sort((a, b) => a - b)
  return Math.round(sorted[Math.ceil(sorted.length * 0.9) - 1]! * MARGIN)
}

async function historyOf($: EngineInterface) {
  return ((await $.store.get(STORE_KEY).catch(() => undefined)) ?? {}) as History
}

// The project's own runs once it has enough of them; until then every project's.
export async function forecastFor($: EngineInterface, project: string, key: string) {
  const h = await historyOf($)
  return forecastOf(h[`${project} | ${key}`] ?? []) ?? forecastOf(h[key] ?? [])
}

// A run that ended with its answer joins the history; a stopped one is cut short, a resumed one is half a task,
// a teammate never really ends: none of those would say what a run like it takes.
export async function learn($: EngineInterface, project: string, a: Agent | undefined, reason: string) {
  if (!a?.forecastKey || reason !== 'answer' || a.trip || a.isResumed || a.isTeammate || a.tokens === 0) return
  const h = await historyOf($)
  for (const k of [a.forecastKey, `${project} | ${a.forecastKey}`]) h[k] = [...(h[k] ?? []), a.tokens].slice(-KEEP)
  await $.store.set(STORE_KEY, h).catch(() => undefined)
}
