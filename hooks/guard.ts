import { atom, read, update } from 'claude-code'
import type { EngineInterface, TurnStepChunk, TurnStepInput, TurnStepResult } from 'claude-code'

import type { Agent } from '../types'
import { HAIKU_LONG_PROMPT } from './prices'

// The state lib's scan reads an atom only where its reference is written, so each file declares the ones it uses.
const agents = atom({ plugin: 'pennycrab', key: 'agents' } as const, [])

export type Budget = '0.50' | '1' | '2' | '5' | 'off'
type Trip = NonNullable<Agent['trip']>

// The most one subagent may spend, in USD; undefined when the guard is off.
export function budgetOf(option: Budget | undefined): number | undefined {
  const b = option ?? '2'
  return b === 'off' ? undefined : Number(b)
}

// Requests a handed-over subagent still gets: one to read the refusals and answer, one to spare.
const WRAP_STEPS = 2
// Steps each handed-over subagent took since; the module's own, so a reload grants them again.
const wrapping = new Map<string, number>()

// Why the guard stops this subagent now, or undefined while it may run on.
export function tripOf(a: Agent, budgetUsd: number): Trip | undefined {
  if (a.costUsd >= budgetUsd) return 'budget'
  // Its next request carries at least this context: past the line, Haiku bills it at the long-prompt rate.
  if (a.tier === 'haiku' && a.contextTokens > HAIKU_LONG_PROMPT) return 'haiku-context'
  return undefined
}

function reasonOf(trip: Trip, budgetUsd: number) {
  return trip === 'budget'
    ? `it reached its $${budgetUsd.toFixed(2)} budget`
    : `its context passed ${HAIKU_LONG_PROMPT / 1000}K tokens, where Haiku bills at its long-prompt rate`
}

async function handedOver($: EngineInterface, agentId: string) {
  const a = (await read($, agents)).find(x => x.id === agentId)
  return a?.status === 'handover' && a.trip !== undefined ? { ...a, trip: a.trip } : undefined
}

// After each of a subagent's steps: past a line, it is handed over, and the person is told why.
export async function guardStep($: EngineInterface, agentId: string | undefined, budgetUsd: number | undefined) {
  if (agentId === undefined || budgetUsd === undefined) return
  const a = (await read($, agents)).find(x => x.id === agentId)
  // A resumed agent runs again: still past the line, it is handed over again.
  if (!a || a.status === 'handover') return
  const trip = tripOf(a, budgetUsd)
  if (!trip) return
  wrapping.set(agentId, 0)
  await update($, agents, list => list.map(x => (x.id === agentId ? { ...x, status: 'handover', trip, currentTool: undefined } : x)))
  $.ui.toast(`Pennycrab handed over "${a.description || a.type}": ${reasonOf(trip, budgetUsd)}.`)
}

// Its turn ended: a resumed run is handed over afresh, with its own WRAP_STEPS.
export function forget(agentId: string) {
  wrapping.delete(agentId)
}

// What a handed-over subagent reads in place of each tool's result.
export async function denyOf($: EngineInterface, agentId: string, budgetUsd: number | undefined) {
  if (budgetUsd === undefined) return undefined
  const a = await handedOver($, agentId)
  if (!a) return undefined
  return `pennycrab stopped this subagent: ${reasonOf(a.trip, budgetUsd)}. Do not call any more tools. Write your final answer now from what you have already found, and say what you could not check.`
}

// A handed-over subagent that keeps calling tools gets WRAP_STEPS more requests; pennycrab answers the next
// one itself, which ends its turn.
export async function stopOf($: EngineInterface, agentId: string | undefined, budgetUsd: number | undefined) {
  if (agentId === undefined || budgetUsd === undefined) return undefined
  const a = await handedOver($, agentId)
  if (!a) return undefined
  const n =(wrapping.get(a.id) ?? 0) + 1
  wrapping.set(a.id, n)
  if (n <= WRAP_STEPS) return undefined
  return `Stopped by pennycrab before a final answer: ${reasonOf(a.trip, budgetUsd)}, and it kept calling tools after it was asked to wrap up.`
}

// A response no model wrote: the text alone, then the stop.
export async function* answerAlone(e: TurnStepInput, text: string): AsyncGenerator<TurnStepChunk, TurnStepResult> {
  yield { kind: 'text', index: 0, text }
  yield { kind: 'stop', stopReason: 'end_turn', usage: null }
  return { turnId: e.turnId, index: e.index, answer: text, toolUses: [], stopReason: 'end_turn', usage: null }
}
