import { atom, read, update } from 'claude-code'
import type { EngineInterface, ToolCallResult, TurnStepChunk, TurnStepInput, TurnStepResult } from 'claude-code'

import type { Agent } from '../types'
import type { ForecastMode } from './forecast'
import { fmtTokens } from './ui'

// The state lib's scan reads an atom only where its reference is written, so each file declares the ones it uses.
const agents = atom({ plugin: 'pennycrab', key: 'agents' } as const, [])

export type Budget = '1' | '2' | '5' | '10' | '20' | '50' | 'off'
// The spend cap in USD, undefined when off; and what the forecast does.
export type Limits = { budgetUsd: number | undefined; forecast: ForecastMode }
type Trip = NonNullable<Agent['trip']>

// The most one subagent may spend, in USD; undefined when the cap is off, as it is unless the person sets one:
// the forecast is what catches a run gone wrong.
export function budgetOf(option: Budget | undefined): number | undefined {
  const b = option ?? 'off'
  return b === 'off' ? undefined : Number(b)
}

// The one tool that delivers a subagent's report to the session that started it: never refused, never counted.
export const HANDBACK = 'SubagentHandback'
// Requests a handed-over subagent still gets: one to read the refusals and hand back, one to spare.
const WRAP_STEPS = 2
// The same call with the same result, in a row: a nudge at the third, a handover at the fifth.
const LOOP_NUDGE = 3
const LOOP_STOP = 5
// Steps each handed-over subagent took since, and each subagent's last call and its repeats; the module's own,
// so a reload starts them over.
const wrapping = new Map<string, number>()
const repeats = new Map<string, { call: string; n: number }>()

// Why the guard stops this subagent now, or undefined while it may run on: its spend past the cap (a Haiku
// subagent past its 100K long-prompt line still costs less than on any other model, so that line stops nothing),
// or, with the forecast on, its tokens past twice what runs like it take.
export function tripOf(a: Agent, limits: Limits): Trip | undefined {
  if (limits.budgetUsd !== undefined && a.costUsd >= limits.budgetUsd) return 'budget'
  if (limits.forecast === 'on' && a.forecast !== undefined && a.tokens >= 2 * a.forecast) return 'forecast'
  return undefined
}

function reasonOf(a: Agent, limits: Limits) {
  if (a.trip === 'loop') return `it made the same tool call with the same result ${LOOP_STOP} times in a row`
  if (a.trip === 'forecast') return `it used ${fmtTokens(a.tokens)} tokens, past twice its forecast of ${fmtTokens(a.forecast ?? 0)}`
  return limits.budgetUsd === undefined ? 'it reached its budget' : `it reached its $${limits.budgetUsd.toFixed(2)} budget`
}

async function rowOf($: EngineInterface, agentId: string) {
  return (await read($, agents)).find(x => x.id === agentId)
}

async function handOver($: EngineInterface, a: Agent, trip: Trip, limits: Limits) {
  wrapping.set(a.id, 0)
  await update($, agents, list => list.map(x => (x.id === a.id ? { ...x, status: 'handover' as const, trip, currentTool: undefined } : x)))
  $.ui.toast(`Pennycrab handed over "${a.description || a.type}": ${reasonOf({ ...a, trip }, limits)}.`)
}

async function handedOver($: EngineInterface, agentId: string) {
  const a = await rowOf($, agentId)
  return a?.status === 'handover' ? a : undefined
}

// After each of a subagent's steps that asks for tools: past a line, it is handed over, and the person is told
// why. A step that answers ends the run by itself, so crossing a line there stops nothing.
export async function guardStep($: EngineInterface, agentId: string | undefined, limits: Limits, goesOn: boolean) {
  if (agentId === undefined || !goesOn) return
  const a = await rowOf($, agentId)
  // A resumed agent runs again: still past the line, it is handed over again.
  if (!a || a.status === 'handover') return
  const trip = tripOf(a, limits)
  if (trip) await handOver($, a, trip, limits)
}

