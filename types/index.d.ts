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
  trip?: 'budget' | 'haiku-context'
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

export type Cache = {
  ttlMs: number | null
  ttlSource: 'setting' | 'env' | 'auth' | 'unknown'
  lastRequestAt: number | null
  pings: number
  pingUsd: number
  held: { text: string; at: number } | null
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
