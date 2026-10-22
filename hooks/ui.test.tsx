import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clip, crab, fmtTime, fmtTokens, fmtUsd } from './ui'

test('numbers read short', () => {
  expect([fmtUsd(0), fmtUsd(0.004), fmtUsd(1.184)]).toEqual(['$0.00', '<$0.01', '$1.18'])
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

// The test's hooks stand for the engine: a session on Opus, and one plain Explore spawn the router sends to Sonnet.
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
    routed: (await ui.findAll({ type: 'Text', text: /^  Sonnet · ↓ from Opus$/ })).length,
  }
  await ui.unmount()
  expect(found).toEqual({ svg: 0, row: 1, routed: 1 })
})

test('desktop: the pane draws its grid, header and one row as Svg, the band one more', async ($: Engine, on) => {
  await session($, on)
  const pane = await $.ui.mount({ plugin: 'pennycrab', surface: 'desktop', ...PANE })
  const paneSvg = (await pane.findAll({ type: 'Svg' })).length
  await pane.unmount()
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
