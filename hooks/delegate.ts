import { atom, read } from 'claude-code'
import type { EngineInterface, PromptComposeInput, PromptComposeResult, ToolCallResult, ToolDescribeInput, ToolDescribeResult } from 'claude-code'

import { isOptedOut, routeFor } from './router'
import type { RouterMode } from './router'
import { NO_MAIN } from './state'

const main = atom({ plugin: 'pennycrab', key: 'main' } as const, NO_MAIN)

// What the main model is told about subagents. Without it, it believes a subagent costs what it costs, and on the Pro
// plan the engine tells it to spawn none: the router then has nothing to move.
export const delegateOf = (o: unknown) => o !== 'off'

export const RULE = `# Subagents under pennycrab

pennycrab runs Explore subagents on Haiku at low effort. On the user's plan limit Haiku weighs about 1/40 of your own reading of the same text, and what Explore reads never enters your context: here, reading files yourself is the expensive path.

The rule: when you start investigating an area of code you have not read yet (a bug, a flow, where something is done, what uses a symbol), send that first exploration to one Explore subagent before opening files yourself. You will not know in advance how many files it takes; that is why the rule is about starting, not counting. A brief that works: "Find where <X> happens and what calls it. Answer with file:line, at most 10 lines." Then open only the lines you will change or quote.

This holds while you investigate, even when the task ends in a code change. Do it yourself only when you write or edit code in files you have already read, when one or two files you already know answer it, or when the answer is in data, logs or command output rather than in the code.

pennycrab counts the files you read by hand in a turn and reminds you at the third.`

// The engine's line for the Pro plan. Its reason, a spawn re-deriving context at your price, does not hold for an
// Explore that pennycrab moves to Haiku, so it keeps it for code alone.
const PRO_LINE = /\*\*Do not spawn agents unless the user asks\.\*\*[\s\S]*?names one of the available agent types\./
const CODE_ONLY =
  "**Do not spawn agents to write or change code unless the user asks.** Each such spawn starts cold and re-derives context you already have — it's the expensive path on this plan. A wide read-only search is the one exception, when your instructions carry pennycrab's rule on subagents."

// The rule holds only while Explore really runs on Haiku: the router moves it, from this main model, unopposed.
async function isLive($: EngineInterface, model: string, mode: RouterMode, isOn: boolean) {
  return isOn && routeFor(mode, 'Explore', model)?.model === 'haiku' && !(await isOptedOut($))
}

export async function composeRule(
  $: EngineInterface,
  e: PromptComposeInput,
  next: (e: PromptComposeInput) => Promise<PromptComposeResult>,
  mode: RouterMode,
  isOn: boolean,
): Promise<PromptComposeResult> {
  const composed = await next(e)
  if (!(await isLive($, e.model, mode, isOn))) return composed
  return { ...composed, sections: [...composed.sections, { id: 'pennycrab:subagents', text: RULE, scope: 'session' }] }
}

export async function describeAgent(
  $: EngineInterface,
  e: ToolDescribeInput,
  next: (e: ToolDescribeInput) => Promise<ToolDescribeResult>,
  mode: RouterMode,
  isOn: boolean,
): Promise<ToolDescribeResult> {
  const described = await next(e)
  if (!isOn || (mode !== 'auto' && mode !== 'explore') || (await isOptedOut($))) return described
  return { ...described, description: described.description.replace(PRO_LINE, CODE_ONLY) }
}

// The files the main thread read by hand in its current turn. Module state: a reload starts the count over.
const handRead = new Set<string>()
let isReminded = false

export function onMainTurn() {
  handRead.clear()
  isReminded = false
}

// shortcut: a Bash read is a plain cat/head/tail/nl/less, or sed -n with one range, of one path; pipes, globs and
// head -n N pass unseen. Read them from the shell's own parse if the count misses too many.
const BASH_READ = /^\s*(?:cat|head|tail|nl|less|sed\s+-n\s+\S+)(?:\s+-\S+)*\s+([^\s|;&<>]+)\s*$/
const readOf = (c: Record<string, unknown>) =>
  c.tool === 'Read' ? String(c.file_path) : c.tool === 'Bash' ? BASH_READ.exec(String(c.command ?? ''))?.[1] : undefined

// After each main-thread tool call: at the third file read by hand in a turn, one reminder beside the result, which
// the model reads before its next step. A turn that already sent an Explore gets none.
export async function remindMain($: EngineInterface, call: object, ran: ToolCallResult, mode: RouterMode, isOn: boolean): Promise<ToolCallResult> {
  const c = call as Record<string, unknown>
  if (c.tool === 'Agent' && c.subagent_type === 'Explore') isReminded = true
  const path = readOf(c)
  if (isReminded || ran.deny !== undefined || path === undefined) return ran
  handRead.add(path)
  // The model is read only now: the first step's tools can run before that step tells pennycrab the session's model.
  if (handRead.size < 3 || !(await isLive($, (await read($, main)).model, mode, isOn))) return ran
  isReminded = true
  const note = `pennycrab: you have read ${handRead.size} files by hand in this turn. Send the next search to Explore, on Haiku: "Find where <X> happens and what calls it. Answer with file:line, at most 10 lines."`
  return { ...ran, context: [...(ran.context ?? []), note] } as ToolCallResult
}
