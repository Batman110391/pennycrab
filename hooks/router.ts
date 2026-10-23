import { atom, read } from 'claude-code'
import type { AgentSpawnInput, AgentSpawnResult, EngineInterface, TurnStepInput } from 'claude-code'

import { tierOf } from './prices'

// The state lib's scan reads an atom only where its reference is written, so each file declares the ones it uses.
const agents = atom({ plugin: 'pennycrab', key: 'agents' } as const, [])

export type RouterMode = 'auto' | 'explore' | 'prudent' | 'off'
type Pick = { model: 'haiku' | 'sonnet'; effort?: 'low' }
// A routed subagent: what it would have run on without pennycrab, and the effort it sets.
export type Route = { from: string; effort?: 'low' }

const RANK: Record<string, number> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }
// Mythos is priced as Fable and ranks with it.
const rankOf = (model: string) => (/mythos/i.test(model) ? RANK.fable : RANK[tierOf(model)])

// The model a built-in subagent gets instead of inheriting its parent's, or undefined to leave it.
// auto: Explore, which only reads and searches, on Haiku at low effort (measured: the same 32 files described, at
// 5% of Sonnet's cost and 70% of its time); general-purpose, which also edits, on Sonnet. explore: Explore alone, as
// in auto, so the subagents that write code keep the session's model. prudent: both on Sonnet.
// Never a model above the parent's; a type the user defined keeps its own model.
export function routeFor(mode: RouterMode, type: string, parentModel: string): Pick | undefined {
  if (mode === 'off' || (type !== 'Explore' && (type !== 'general-purpose' || mode === 'explore'))) return undefined
  const pick: Pick = mode !== 'prudent' && type === 'Explore' ? { model: 'haiku', effort: 'low' } : { model: 'sonnet' }
  const parent = rankOf(parentModel)
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

// Starts the spawn, on a cheaper model where routeFor picks one, and says where it was routed from. Without
// pennycrab, Explore under Fable runs on Opus, so that is what its savings are counted against.
export async function spawnRouted(
  $: EngineInterface,
  e: AgentSpawnInput,
  next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>,
  mode: RouterMode,
): Promise<{ started: AgentSpawnResult; route?: Route }> {
  const isPlain = e.model === undefined && !e.fork && !e.isTeammate && !e.workflow && !e.resume
  const pick = isPlain ? routeFor(mode, e.subagentType, e.parentModel) : undefined
  if (!pick || (await isOptedOut($))) return { started: await next(e) }
  const started = await next({ ...e, model: pick.model })
  const from = e.subagentType === 'Explore' && rankOf(e.parentModel) === RANK.fable ? 'opus' : e.parentModel
  return { started, route: { from, effort: pick.effort } }
}

// The spawn sets no effort, so a routed agent's requests carry it. Read from its row, which outlives a reload.
export async function withRoutedEffort($: EngineInterface, e: TurnStepInput): Promise<TurnStepInput> {
  if (e.agentId === undefined || e.effort === undefined) return e
  const effort = (await read($, agents)).find(a => a.id === e.agentId)?.effort
  return effort ? { ...e, effort } : e
}
