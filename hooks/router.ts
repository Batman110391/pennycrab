import type { AgentSpawnInput, AgentSpawnResult, EngineInterface, TurnStepInput } from 'claude-code'

import { tierOf } from './prices'
import { routed } from './state'

export type RouterMode = 'prudent' | 'aggressive' | 'off'
type Pick = { model: 'haiku' | 'sonnet'; effort?: 'low' }

const RANK: Record<string, number> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }

// The model a built-in subagent gets instead of inheriting its parent's, or undefined to leave it.
// Never a model above the parent's; a type the user defined keeps its own model.
export function routeFor(mode: RouterMode, type: string, parentModel: string): Pick | undefined {
  if (mode === 'off' || (type !== 'Explore' && type !== 'general-purpose')) return undefined
  const pick: Pick = mode === 'aggressive' && type === 'Explore' ? { model: 'haiku', effort: 'low' } : { model: 'sonnet' }
  const parent = RANK[tierOf(parentModel)]
  return parent !== undefined && RANK[pick.model]! < parent ? pick : undefined
}

// Where the user already picks subagent models, or aliases may resolve elsewhere, the router stays out.
async function isOptedOut($: EngineInterface) {
  return Boolean(
    (await $.env.get('CLAUDE_CODE_SUBAGENT_MODEL')) ||
      (await $.env.get('CLAUDE_CODE_USE_BEDROCK')) ||
      (await $.env.get('CLAUDE_CODE_USE_VERTEX')) ||
      (await $.env.get('CLAUDE_CODE_USE_FOUNDRY')),
  )
}

// Starts the spawn, on a cheaper model where routeFor picks one.
export async function spawnRouted(
  $: EngineInterface,
  e: AgentSpawnInput,
  next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>,
  mode: RouterMode,
): Promise<AgentSpawnResult> {
  const isPlain = e.model === undefined && !e.fork && !e.isTeammate && !e.workflow && !e.resume
  const pick = isPlain ? routeFor(mode, e.subagentType, e.parentModel) : undefined
  if (!pick || (await isOptedOut($))) return next(e)
  const started = await next({ ...e, model: pick.model })
  if (started.agentId !== undefined) routed.set(started.agentId, { from: e.parentModel, effort: pick.effort })
  return started
}

// The spawn sets no effort, so a routed agent's requests carry it.
export function withRoutedEffort(e: TurnStepInput): TurnStepInput {
  const effort = e.agentId === undefined ? undefined : routed.get(e.agentId)?.effort
  return effort && e.effort !== undefined ? { ...e, effort } : e
}
