import type { EngineInterface, PromptComposeInput, PromptComposeResult, ToolDescribeInput, ToolDescribeResult } from 'claude-code'

import { isOptedOut, routeFor } from './router'
import type { RouterMode } from './router'

// What the main model is told about subagents. Without it, it believes a subagent costs what it costs, and on the Pro
// plan the engine tells it to spawn none: the router then has nothing to move.
export const delegateOf = (o: unknown) => o !== 'off'

export const RULE = `# Subagents under pennycrab

pennycrab runs Explore subagents on Haiku at low effort. On the user's plan limit Haiku weighs a small fraction of your own reading of the same text (about 1/40 at list price), and what Explore reads never enters your context.

Hand a question to Explore when answering it means finding or reading many files: where something is done, how a flow runs across modules, what uses a symbol. Ask for a short report with file:line references, and check the claims your next step depends on before acting on them: Haiku is fast and less careful.

Do it yourself when the file is known, the lookup is narrow (one search, one or two files), or the work changes code.`

// The engine's line for the Pro plan. Its reason, a spawn re-deriving context at your price, does not hold for an
// Explore that pennycrab moves to Haiku, so it keeps it for code alone.
const PRO_LINE = /\*\*Do not spawn agents unless the user asks\.\*\*[\s\S]*?names one of the available agent types\./
const CODE_ONLY =
  "**Do not spawn agents to write or change code unless the user asks.** Each such spawn starts cold and re-derives context you already have — it's the expensive path on this plan. A wide read-only search is the one exception, when your instructions carry pennycrab's rule on subagents."

// The rule goes in only while Explore really runs on Haiku: the router moves it, from this main model, unopposed.
export async function composeRule(
  $: EngineInterface,
  e: PromptComposeInput,
  next: (e: PromptComposeInput) => Promise<PromptComposeResult>,
  mode: RouterMode,
  isOn: boolean,
): Promise<PromptComposeResult> {
  const composed = await next(e)
  if (!isOn || routeFor(mode, 'Explore', e.model)?.model !== 'haiku' || (await isOptedOut($))) return composed
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
