export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable' | 'other'

export type AgentStatus = 'running' | 'tool' | 'handover' | 'completed' | 'failed' | 'stopped'

// One subagent as the pane and the status line draw it. Elapsed time is (endedAt ?? now) - startedAt.
export type Agent = {
  id: string
  description: string
  type: string
  model: string
  tier: Tier
  // The model it would have run on without pennycrab, and the effort it sets, when pennycrab routed it.
  routedFrom?: string
  effort?: 'low'
  background: boolean
  // A teammate wakes again on a message, with no new spawn: its row is kept.
  isTeammate?: true
  status: AgentStatus
  currentTool?: string
  startedAt: number
  endedAt?: number
  steps: number
  contextTokens: number
  contextWindow: number
  // Tokens this run worked through: each step's prompt and reply, since its start or its last resume.
  tokens: number
  // What a run like it uses, fixed at its start: past it a nudge, past twice it a handover. None until the
  // history holds enough runs like it, and none for a resumed run.
  forecast?: number
  // The history it is weighed against and, unless resumed or stopped, adds itself to: type · tier · fork.
  forecastKey?: string
  isResumed?: true
  isNudged?: true
  costUsd: number
  // A request on a model the pricing page does not list (or before any prices): its cost is unknown.
  isUnpriced?: true
  savedUsd: number
  // Why the guard stopped it, once it did: its spend, twice its forecast, or the same call over and over.
  trip?: 'budget' | 'forecast' | 'loop'
}

export type Main = {
  model: string
  contextTokens: number
  contextWindow: number
  costUsd: number
}

export type Savings = {
  usd: number
}

// The main thread's prompt cache, as the keep-warm sees it.
export type Cache = {
  // Its lifetime and what decided it, as of the last turn; null when the session caches nothing.
  ttlMs: number | null
  // env or setting: a variable or setting chose it; else the account did: a subscription within its limits (plan),
  // one past them (plan-over), pay-per-token (api), a cloud provider (cloud).
  ttlSource: 'setting' | 'env' | 'plan' | 'plan-over' | 'api' | 'cloud' | 'unknown'
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
