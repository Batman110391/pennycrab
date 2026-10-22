import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { Agent, Cache, Tier } from '../types'
import { NO_CACHE, NO_MAIN, NO_SAVINGS, UI_START } from './state'

export const PANE = 'pennycrab'
const TITLE = 'Pennycrab'

const agents = atom({ plugin: 'pennycrab', key: 'agents' } as const, [])
const main = atom({ plugin: 'pennycrab', key: 'main' } as const, NO_MAIN)
const savings = atom({ plugin: 'pennycrab', key: 'savings' } as const, NO_SAVINGS)
const ui = atom({ plugin: 'pennycrab', key: 'ui' } as const, UI_START)
const cache = atom({ plugin: 'pennycrab', key: 'cache' } as const, NO_CACHE)
// Drawings are redrawn when a value they read changes; on the desktop an invalidate never reaches the band.
const now = atom({ plugin: 'pennycrab', key: 'now' } as const, 0)

const COLOR: Record<Tier, string> = { haiku: '#639922', sonnet: '#378ADD', opus: '#D85A30', fable: '#7F77DD', other: '#888780' }
const NAME: Record<Tier, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable', other: 'Other' }
const WARN = '#BA7517'
const GOOD = '#3B6D11'
const BAD = '#A32D2D'
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif'
const GLYPH: Record<Agent['status'], string> = { running: '●', tool: '●', handover: '⚑', completed: '✓', failed: '✗', stopped: '✗' }

// --- numbers

export const fmtUsd = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`)
export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${n}`)
export function fmtTime(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}
const isLive = (a: Agent) => a.endedAt === undefined
const isGuarded = (a: Agent) => a.status === 'handover'
const ctxOf = (a: Agent) => (a.contextWindow ? Math.min(100, Math.round((a.contextTokens / a.contextWindow) * 100)) : 0)
const elapsed = (a: Agent, at: number) => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt
const tierOfName = (model: string): Tier => (['haiku', 'sonnet', 'opus', 'fable'] as const).find(t => model.includes(t)) ?? 'other'
const TRIP: Record<NonNullable<Agent['trip']>, string> = { budget: '⚑ over budget', 'haiku-context': '⚑ past 100K' }
const meta = (a: Agent) =>
  [isGuarded(a) && a.trip && TRIP[a.trip], a.effort, a.routedFrom && `↓ from ${NAME[tierOfName(a.routedFrom)]}`, a.currentTool && `▶ ${a.currentTool}`].filter(Boolean).join(' · ')

// --- desktop: one SVG per row, because the desktop lays sibling elements out on separate lines.

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
// Rough pixel width of UI text: wide scripts and emoji take a full em, the rest a bit over half.
const em = (ch: string) => (/[　-鿿가-힯＀-￯\u{1f300}-\u{1faff}]/u.test(ch) ? 1 : 0.58)
const widthOf = (s: string, size: number) => [...s].reduce((w, ch) => w + em(ch) * size, 0)
export function clip(s: string, size: number, maxW: number) {
  if (widthOf(s, size) <= maxW) return s
  let w = widthOf('…', size)
  let out = ''
  for (const ch of s) {
    w += em(ch) * size
    if (w > maxW) break
    out += ch
  }
  return `${out}…`
}

