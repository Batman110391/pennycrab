import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clip, crab, fmtTime, fmtTokens, fmtUsd } from './ui'

test('numbers read short', () => {
  expect([fmtUsd(0), fmtUsd(0.004), fmtUsd(1.184)]).toEqual(['$0.00', '<$0.01', '$1.18'])
  expect([fmtUsd(-0.0202), fmtUsd(-0.004)]).toEqual(['−$0.02', '−<$0.01'])
  expect([fmtTokens(950), fmtTokens(46_200), fmtTokens(1_200_000)]).toEqual(['950', '46K', '1.2M'])
  expect([fmtTime(42_000), fmtTime(102_000), fmtTime(3_900_000)]).toEqual(['42s', '1m42s', '1h05m'])
})

test('long text is cut to its room with an ellipsis, short text is left alone', () => {
  expect(clip('Find the auth flow', 13, 400)).toBe('Find the auth flow')
  const cut = clip('Find every place the session token is refreshed and logged', 13, 120)
  expect(cut.endsWith('…') && cut.length < 25 && cut.length > 10).toBe(true)
  expect(clip('认证流程在哪里处理', 13, 60)).toBe('认证流程…')
})

test('each role wears its own costume, and only a working crab moves', () => {
  const props = { other: 'coin', haiku: 'speed', sonnet: 'lens', opus: 'glint', fable: 'spark', guard: 'light' } as const
  for (const [costume, prop] of Object.entries(props)) expect(crab(0, 0, costume as never, true, 2)).toContain(`class="${prop}"`)
  expect(crab(0, 0, 'haiku', true, 2)).toContain('class="run fast"')
  expect(crab(0, 0, 'opus', false, 2)).not.toContain('run')
})

// The test's hooks stand for the engine: a session on Opus, and one plain Explore spawn the router sends to Haiku.
async function session($: Engine, on: On) {
  mock.env(on, {})
  mock.clock(on, { now: Date.parse('2026-10-22T10:00:00Z') })
  on('agent.spawn', async (_$, e) => ({ model: e.model ?? e.parentModel, agentId: 'a1' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'Find the <auth> flow', subagentType: 'Explore', parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
}

const PANE = { component: 'Pane', requestId: 'pennycrab', props: { title: 'Pennycrab', isFocused: false, bodyColumns: 40, placement: 'dock' } as never } as const
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never } as const

test('terminal: the pane lists the routed subagent as text', async ($: Engine, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: 'pennycrab', surface: 'terminal', ...PANE })
  const found = {
    svg: (await ui.findAll({ type: 'Svg' })).length,
    row: (await ui.findAll({ type: 'Text', text: /^Find the <auth> flow$/ })).length,
    routed: (await ui.findAll({ type: 'Text', text: /^  Haiku · low · ↓ from Opus$/ })).length,
  }
  await ui.unmount()
  expect(found).toEqual({ svg: 0, row: 1, routed: 1 })
})

test('desktop: the pane draws its grid, header and one row as Svg, the band one more', async ($: Engine, on) => {
  await session($, on)
  const pane = await $.ui.mount({ plugin: 'pennycrab', surface: 'desktop', ...PANE })
  const svgs = await pane.findAll({ type: 'Svg' })
  const paneSvg = svgs.length
  const markup = svgs.map(e => String((e as { props?: { source?: unknown } }).props?.source)).join('')
  await pane.unmount()
  // The description reaches the markup escaped, and the row's figures stay apart once SVG folds its spaces.
  expect(markup).toContain('Find the &#60;auth&#62; flow')
  expect(markup).not.toContain('<auth>')
  expect(markup).toContain('ctx 0% · 0 · ≈$0.00 · 0s')
  const band = await $.ui.mount({ plugin: 'pennycrab', surface: 'desktop', ...BAND })
  const bandSvg = (await band.findAll({ type: 'Svg' })).length
  await band.unmount()
  expect({ paneSvg, bandSvg }).toEqual({ paneSvg: 3, bandSvg: 1 })
})

