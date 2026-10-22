import { atom, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface } from 'claude-code'

import type { Agent, AgentStatus } from '../types'
import { costOf, promptTokens, tierOf } from './prices'
import { NO_MAIN, NO_SAVINGS, routed } from './state'

// The state lib's scan reads an atom only where its reference is written, so each file declares the ones it uses.
export const agents = atom({ plugin: 'pennycrab', key: 'agents' } as const, [])
export const main = atom({ plugin: 'pennycrab', key: 'main' } as const, NO_MAIN)
export const savings = atom({ plugin: 'pennycrab', key: 'savings' } as const, NO_SAVINGS)

type Usage = Parameters<typeof costOf>[1]

const KEEP_FINISHED = 20
// shortcut: every 5.x model has a 1M window and the engine reports no subagent's; read it if that changes.
const WINDOW = 1_000_000

// Running agents and the last KEEP_FINISHED finished ones, oldest first.
export function prune(list: Agent[]): Agent[] {
  const done = list.filter(a => a.endedAt !== undefined)
  const drop = new Set(done.slice(0, Math.max(0, done.length - KEEP_FINISHED)).map(a => a.id))
  return list.filter(a => !drop.has(a.id))
}

export function statusOf(reason: string): AgentStatus {
  return reason === 'answer' ? 'completed' : reason === 'aborted' ? 'stopped' : 'failed'
}

async function patch($: EngineInterface, id: string, fn: (a: Agent) => Agent) {
  await update($, agents, list => list.map(a => (a.id === id ? fn(a) : a)))
}

export async function addAgent($: EngineInterface, e: AgentSpawnInput, id: string, model: string) {
  const r = routed.get(id)
  const row: Agent = {
    id,
    description: e.description,
    type: e.subagentType,
    model,
    tier: tierOf(model),
    routedFrom: r?.from,
    effort: r?.effort,
    background: e.background,
    status: 'running',
    startedAt: await $.clock.now(),
    steps: 0,
    contextTokens: 0,
    contextWindow: WINDOW,
    costUsd: 0,
    savedUsd: 0,
  }
  // A resumed agent keeps its id: its row is replaced, not doubled.
  await update($, agents, list => prune([...list.filter(a => a.id !== id), row]))
  if (r) await update($, savings, s => ({ ...s, routed: s.routed + 1 }))
}

export async function recordStep($: EngineInterface, agentId: string | undefined, model: string, u: Usage) {
  if (agentId === undefined) {
    const s = await $.session.usage()
    await update($, main, () => ({ model, contextTokens: s.context.tokens ?? 0, contextWindow: s.context.window, costUsd: s.cost?.usd ?? 0 }))
    return
  }
  // Subagents always write the 5-minute cache.
  const cost = costOf(model, u, '5m') ?? 0
  const from = routed.get(agentId)?.from
  const would = from === undefined ? undefined : costOf(from, u, '5m')
  const saved = would === undefined ? 0 : Math.max(0, would - cost)
  // A step after the turn ended means the agent was resumed: it runs again.
  await patch($, agentId, a => ({
    ...a,
    model,
    tier: tierOf(model),
    status: a.endedAt === undefined ? a.status : 'running',
    endedAt: undefined,
    steps: a.steps + 1,
    contextTokens: promptTokens(u) + u.output_tokens,
    costUsd: a.costUsd + cost,
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