// After each of a subagent's tool calls, a note it reads beside the result and the person never sees: once its
// tokens pass the forecast, and at the third same call with the same result. The fifth hands it over.
export async function afterTool($: EngineInterface, agentId: string, call: object, ran: ToolCallResult, limits: Limits): Promise<ToolCallResult> {
  if (limits.forecast === 'off' || ran.deny !== undefined || (call as { tool?: string }).tool === HANDBACK) return ran
  // A description is prose about the call, and a looping model often rewords it: it is no part of what repeats.
  const { tool_use_id: _id, agentId: _agent, requestMeta: _meta, consent: _consent, description: _about, ...args } = call as Record<string, unknown>
  const key = JSON.stringify([args, ran.text ?? ran.result])
  const n = repeats.get(agentId)?.call === key ? repeats.get(agentId)!.n + 1 : 1
  repeats.set(agentId, { call: key, n })
  const a = await rowOf($, agentId)
  if (!a || a.status === 'handover') return ran
  if (n >= LOOP_STOP && limits.forecast === 'on') {
    await handOver($, a, 'loop', limits)
    return ran
  }
  const notes: string[] = []
  if (n === LOOP_NUDGE)
    notes.push(`pennycrab: you have made this same call ${n} times in a row with the same result. Try another way, or answer from what you have found.`)
  if (a.forecast !== undefined && a.tokens >= a.forecast && !a.isNudged) {
    await update($, agents, list => list.map(x => (x.id === a.id ? { ...x, isNudged: true as const } : x)))
    notes.push(
      `pennycrab: this run has used ${fmtTokens(a.tokens)} tokens; runs like it usually finish within ${fmtTokens(Math.round(a.forecast / 1.5))}. Unless you are nearly done, wrap up in a few steps: answer from what you have found and say what you did not check.`,
    )
  }
  return notes.length ? ({ ...ran, context: [...(ran.context ?? []), ...notes] } as ToolCallResult) : ran
}

// Its turn ended: a resumed run is handed over afresh, with its own WRAP_STEPS, and its repeats start over.
export function forget(agentId: string) {
  wrapping.delete(agentId)
  repeats.delete(agentId)
}

// What a handed-over subagent reads in place of each tool's result, its hand-back alone let through. Its report
// opens with why, so the session that started it knows the work was cut short and can start a narrower one.
export async function denyOf($: EngineInterface, agentId: string, tool: string, limits: Limits) {
  if (tool === HANDBACK) return undefined
  const a = await handedOver($, agentId)
  if (!a) return undefined
  const why = reasonOf(a, limits)
  return `pennycrab stopped this subagent: ${why}. Call no other tool. Call ${HANDBACK} now with your report from what you have already found, and say what you could not check. Begin it with "Stopped by pennycrab: ${why}."`
}

// A handed-over subagent that keeps calling tools gets WRAP_STEPS more requests; pennycrab hands back for it at
// the next one, which ends its turn.
export async function stopOf($: EngineInterface, agentId: string | undefined, limits: Limits) {
  if (agentId === undefined) return undefined
  const a = await handedOver($, agentId)
  if (!a) return undefined
  const n = (wrapping.get(a.id) ?? 0) + 1
  wrapping.set(a.id, n)
  if (n <= WRAP_STEPS) return undefined
  return `Stopped by pennycrab before a final answer: ${reasonOf(a, limits)}, and it kept calling tools after it was asked to wrap up.`
}

// A response no model wrote: the hand-back call with `text` as the report. A plain answer would not do: the engine
// takes a subagent's report from its hand-back alone, and asks again for one. Built chunks are taken at their word.
export async function* handBackAlone(e: TurnStepInput, text: string): AsyncGenerator<TurnStepChunk, TurnStepResult> {
  const input = { message: text }
  yield { kind: 'tool', index: 0, id: `pennycrab-${e.turnId}-${e.index}`, name: HANDBACK }
  yield { kind: 'input', index: 0, json: JSON.stringify(input) }
  yield { kind: 'stop', stopReason: 'tool_use', usage: null }
  return { turnId: e.turnId, index: e.index, answer: '', toolUses: [{ name: HANDBACK, input }], stopReason: 'tool_use', usage: null }
}
