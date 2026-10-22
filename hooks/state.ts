import type { Cache } from '../types'

// Subagents the router moved: the parent's model (what it would have run on) and the effort it set.
export const routed = new Map<string, { from: string; effort?: 'low' }>()

// Initial values, shared by every file that declares an atom of these keys.
export const NO_MAIN = { model: '', contextTokens: 0, contextWindow: 0, costUsd: 0 }
export const NO_SAVINGS = { usd: 0, routed: 0 }
export const UI_START = { isCompact: false, isDoneOpen: false, isBandHidden: false }
export const NO_CACHE: Cache = {
  ttlMs: null,
  ttlSource: 'unknown',
  lastRequestAt: null,
  lastTurnAt: null,
  isTurnOpen: false,
  isHalted: false,
  stretchPings: 0,
  stretchUsd: 0,
  pings: 0,
  pingUsd: 0,
  savedUsd: 0,
}