const STYLE = `<style>
.fg{fill:#2C2C2A}.dim{fill:#5F5E5A}.faint{fill:#888780}.track{fill:#E8E6DF}.card{fill:#F1EFE8}.rule{stroke:#E8E6DF}.dot{fill:#D3D1C7}
@media (prefers-color-scheme: dark){.fg{fill:#F1EFE8}.dim{fill:#B4B2A9}.faint{fill:#888780}.track{fill:#3A3A37}.card{fill:#2A2A28}.rule{stroke:#3A3A37}.dot{fill:#444441}}
.pulse{animation:pulse 1.2s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.run .bd{animation:bob .5s steps(1) infinite -.125s}.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.fast .bd,.fast .la{animation-duration:.25s}.fast .lb{animation-duration:.25s;animation-delay:-.125s}
.run .coin{transform-box:fill-box;transform-origin:center;animation:spin 1.6s ease-in-out infinite}
.run .lens{transform-box:fill-box;animation:sway 1s ease-in-out infinite}
.run .speed,.run .glint,.run .spark,.run .light{animation:blink 1s steps(1) infinite}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
@keyframes spin{50%{transform:scaleX(.25)}}@keyframes sway{50%{transform:translate(-1px,1px)}}@keyframes blink{50%{opacity:.15}}
@media (prefers-reduced-motion: reduce){.pulse,.run,.run *{animation:none!important}}
</style>`
const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${STYLE}${body}</svg>`
const label = (x: number, y: number, size: number, cls: string, s: string, more = '') =>
  `<text class="${cls}" x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-variant-numeric="tabular-nums"${more}>${esc(s)}</text>`

// Clawd, dressed for the part each model plays, on a 16×14 grid. A part names a group: bd (body and
// costume, which bob together), la and lb (the leg pairs, stepping in turn), or a prop with its own motion.
type Paint = (x: number, y: number, w: number, h: number, color: string, part?: string) => void
type Costume = Tier | 'guard'
const EYE = '#1F1E1D'
const GOLD = '#EF9F27'
const GOLD_DARK = '#BA7517'
const GOLD_LIGHT = '#FAC775'
const CLAY = '#D97757'
function clawd(f: Paint, c: string) {
  f(3, 5, 9, 7, c)
  f(2, 7, 1, 2, c)
  f(12, 7, 1, 2, c)
  f(4, 7, 1, 1, EYE)
  f(10, 7, 1, 1, EYE)
  f(3, 12, 1, 2, c, 'la')
  f(9, 12, 1, 2, c, 'la')
  f(5, 12, 1, 2, c, 'lb')
  f(11, 12, 1, 2, c, 'lb')
}
const COSTUMES: Record<Costume, (f: Paint) => void> = {
  // pennycrab itself, for a model it cannot name: Claude's clay, balancing a spinning penny.
  other: f => {
    clawd(f, CLAY)
    f(6, 1, 3, 1, GOLD_DARK, 'coin')
    f(5, 2, 5, 2, GOLD, 'coin')
    f(6, 4, 3, 1, GOLD_DARK, 'coin')
    f(6, 2, 1, 2, GOLD_LIGHT, 'coin')
  },
  // Haiku, the courier: cheap and quick, a cap and speed lines, legs at double pace.
  haiku: f => {
    clawd(f, COLOR.haiku)
    f(4, 3, 7, 1, '#27500A')
    f(4, 4, 10, 1, '#173404')
    f(7, 3, 1, 1, '#97C459')
    f(0, 9, 1, 1, '#97C459', 'speed')
    f(1, 10, 1, 1, '#97C459', 'speed')
    f(0, 11, 2, 1, '#97C459', 'speed')
  },
  // Sonnet, the explorer: a field hat and a magnifier that sweeps.
  sonnet: f => {
    clawd(f, COLOR.sonnet)
    f(5, 2, 5, 1, '#C9A66B')
    f(5, 3, 5, 1, '#854F0B')
    f(3, 4, 9, 1, '#B08850')
    f(14, 2, 1, 1, '#5F5E5A', 'lens')
    f(13, 3, 1, 1, '#5F5E5A', 'lens')
    f(15, 3, 1, 1, '#5F5E5A', 'lens')
    f(14, 4, 1, 1, '#5F5E5A', 'lens')
    f(14, 3, 1, 1, '#B5D4F4', 'lens')
    f(13, 5, 1, 2, '#854F0B', 'lens')
  },
  // Opus, the banker: the costly one, in a top hat, a glinting monocle and a bow tie.
  opus: f => {
    clawd(f, COLOR.opus)
    f(5, 0, 5, 3, '#2C2C2A')
    f(5, 3, 5, 1, GOLD)
    f(4, 4, 7, 1, '#2C2C2A')
    f(9, 6, 3, 1, GOLD)
    f(9, 8, 3, 1, GOLD)
    f(9, 7, 1, 1, GOLD)
    f(11, 7, 1, 1, GOLD)
    f(11, 6, 1, 1, '#FFFFFF', 'glint')
    f(5, 10, 2, 1, '#2C2C2A')
    f(8, 10, 2, 1, '#2C2C2A')
    f(7, 10, 1, 1, GOLD)
  },
  // Fable, the king: the strongest, crowned and caped, with twinkling stars.
  fable: f => {
    clawd(f, COLOR.fable)
    f(4, 1, 1, 1, GOLD)
    f(7, 1, 1, 1, GOLD)
    f(10, 1, 1, 1, GOLD)
    f(4, 2, 7, 2, GOLD)
    f(4, 4, 7, 1, GOLD_DARK)
    f(5, 3, 1, 1, '#E24B4A')
    f(7, 3, 1, 1, '#378ADD')
    f(9, 3, 1, 1, '#E24B4A')
    f(2, 9, 1, 3, '#3C3489')
    f(12, 9, 1, 3, '#3C3489')
    f(14, 0, 1, 3, GOLD_LIGHT, 'spark')
    f(13, 1, 3, 1, GOLD_LIGHT, 'spark')
    f(1, 3, 1, 1, GOLD_LIGHT, 'spark')
  },
  // The guard, for a subagent it is winding down: a helmet with a beacon and a shield.
  guard: f => {
    clawd(f, WARN)
    f(5, 2, 5, 1, '#444441')
    f(4, 3, 7, 1, '#5F5E5A')
    f(3, 4, 9, 1, '#444441')
    f(7, 1, 1, 1, '#E24B4A', 'light')
    f(0, 7, 2, 4, '#888780')
    f(0, 8, 2, 1, '#F1EFE8')
  },
}
const costumeOf = (a: Agent): Costume => (isGuarded(a) ? 'guard' : a.tier)

// One Clawd, 16 units wide and 14 tall before `scale`.
export function crab(x: number, y: number, costume: Costume, isWalking: boolean, scale: number) {
  const parts = new Map<string, string[]>([['bd', []], ['la', []], ['lb', []]])
  COSTUMES[costume]((px, py, w, h, color, part = 'bd') => {
    if (!parts.has(part)) parts.set(part, [])
    parts.get(part)!.push(`<rect x="${px}" y="${py}" width="${w}" height="${h}" fill="${color}"/>`)
  })
  const group = (part: string) => `<g class="${part}">${parts.get(part)!.join('')}</g>`
  const props = [...parts.keys()].filter(p => p !== 'bd' && p !== 'la' && p !== 'lb').map(group).join('')
  const motion = isWalking ? `run${costume === 'haiku' ? ' fast' : ''}` : ''
  return `<g transform="translate(${x} ${y}) scale(${scale})" shape-rendering="crispEdges"><g class="${motion}"><g class="bd">${parts.get('bd')!.join('')}${props}</g>${group('la')}${group('lb')}</g></g>`
}

// The pane's dotted paper: drawn behind everything, in pieces no taller than the engine accepts for one Svg.
const PAPER_MAX = 4096
const paper = (w: number, h: number) =>
  svg(w, h, `<defs><pattern id="paper" width="16" height="16" patternUnits="userSpaceOnUse"><circle class="dot" cx="8" cy="8" r="0.9"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#paper)"/>`)
