// Subagents the router moved: the parent's model (what it would have run on) and the effort it set.
export const routed = new Map<string, { from: string; effort?: 'low' }>()

// Initial values, shared by every file that declares an atom of these keys.
export const NO_MAIN = { model: '', contextTokens: 0, contextWindow: 0, costUsd: 0 }
export const NO_SAVINGS = { usd: 0, routed: 0 }
export const UI_START = { isCompact: false, isDoneOpen: false, isBandHidden: false }
