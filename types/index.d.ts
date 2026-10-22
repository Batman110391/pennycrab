export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable' | 'other'

export type AgentStatus = 'running' | 'tool' | 'handover' | 'completed' | 'failed' | 'stopped'

// One subagent as the pane and the status line draw it. Elapsed time is (endedAt ?? now) - startedAt.
export type Agent = {
  id: string
  description: string
  type: string
  model: string
  tier: Tier
  // The model the parent would have given it, when pennycrab routed it elsewhere.
  routedFrom?: string
  effort?: string
  background: boolean
  status: AgentStatus
  currentTool?: string
  startedAt: number
  endedAt?: number
  steps: number
  contextTokens: number
  contextWindow: number
  costUsd: number
  savedUsd: number
  // Why the guard stopped it, once it did.
  trip?: 'budget'
}

export type Main = {
  model: string
  contextTokens: number
  contextWindow: number
  costUsd: number
}

export type Savings = {
  usd: number
  routed: number
}

// The main thread's prompt cache, as the keep-warm sees it.
export type Cache = {
  // Its lifetime and what decided it, as of the last turn; null when the session caches nothing.
  ttlMs: number | null
  ttlSource: 'setting' | 'env' | 'auth' | 'unknown'
  // The main thread's last request, a ping's included: its entry lives ttlMs from here.
  lastRequestAt: number | null
  // The end of the person's last turn: the keep-warm window runs from here.
  lastTurnAt: number | null
  isTurnOpen: boolean
  // A ping found nothing to keep (the entry had lapsed, or nothing to fork): no more until the next turn.
  isHalted: boolean
  // Pings since the last turn and what they cost, settled when the next turn reads the cache.
  stretchPings: number
  stretchUsd: number
  // Since the session began; savedUsd is the re-writes the pings spared less every ping's cost.
  pings: number
  pingUsd: number
  savedUsd: number
}

export type Ui = {
  isCompact: boolean
  isDoneOpen: boolean
  // Hidden from its ✕ until the next subagent starts.
  isBandHidden: boolean
}

declare module 'claude-code' {
  interface PluginState {
    pennycrab: {
      // Running subagents plus the last 20 finished ones.
      agents: Agent[]
      main: Main
      savings: Savings
      cache: Cache
      ui: Ui
      // The time the drawings show: written each second while a subagent runs, which is what redraws them.
      now: number
    }
  }
}