const paperPieces = (h: number) => {
  const out: number[] = []
  for (let left = h; left > 0; left -= PAPER_MAX) out.push(Math.min(PAPER_MAX, left))
  return out
}

const HEAD_H = 46
function headSvg(w: number, cost: number, saved: number, mainPct: number) {
  const gap = 8
  const cw = (w - gap * 2) / 3
  const card = (i: number, name: string, value: string, fill?: string) => {
    const x = i * (cw + gap)
    return `<rect class="card" x="${x}" y="1" width="${cw}" height="42" rx="10"/>${label(x + 10, 17, 11, 'dim', name)}${label(x + 10, 35, 15, fill ? '' : 'fg', value, ` font-weight="600"${fill ? ` fill="${fill}"` : ''}`)}`
  }
  return svg(w, HEAD_H, card(0, 'Cost', `≈${fmtUsd(cost)}`) + card(1, 'Saved', fmtUsd(saved), GOOD) + card(2, 'Main context', `${mainPct}%`))
}

// Top right of a row: a pulsing dot while it works, a tick once done, a cross when it failed or stopped.
function mark(x: number, y: number, a: Agent, color: string) {
  if (a.status === 'running' || a.status === 'tool') return `<circle class="pulse" cx="${x}" cy="${y}" r="4" fill="${color}"/>`
  if (a.status === 'handover') return `<circle cx="${x}" cy="${y}" r="4" fill="${WARN}"/>`
  if (a.status === 'completed') return `<polyline points="${x - 5},${y} ${x - 1.5},${y + 3.5} ${x + 5},${y - 3.5}" fill="none" stroke="${GOOD}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  return `<g stroke="${BAD}" stroke-width="2" stroke-linecap="round"><line x1="${x - 4}" y1="${y - 4}" x2="${x + 4}" y2="${y + 4}"/><line x1="${x + 4}" y1="${y - 4}" x2="${x - 4}" y2="${y + 4}"/></g>`
}

const ROW_H = 66
function rowSvg(w: number, a: Agent, at: number) {
  const color = COLOR[a.tier]
  const x = 44
  const tw = w - x - 20
  const ctx = ctxOf(a)
  const info = meta(a)
  return svg(
    w,
    ROW_H,
    crab(2, 15, costumeOf(a), isLive(a), 2.4) +
      label(x, 18, 13, 'fg', clip(a.description || a.type, 13, tw), ' font-weight="600"') +
      `<text x="${x}" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${NAME[a.tier]}</tspan><tspan class="dim">${esc(info ? ` · ${clip(info, 11, tw - 50)}` : '')}</tspan></text>` +
      label(x + tw, 49, 11, 'dim', `ctx ${ctx}% · ${fmtTokens(a.contextTokens)}   ≈${fmtUsd(a.costUsd)}   ${fmtTime(elapsed(a, at))}`, ' text-anchor="end"') +
      `<rect class="track" x="${x}" y="55" width="${tw}" height="4" rx="2"/><rect x="${x}" y="55" width="${Math.round((tw * ctx) / 100)}" height="4" rx="2" fill="${isGuarded(a) ? WARN : color}"/>` +
      mark(w - 8, 15, a, color) +
      `<line class="rule" x1="0" y1="65.5" x2="${w}" y2="65.5"/>`,
  )
}

// Collapsed pane: one crab per subagent, running ones first, and the totals.
function shelfSvg(w: number, list: Agent[], cost: number, saved: number) {
  const room = Math.max(1, Math.floor((w - 180) / 36))
  const shown = [...list.filter(isLive), ...list.filter(a => !isLive(a))].slice(0, room)
  const rest = list.length - shown.length
  return svg(
    w,
    32,
    shown.map((a, i) => crab(i * 36, 2, costumeOf(a), isLive(a), 2)).join('') +
      (rest ? label(shown.length * 36 + 4, 21, 12, 'dim', `+${rest}`) : '') +
      label(w, 21, 12, 'dim', `≈${fmtUsd(cost)} · saved ${fmtUsd(saved)}`, ' text-anchor="end"'),
  )
}

// The band: crabs at work, how many, the main thread's context and the savings.
const BAND_H = 24
function bandSvg(w: number, live: Agent[], mainPct: number, saved: number) {
  const guarded = live.filter(isGuarded).length
  const text = `${live.length - guarded} running${guarded ? ` · ${guarded} handover` : ''}`
  const crabs = Math.min(live.length, 5)
  const tx = crabs * 27 + 6
  const right = saved > 0 ? `saved ${fmtUsd(saved)}` : ''
  const bx = Math.round(tx + widthOf(text, 13) + 18)
  const bw = Math.max(40, Math.round(w - bx - 44 - widthOf(right, 12) - 14))
  const mid = BAND_H / 2
  return svg(
    w,
    BAND_H,
    live.slice(0, crabs).map((a, i) => crab(i * 27, 1.5, costumeOf(a), true, 1.5)).join('') +
      label(tx, mid + 4.5, 13, 'fg', text, ' font-weight="500"') +
      `<rect class="track" x="${bx}" y="${mid - 3}" width="${bw}" height="6" rx="3"/><rect class="faint" x="${bx}" y="${mid - 3}" width="${Math.round((bw * mainPct) / 100)}" height="6" rx="3"/>` +
      label(bx + bw + 7, mid + 4.5, 12, 'dim', `${mainPct}%`) +
      (right ? label(w, mid + 4.5, 12, '', right, ` text-anchor="end" font-weight="500" fill="${GOOD}"`) : ''),
  )
}

// --- terminal: the same content as text.

const textBar = (pct: number, width: number) => {
  const full = Math.round((width * pct) / 100)
  return '█'.repeat(full) + '░'.repeat(Math.max(0, width - full))
}

// One line on the main thread's prompt cache: how long it stays warm, and what keeping it so cost.
const CACHE_TICK_MS = 15_000
export function cacheLine(c: Cache, at: number) {
  if (c.ttlMs === null || c.lastRequestAt === null) return undefined
  const left = c.lastRequestAt + c.ttlMs - at
  const state = c.isTurnOpen ? 'Cache in use' : left > 0 ? `Cache warm · ${Math.ceil(left / 60_000)}m left` : 'Cache expired'
  const pings = c.pings ? ` · ${c.pings} ping${c.pings === 1 ? '' : 's'} ≈${fmtUsd(c.pingUsd)}` : ''
  return state + pings
}
// The line's minutes move on while the person is away: until a tick after the entry lapses.
const isCacheCounting = (c: Cache, at: number) =>
  !c.isTurnOpen && c.ttlMs !== null && c.lastRequestAt !== null && at <= c.lastRequestAt + c.ttlMs + CACHE_TICK_MS

// --- what the hooks call

async function view($: EngineInterface) {
  const list = await read($, agents)
  const m = await read($, main)
  const s = await read($, savings)
  const u = await read($, ui)
  const c = await read($, cache)
  const at = Math.max(await read($, now), ...list.map(a => a.startedAt), c.lastRequestAt ?? 0, 0)
  const mainPct = m.contextWindow ? Math.round((m.contextTokens / m.contextWindow) * 100) : 0
  return { list, m, s, u, at, mainPct, cacheText: cacheLine(c, at) }
}

export async function renderPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const r = $.ui.resolve(e)
  const { Box, Text, Button } = r
  const { list, m, s, u, at, mainPct, cacheText } = await view($)
  const running = list.filter(a => isLive(a) && !isGuarded(a)).reverse()
  const guarded = list.filter(isGuarded).reverse()
  const done = list.filter(a => !isLive(a) && !isGuarded(a)).reverse()
  const summary = `≈${fmtUsd(m.costUsd)} · saved ${fmtUsd(s.usd)} · main ${mainPct}%`
  const collapse = (
    <Button key="collapse" plain label={u.isCompact ? 'Expand' : 'Collapse'} onPress={() => update($, ui, v => ({ ...v, isCompact: !v.isCompact }))} />
  )
  const finished = (
    <Button key="finished" plain label={`${u.isDoneOpen ? '▾' : '▸'} Finished · ${done.length}`} onPress={() => update($, ui, v => ({ ...v, isDoneOpen: !v.isDoneOpen }))} />
  )

  if (e.surface === 'desktop' && 'Svg' in r) {
    const { Svg } = r
    const w = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
    if (u.isCompact) {
      return (
        <Box flexDirection="column" gap={1}>
          <Svg source={shelfSvg(w, list, m.costUsd, s.usd)} alt={`${list.length} subagents, ${summary}`} width={w} height={32} />
          {collapse}
        </Box>
      )
    }
    const row = (a: Agent) => (
      <Svg key={a.id} source={rowSvg(w, a, at)} alt={`${a.description}: ${NAME[a.tier]}, ${a.status}, context ${ctxOf(a)}%`} width={w} height={ROW_H} />
    )
    // A Text or Button line is about 20px on the desktop: the paper counts 24 so it never ends short.
    const lines = 1 + Number(cacheText !== undefined) + Number(list.length === 0) + Number(running.length > 0) + Number(guarded.length > 0) + Number(done.length > 0)
    const rows = running.length + guarded.length + (u.isDoneOpen ? done.length : 0)
    return (
      <Box flexDirection="column">
        {paperPieces(HEAD_H + lines * 24 + rows * ROW_H).map((ph, i) => (
          <Svg key={`paper-${i}`} source={paper(w, ph)} alt="" width={w} height={ph} />
        ))}
        {/* Laid on top of the paper above it. */}
        <Box flexDirection="column" position="absolute" top={0} left={0} right={0}>
          <Svg source={headSvg(w, m.costUsd, s.usd, mainPct)} alt={summary} width={w} height={HEAD_H} />
          {collapse}
          {cacheText !== undefined && <Text dimColor>{cacheText}</Text>}
          {list.length === 0 && <Text dimColor>No subagents yet. They show up here as they start.</Text>}
          {running.length > 0 && <Text dimColor>{`Running · ${running.length}`}</Text>}
          {running.map(row)}
          {guarded.length > 0 && <Text dimColor>{`Guard · ${guarded.length}`}</Text>}
          {guarded.map(row)}
          {done.length > 0 && finished}
          {u.isDoneOpen && done.map(row)}
        </Box>
      </Box>
    )
  }

  const barW = Math.max(6, Math.min(20, (e.props.bodyColumns || 40) - 34))
  const row = (a: Agent) => (
    <Box key={a.id} flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={COLOR[a.tier]}>▣</Text>
        <Text bold wrap="truncate-end">{a.description || a.type}</Text>
        <Text color={isGuarded(a) ? WARN : a.status === 'completed' ? 'green' : a.status === 'failed' || a.status === 'stopped' ? 'red' : COLOR[a.tier]}>{GLYPH[a.status]}</Text>
      </Box>
      <Text dimColor wrap="truncate-end">{`  ${NAME[a.tier]}${meta(a) ? ` · ${meta(a)}` : ''}`}</Text>
      <Text wrap="truncate-end">
        {'  '}
        <Text color={isGuarded(a) ? WARN : COLOR[a.tier]}>{textBar(ctxOf(a), barW)}</Text>
        <Text dimColor>{` ctx ${ctxOf(a)}% · ${fmtTokens(a.contextTokens)} ≈${fmtUsd(a.costUsd)} ${fmtTime(elapsed(a, at))}`}</Text>
      </Text>
    </Box>
  )
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor>{summary}</Text>
        {collapse}
      </Box>
      {cacheText !== undefined && <Text dimColor>{cacheText}</Text>}
      {u.isCompact ? (
        <Text wrap="truncate-end">
          {list.map(a => (
            <Text key={a.id} color={COLOR[a.tier]}>{`${GLYPH[a.status]} `}</Text>
          ))}
        </Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {list.length === 0 && <Text dimColor>No subagents yet.</Text>}
          {running.length > 0 && <Text dimColor>{`Running · ${running.length}`}</Text>}
          {running.map(row)}
          {guarded.length > 0 && <Text dimColor>{`Guard · ${guarded.length}`}</Text>}
          {guarded.map(row)}
          {done.length > 0 && finished}
          {u.isDoneOpen && done.map(row)}
        </Box>
      )}
    </Box>
  )
}

// The band shows while subagents run; other mods' bands stay beneath it.
export async function renderBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, next: (e: RenderInput<'AbovePrompt'>) => Promise<RenderElement>) {
  const { list, s, u, mainPct } = await view($)
  const live = list.filter(isLive)
  if (live.length === 0 || u.isBandHidden || e.props.hasSurvey) return next(e)
  // The engine's own empty band ({ type: 'engine' }) must not end up inside ours: the desktop then drops the whole band.
  const drawn = await Promise.resolve(next(e)).catch(() => null)
  const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

  const r = $.ui.resolve(e)
  const { Box, Text, Button } = r
  const crew = <Button key="pennycrab-crew" plain label={`×${list.length}`} onPress={() => void togglePane($)} />
  const hide = <Button key="pennycrab-hide" plain role="dismiss" label="✕" onPress={() => update($, ui, v => ({ ...v, isBandHidden: true }))} />

  // The terminal also lists an Svg, which draws nothing there, so the surface is checked as well.
  if (e.surface !== 'terminal' && 'Svg' in r) {
    const { Svg } = r
    // A column is about 8px; the two buttons beside the drawing take the rest.
    const w = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 96))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg source={bandSvg(w, live, mainPct, s.usd)} alt={`${live.length} subagents running, main context ${mainPct}%, saved ${fmtUsd(s.usd)}`} width={w} height={BAND_H} />
          {crew}
          {hide}
        </Box>
        {below}
      </Box>
    )
  }

  const barW = Math.max(6, Math.min(20, (e.props.bodyColumns || 80) - 50))
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        <Text>
          {live.slice(0, 6).map(a => (
            <Text key={a.id} color={isGuarded(a) ? WARN : COLOR[a.tier]}>▣</Text>
          ))}
        </Text>
        <Text bold>{`${live.length} running`}</Text>
        <Text dimColor>{`main ${textBar(mainPct, barW)} ${mainPct}%`}</Text>
        {s.usd > 0 && <Text color="green">{`saved ${fmtUsd(s.usd)}`}</Text>}
        {crew}
        {hide}
      </Box>
      {below}
    </Box>
  )
}

// Up to two running subagents, then a count; the savings once nothing runs.
function statusLine(list: Agent[], saved: number, at: number) {
  const live = list.filter(isLive)
  if (live.length === 0) return saved > 0 ? `🦀 saved ${fmtUsd(saved)}` : undefined
  const shown = live.slice(-2).map(a => `🦀${NAME[a.tier][0]} ${ctxOf(a)}% ${fmtTime(elapsed(a, at))}`)
  return [...shown, ...(live.length > 2 ? [`+${live.length - 2}`] : [])].join(' · ')
}

let shownStatus: string | undefined
// Each second: while subagents run the clock the drawings read moves on, and the status line follows; while the
// cache counts down, every CACHE_TICK_MS.
export async function tick($: EngineInterface) {
  const list = await read($, agents)
  const at = await $.clock.now()
  const isCounting = isCacheCounting(await read($, cache), at) && at - (await read($, now)) >= CACHE_TICK_MS
  if (list.some(isLive) || isCounting) await update($, now, () => at)
  const line = statusLine(list, (await read($, savings)).usd, at)
  if (line !== shownStatus) $.ui.status((shownStatus = line))
}

// Opens the pane, or closes it when it is up; true when it ends up open.
export async function togglePane($: EngineInterface) {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

// A new subagent brings the band back. The first of a wave (none other running) opens the pane: closed
// during a wave, it stays closed until the next one.
export async function onSpawnUi($: EngineInterface) {
  const isNewWave = (await read($, agents)).filter(isLive).length === 1
  const at = await $.clock.now()
  await update($, now, () => at)
  await update($, ui, v => ({ ...v, isBandHidden: false }))
  // The pane is a nicety: a refused open must never reach the spawn.
  if (isNewWave) void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
}
