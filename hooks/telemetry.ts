import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface } from 'claude-code'

import type { Agent, AgentStatus } from '../types'
import { costOf, promptTokens, tierOf } from './prices'
import type { Route } from './router'
import { NO_MAIN, NO_SAVINGS } from './state'

// The state lib's scan reads an atom only where its reference is written, so each file declares the ones it uses.
export const agents = atom({ plugin: 'pennycrab', key: 'agents' } as const, [])
export const main = atom({ plugin: 'pennycrab', key: 'main' } as const, NO_MAIN)
export const savings = atom({ plugin: 'pennycrab', key: 'savings' } as const, NO_SAVINGS)

type Usage = Parameters<typeof costOf>[1]

const KEEP_FINISHED = 20
// shortcut: every 5.x model has a 1M window and the engine reports no subagent's; read it if that changes.
const WINDOW = 1_000_000

// Running agents, teammates (which wake again with no new spawn), and the last KEEP_FINISHED finished ones,
// oldest first.
export function prune(list: Agent[]): Agent[] {
  const done = list.filter(a => a.endedAt !== undefined && !a.isTeammate)
  const drop = new Set(done.slice(0, Math.max(0, done.length - KEEP_FINISHED)).map(a => a.id))
  return list.filter(a => !drop.has(a.id))
}

export function statusOf(reason: string): AgentStatus {
  return reason === 'answer' ? 'completed' : reason === 'aborted' ? 'stopped' : 'failed'
}

async function patch($: EngineInterface, id: string, fn: (a: Agent) => Agent) {
  await update($, agents, list => list.map(a => (a.id === id ? fn(a) : a)))
}

// A new row; for a resume, the agent's own row running again, its spend and handover kept so its budget does
// not start over. True when it starts a wave: no other subagent was running.
export async function addAgent($: EngineInterface, e: AgentSpawnInput, id: string, model: string, route: Route | undefined) {
  const at = await $.clock.now()
  let isFirst = false
  await update($, agents, list => {
    isFirst = !list.some(a => a.endedAt === undefined && a.id !== id)
    const own = e.resume ? list.find(a => a.id === id) : undefined
    const row: Agent = own
      ? { ...own, model, tier: tierOf(model), status: 'running', endedAt: undefined, currentTool: undefined }
      : {
          id,
          description: e.description,
          type: e.subagentType,
          model,
          tier: tierOf(model),
          routedFrom: route?.from,
          effort: route?.effort,
          background: e.background,
          isTeammate: e.isTeammate,
          status: 'running',
          startedAt: at,
          steps: 0,
          contextTokens: 0,
          contextWindow: WINDOW,
          costUsd: 0,
          savedUsd: 0,
        }
    return prune([...list.filter(a => a.id !== id), row])
  })
  return isFirst
}

export async function recordStep($: EngineInterface, agentId: string | undefined, model: string, u: Usage) {
  // The session's cost is the engine's own, every subagent's and ping's included: each step brings it up to date.
  const s = await $.session.usage()
  if (agentId === undefined) {
    await update($, main, () => ({ model, contextTokens: s.context.tokens ?? 0, contextWindow: s.context.window, costUsd: s.cost?.usd ?? 0 }))
    return
  }
  await update($, main, m => ({ ...m, costUsd: s.cost?.usd ?? m.costUsd }))
  const from = (await read($, agents)).find(a => a.id === agentId)?.routedFrom
  // Subagents always write the 5-minute cache.
  const cost = costOf(model, u, '5m')
  const would = from === undefined ? undefined : costOf(from, u, '5m')
  const saved = cost === undefined || would === undefined ? 0 : Math.max(0, would - cost)
  // A step after the turn ended means the agent was resumed: it runs again.
  await patch($, agentId, a => ({
    ...a,
    model,
    tier: tierOf(model),
    status: a.endedAt === undefined ? a.status : 'running',
    endedAt: undefined,
    steps: a.steps + 1,
    contextTokens: promptTokens(u) + u.output_tokens,
    costUsd: a.costUsd + (cost ?? 0),
    isUnpriced: a.isUnpriced || cost === undefined || undefined,
    savedUsd: a.savedUsd + saved,
  }))
  if (saved > 0) await update($, savings, s => ({ ...s, usd: s.usd + saved }))
}

export async function setTool($: EngineInterface, id: string, tool: string | undefined) {
  await patch($, id, a =>
    tool !== undefined && a.status === 'running'
      ? { ...a, status: 'tool', currentTool: tool }
      : tool === undefined && a.status === 'tool'
        ? { ...a, status: 'running', currentTool: undefined }
        : a,
  )
}

export async function finish($: EngineInterface, id: string, reason: string) {
  const now = await $.clock.now()
  // The guard's handover outlives the turn's own reason.
  await patch($, id, a => ({ ...a, status: a.status === 'handover' ? a.status : statusOf(reason), currentTool: undefined, endedAt: now }))
  await update($, agents, prune)
}