test('the band shows up once a subagent starts under a mounted band, prompt idle', async ($: Engine, on) => {
  mock.env(on, {})
  mock.clock(on, { now: Date.parse('2026-10-22T10:00:00Z') })
  on('agent.spawn', async (_$, e) => ({ model: e.model ?? e.parentModel, agentId: 'a1' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  // Stands for the engine's own band, which draws an empty row when no plugin draws.
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  const idle = { ...BAND, props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never }
  const band = await $.ui.mount({ plugin: 'pennycrab', surface: 'desktop', ...idle })
  const before = (await band.findAll({ type: 'Svg' })).length
  await $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'Long look', subagentType: 'Explore', parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  const after = (await band.findAll({ type: 'Svg' })).length
  await band.unmount()
  expect({ before, after }).toEqual({ before: 0, after: 1 })
})

test('the pane opens once per wave of subagents, not on every spawn', async ($: Engine, on) => {
  let opened = 0
  let n = 0
  mock.env(on, {})
  mock.clock(on, { now: Date.parse('2026-10-22T10:00:00Z') })
  on('agent.spawn', async (_$, e) => ({ model: e.model ?? e.parentModel, agentId: `a${++n}` }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => {
    opened++
    return { value: { isPlaced: true } } as never
  })
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  const spawn = (description: string) =>
    $.agent.spawn({ tool_use_id: description, prompt: 'p', description, subagentType: 'Explore', parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  await spawn('One')
  await spawn('Two')
  expect(opened).toBe(1)
})

test('the status line counts a running subagent each second, then clears once it ends with nothing saved', async ($: Engine, on) => {
  const lines: (string | undefined)[] = []
  const clock = mock.clock(on, { now: Date.parse('2026-10-22T10:00:00Z') })
  mock.env(on, { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-5-5' })
  on('agent.spawn', async (_$, e) => ({ model: e.model ?? 'claude-sonnet-5-5', agentId: 'a1' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.status', async (_$, e) => {
    lines.push(e.text)
    return { value: undefined } as never
  })
  on('turn.complete', async () => ({ text: '' }))
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'Look', subagentType: 'Explore', parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  await clock.advance(3000)
  await $.turn.complete({ reason: 'answer', answer: 'found it', durationMs: 3000, isAborted: false, turnId: 'x', agentId: 'a1' })
  await clock.advance(1000)
  // A set CLAUDE_CODE_SUBAGENT_MODEL keeps the router out: the row is Sonnet's, and nothing was saved.
  expect(lines).toEqual(['🦀S 0% 1s', '🦀S 0% 2s', '🦀S 0% 3s', undefined])
})

test('the status line marks a model pennycrab cannot name with ?, not the O of Opus', async ($: Engine, on) => {
  const lines: (string | undefined)[] = []
  const clock = mock.clock(on, { now: Date.parse('2026-10-22T10:00:00Z') })
  mock.env(on, { CLAUDE_CODE_SUBAGENT_MODEL: 'mystery-model' })
  on('agent.spawn', async () => ({ model: 'mystery-model', agentId: 'a1' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.status', async (_$, e) => {
    lines.push(e.text)
    return { value: undefined } as never
  })
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'Look', subagentType: 'Explore', parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  await clock.advance(1000)
  expect(lines).toEqual(['🦀? 0% 1s'])
})

test('a subagent running a tool shows it on its row, then goes back to running', async ($: Engine, on) => {
  let release = () => {}
  const held = new Promise<void>(r => (release = r))
  let entered = () => {}
  const isEntered = new Promise<void>(r => (entered = r))
  let isInside = false
  on('tool.call', async () => {
    isInside = true
    entered()
    await held
    return { result: 'ok' } as never
  })
  await session($, on)
  const call = $.tool.call({ tool: 'Read', file_path: 'src/auth.ts', agentId: 'a1' })
  await isEntered
  const during = await $.ui.mount({ plugin: 'pennycrab', surface: 'terminal', ...PANE })
  const busy = (await during.findAll({ type: 'Text', text: /▶ Read/ })).length
  await during.unmount()
  release()
  await call
  const after = await $.ui.mount({ plugin: 'pennycrab', surface: 'terminal', ...PANE })
  const idle = (await after.findAll({ type: 'Text', text: /▶ Read/ })).length
  await after.unmount()
  expect({ isInside, busy, idle }).toEqual({ isInside: true, busy: 1, idle: 0 })
})

// The test's hooks stand for the engine: subagents a1, a2, ... of an Opus session, the pane's opens counted, the
// panes the engine lists as given.
function crew(on: On, panes: { id: string; isPlaced: boolean }[] = []) {
  const sent = { opened: 0, efforts: [] as unknown[] }
  let n = 0
  mock.env(on, {})
  const clock = mock.clock(on, { now: Date.parse('2026-10-22T10:00:00Z') })
  on('agent.spawn', async (_$, e) => ({ model: e.model ?? e.parentModel, agentId: `a${++n}` }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.open', async () => {
    sent.opened++
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', async () => ({ value: undefined }) as never)
  on('ui.panes', async () => ({ value: panes }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [] } }) as never)
  on('turn.complete', async () => ({ text: '' }))
  on('turn.step', async function* (_$, e) {
    sent.efforts.push(e.effort)
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer: 'done', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return { sent, clock }
}
const begin = ($: Engine, surface = 'desktop') => $.session.start({ source: 'startup', cwd: '/repo', surface, isInteractive: true } as never)
const spawnOne = ($: Engine, description: string) =>
  $.agent.spawn({ tool_use_id: description, prompt: 'p', description, subagentType: 'Explore', parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
const end = ($: Engine, agentId: string) => $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'x', agentId })

test('subagents started together open the pane once, and the next wave once more', async ($: Engine, on) => {
  const { sent } = crew(on)
  await begin($)
  await Promise.all([spawnOne($, 'One'), spawnOne($, 'Two'), spawnOne($, 'Three')])
  const first = sent.opened
  for (const id of ['a1', 'a2', 'a3']) await end($, id)
  await Promise.all([spawnOne($, 'Four'), spawnOne($, 'Five')])
  expect({ first, both: sent.opened }).toEqual({ first: 1, both: 2 })
})

test('on the terminal\'s main screen a wave does not open the pane unasked: it would land inline over the band', async ($: Engine, on) => {
  const { sent } = crew(on)
  // Stands for the engine's own band, drawn while no subagent runs.
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await begin($, 'terminal')
  const band = await $.ui.mount({ plugin: 'pennycrab', surface: 'terminal', ...BAND, viewport: { columns: 160, rows: 40, isFullscreen: false } })
  await spawnOne($, 'One')
  await band.unmount()
  expect(sent.opened).toBe(0)
})

test('/pennycrab shows a pane that was opened unasked and waits undrawn, rather than closing it', async ($: Engine, on) => {
  const { sent } = crew(on, [{ id: 'pennycrab', isPlaced: false }])
  await begin($)
  const r = await $.command.run({ command: 'pennycrab', args: '' } as never)
  expect({ text: (r as { text?: string }).text, opened: sent.opened }).toEqual({ text: 'Pennycrab pane opened.', opened: 1 })
})

test('the band counts running subagents only: finished ones are not on its button', async ($: Engine, on) => {
  crew(on)
  await begin($, 'terminal')
  for (const d of ['One', 'Two', 'Three']) await spawnOne($, d)
  await end($, 'a1')
  await end($, 'a2')
  const band = await $.ui.mount({ plugin: 'pennycrab', surface: 'terminal', ...BAND })
  const texts = (await band.findAll({ type: 'Text' })).map(t => (t as { text?: string }).text ?? '')
  const buttons = (await band.findAll({ type: 'Button' })).map(b => String((b as { props?: { label?: unknown } }).props?.label))
  await band.unmount()
  expect(texts).toContain('1 running')
  expect(buttons).toContain('×1')
})

test('the band is not drawn again each second: it shows nothing that moves with time', async ($: Engine, on) => {
  const { clock } = crew(on)
  let below = 0
  on('ui.render', async ($, e) => {
    below++
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await begin($)
  await spawnOne($, 'One')
  const band = await $.ui.mount({ plugin: 'pennycrab', surface: 'desktop', ...BAND })
  const before = below
  await clock.advance(5000)
  await band.unmount()
  expect(below - before).toBe(0)
})

test('a routed Explore\'s requests go out at low effort, read from its row', async ($: Engine, on) => {
  const { sent } = crew(on)
  await begin($)
  await spawnOne($, 'One')
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'a1', effort: 'high' })
  for (;;) if ((await stream.next()).done) break
  expect(sent.efforts).toEqual(['low'])
})
