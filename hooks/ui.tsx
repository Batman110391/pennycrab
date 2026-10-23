import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { Agent, Cache, Main, Tier } from '../types'
import { priceBook, tierOf } from './prices'
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
// The status line's one letter: Other's own initial would read as Opus.
const LETTER: Record<Tier, string> = { haiku: 'H', sonnet: 'S', opus: 'O', fable: 'F', other: '?' }
const WARN = '#BA7517'
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif'
const GLYPH: Record<Agent['status'], string> = { running: '●', tool: '●', handover: '⚑', completed: '✓', failed: '✗', stopped: '✗' }

// --- numbers

// A loss reads with its sign first: −$0.02.
export const fmtUsd = (n: number): string => (n < 0 ? `−${fmtUsd(-n)}` : n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`)
// A figure priced from the pricing page; '?' while no prices were ever fetched. The session's own cost comes
// from the engine and needs none.
const fmtPriced = (n: number) => (priceBook() ? fmtUsd(n) : '?')
// A row's cost; '?' once a request of it ran on a model the page does not list.
const fmtCost = (a: Agent) => (a.isUnpriced ? '?' : fmtUsd(a.costUsd))
// About an amount; "<$0.01" and "?" already say they are not exact.
const approx = (s: string) => (/^[<?]/.test(s) ? s : `≈${s}`)
export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${n}`)
export function fmtTime(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}
const isLive = (a: Agent) => a.endedAt === undefined
// Still winding down under the guard; once it ends it is finished, its trip kept on its row.
const isGuarded = (a: Agent) => a.status === 'handover' && isLive(a)
const ctxOf = (a: Agent) => (a.contextWindow ? Math.min(100, Math.round((a.contextTokens / a.contextWindow) * 100)) : 0)
const elapsed = (a: Agent, at: number) => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt
const TRIP: Record<NonNullable<Agent['trip']>, string> = { budget: '⚑ over budget', forecast: '⚑ over forecast', loop: '⚑ loop' }
const tripLabel = (a: Agent) => (a.trip ? TRIP[a.trip] : undefined)
// The run's tokens, against its forecast when it has one.
const tokOf = (a: Agent) => `${fmtTokens(a.tokens ?? 0)}${a.forecast === undefined ? '' : ` / ${fmtTokens(a.forecast)}`} tok`
const meta = (a: Agent) =>
  [tripLabel(a), a.effort, a.routedFrom && `↓ from ${NAME[tierOf(a.routedFrom)]}`, a.currentTool && `▶ ${a.currentTool}`].filter(Boolean).join(' · ')

// --- desktop: one SVG per row, because the desktop lays sibling elements out on separate lines.

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
// Rough pixel width of UI text: wide scripts and emoji take a full em, the rest a bit over half.
const em = (ch: string) => (/[　-鿿가-힯＀-￯\u{1f300}-\u{1faff}]/u.test(ch) ? 1 : 0.58)
const widthOf = (s: string, size: number) => [...s].reduce((w, ch) => w + em(ch) * size, 0)
// The first of the wordings that fits, else the last.
const fitOf = (ss: string[], size: number, maxW: number) => ss.find(x => widthOf(x, size) <= maxW) ?? ss[ss.length - 1]!
// Words in lines of at most maxW; past `max` lines the last one is clipped.
function wrap(s: string, size: number, maxW: number, max = 2) {
  const out: string[] = []
  let line = ''
  for (const word of s.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (!line || widthOf(next, size) <= maxW) line = next
    else {
      out.push(line)
      line = word
    }
  }
  out.push(line)
  return [...out.slice(0, max - 1), out.slice(max - 1).join(' ')].filter(Boolean).map(l => clip(l, size, maxW))
}
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
.fg{fill:#2C2C2A}.dim{fill:#5F5E5A}.faint{fill:#888780}.track{fill:#E8E6DF}.card{fill:#F6F5F0}.rule{stroke:#E8E6DF}.chip{fill:#2C2C2A;fill-opacity:.06}
.good{fill:#3B6D11}.bad{fill:#A32D2D}.warn{fill:#A0620C}.goodS{stroke:#3B6D11}.badS{stroke:#A32D2D}.ring{stroke:#5F5E5A}
@media (prefers-color-scheme: dark){.fg{fill:#F1EFE8}.dim{fill:#B4B2A9}.faint{fill:#8C8B85}.track{fill:#3A3A37}.card{fill:#262624}.rule{stroke:#3A3A37}.chip{fill:#F1EFE8;fill-opacity:.08}
.good{fill:#97C459}.bad{fill:#F09595}.warn{fill:#EF9F27}.goodS{stroke:#97C459}.badS{stroke:#F09595}.ring{stroke:#D3D1C7}}
.pulse{animation:pulse 1s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.run .bd{animation:bob .5s steps(1) infinite -.125s}.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.fast .bd,.fast .la{animation-duration:.25s}.fast .lb{animation-duration:.25s;animation-delay:-.125s}
.run .coin{transform-box:fill-box;transform-origin:center;animation:spin 1s ease-in-out infinite}
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
const costumeOf = (a: Agent): Costume => (a.trip ? 'guard' : a.tier)

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

const B = ' font-weight="700"'
const SB = ' font-weight="600"'
// The time a warm entry has left, as the ring's centre reads it.
const fmtLeft = (ms: number) => {
  const mins = Math.max(0, Math.ceil(ms / 60_000))
  return mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m` : `${mins}m`
}
// The cache as a ring that empties as the entry nears its lapse; nothing when the session caches nothing.
function ringOf(c: Cache, at: number, cx: number, cy: number) {
  if (c.ttlMs === null || c.lastRequestAt === null) return ''
  const r = 30
  const circ = 2 * Math.PI * r
  const left = c.lastRequestAt + c.ttlMs - at
  const base = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" class="rule" stroke-width="6"/>`
  const name = (s: string) => label(cx, cy + r + 18, 10.5, 'dim', s, `${SB} text-anchor="middle"`)
  const centre = (big: string, small: string) =>
    label(cx, cy + 2, 16, 'fg', big, `${B} text-anchor="middle"`) + label(cx, cy + 15, 9.5, 'dim', small, ' text-anchor="middle"')
  // A turn renews the entry as it goes: the whole lifetime starts over once it ends.
  if (c.isTurnOpen)
    return base + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" class="ring" stroke-width="6" stroke-dasharray="4 4"/>` + centre(fmtLeft(c.ttlMs), 'after turn') + name('Cache in use')
  if (left <= 0) return base + label(cx, cy + 5, 18, 'faint', '—', `${B} text-anchor="middle"`) + name('Cache expired')
  const arc = (circ * left) / c.ttlMs
  return (
    base +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" class="ring" stroke-width="6" stroke-linecap="round" stroke-dasharray="${arc.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>` +
    centre(fmtLeft(left), 'left') +
    name('Cache warm')
  )
}

// The pane's head: one big number for the savings, what was spent beside what it would have been, the cache ring
// and the main thread's context.
const HERO_H = 118
function heroSvg(w: number, cost: number, saved: number, c: Cache, at: number, mainPct: number) {
  const spent = approx(fmtUsd(cost))
  const would = priceBook() ? fmtUsd(cost + saved) : '?'
  const hasRing = c.ttlMs !== null && c.lastRequestAt !== null
  const room = w - (hasRing ? 124 : 32)
  const bx = 122
  const bw = Math.max(20, w - bx - (hasRing ? 124 : 16))
  return svg(
    w,
    HERO_H,
    `<rect class="card" x="0" y="0" width="${w}" height="${HERO_H}" rx="12"/>` +
      label(16, 26, 10, 'dim', 'SAVED THIS SESSION', SB) +
      label(16, 62, 34, saved > 0 ? 'good' : saved < 0 ? 'bad' : 'fg', fmtPriced(saved), B) +
      label(16, 82, 11, 'dim', clip(saved === 0 ? `spent ${spent}` : fitOf([`spent ${spent} · would have been ${would}`, `spent ${spent}, not ${would}`], 11, room), 11, room)) +
      label(16, 104, 10.5, 'dim', `Main context ${mainPct}%`) +
      `<rect class="track" x="${bx}" y="99" width="${bw}" height="5" rx="2.5"/><rect class="fg" fill-opacity=".55" x="${bx}" y="99" width="${Math.round((bw * mainPct) / 100)}" height="5" rx="2.5"/>` +
      (hasRing ? ringOf(c, at, w - 54, 50) : ''),
  )
}

// One faint line under the head: what the keep-warm cost, or what a subscription's dollars mean.
const NOTE_H = 20
// A note on one line, or two in a narrow pane.
function noteOf(w: number, s: string) {
  const lines = wrap(s, 10.5, w - 4)
  const height = NOTE_H + (lines.length - 1) * 14
  return { source: svg(w, height, lines.map((l, i) => label(2, 13 + i * 14, 10.5, 'faint', l)).join('')), height }
}
const pingNote = (c: Cache) =>
  c.pings ? `Kept warm while away: ${c.pings} ping${c.pings === 1 ? '' : 's'} ${approx(fmtPriced(c.pingUsd))}${c.savedUsd > 0 ? ` · saved ${fmtUsd(c.savedUsd)} of rewrites` : ''}` : undefined
// shortcut: a TTL set by a variable or setting hides the account, so no note then; add a field if that matters.
const isPlan = (c: Cache) => c.ttlSource === 'plan' || c.ttlSource === 'plan-over'
const PLAN_NOTE = 'ⓘ Subscription: dollars are list-price equivalents, counted against your usage limits.'

// What pennycrab does, while no subagent has started yet; its lines wrap in a narrow pane, so its height follows.
function emptyOf(w: number) {
  const isWide = w >= 420
  const x = isWide ? 100 : 16
  const items = ['Moves Explore and helper subagents to a cheaper model', 'Hands back a subagent that runs far past its forecast', 'Keeps the prompt cache warm while you are away']
  let y = 34
  let body = ''
  for (const l of wrap('Pennycrab is watching this session', 13, w - x - 12)) {
    body += label(x, y, 13, 'fg', l, B)
    y += 17
  }
  y += 7
  for (const item of items) {
    const lines = wrap(item, 11, w - x - 28)
    body += `<circle class="good" cx="${x + 6}" cy="${y - 4}" r="3"/>` + lines.map((l, i) => label(x + 16, y + i * 15, 11, 'dim', l)).join('')
    y += 15 * lines.length + 9
  }
  body += label(x, y + 4, 10.5, 'faint', clip('Subagents show up here as they start.', 10.5, w - x - 12))
  const height = Math.max(150, y + 20)
  return {
    source: svg(w, height, `<rect class="card" x="0" y="0" width="${w}" height="${height}" rx="12"/>` + (isWide ? crab(20, 34, 'other', true, 4) : '') + body),
    height,
  }
}

// A section's name and count over a hairline, with room above it so sections do not run together.
const SECTION_H = 34
const sectionSvg = (w: number, name: string, n: number) => {
  const s = `${name} · ${n}`
  const lx = Math.round(widthOf(s, 10.5) + 14)
  return svg(w, SECTION_H, label(2, 26, 10.5, 'dim', s, B) + `<line class="rule" x1="${lx}" y1="22" x2="${w}" y2="22" stroke-width="1"/>`)
}

// A light pill; tinted with `color` when it names a model or the guard.
const CHIP_H = 17
function chip(x: number, y: number, s: string, color?: string) {
  const cw = Math.round(widthOf(s, 10.5) + 12)
  const bg = color
    ? `<rect x="${x}" y="${y}" width="${cw}" height="${CHIP_H}" rx="8.5" fill="${color}" fill-opacity=".14"/>`
    : `<rect class="chip" x="${x}" y="${y}" width="${cw}" height="${CHIP_H}" rx="8.5"/>`
  const text = label(x + cw / 2, y + 12.5, 10.5, color ? '' : 'dim', s, `${SB} text-anchor="middle"${color ? ` fill="${color}"` : ''}`)
  return { markup: bg + text, width: cw }
}
const ENDED: Partial<Record<Agent['status'], string>> = { completed: '✓ done', failed: '✗ failed', stopped: '✗ stopped' }
const chipsOf = (a: Agent): [string, string?][] =>
  [
    a.trip ? ([tripLabel(a)!, WARN] as [string, string]) : undefined,
    [NAME[a.tier], COLOR[a.tier]] as [string, string],
    a.routedFrom ? [`↓ from ${NAME[tierOf(a.routedFrom)]}`] : undefined,
    a.effort ? [a.effort] : undefined,
    a.currentTool ? [`▶ ${a.currentTool}`] : undefined,
    !isLive(a) && !a.trip && ENDED[a.status] ? [ENDED[a.status]!] : undefined,
  ].filter((c): c is [string, string?] => c !== undefined)

// One subagent as a card: its crab, title and chips, its cost and figures on the right, its context bar.
const ROW_H = 70
function rowSvg(w: number, a: Agent, at: number) {
  const x = 52
  const tw = w - x - 14
  const ctx = ctxOf(a)
  const cost = `${approx(fmtCost(a))}`
  // The context shows as the bar beneath; the figures keep to what a chip cannot say.
  const figures = `${tokOf(a)} · ${fmtTime(elapsed(a, at))}`
  const chipsEnd = w - 14 - widthOf(figures, 10.5) - 10
  let cx = x
  let chips = ''
  for (const [s, color] of chipsOf(a)) {
    const c = chip(cx, 32, s, color)
    // The guard's reason comes first and always shows; a chip with no room makes way for a shorter one.
    if (cx + c.width > chipsEnd && cx > x) continue
    chips += c.markup
    cx += c.width + 5
  }
  return svg(
    w,
    ROW_H,
    `<rect class="card" x="0" y="2" width="${w}" height="${ROW_H - 4}" rx="10"/>` +
      crab(10, 18, costumeOf(a), isLive(a), 2.4) +
      label(x, 24, 13, 'fg', clip(a.description || a.type, 13, tw - widthOf(cost, 13) - 12), SB) +
      label(w - 14, 24, 13, a.isUnpriced ? 'faint' : 'fg', cost, `${B} text-anchor="end"`) +
      chips +
      label(w - 14, 45, 10.5, 'dim', figures, ' text-anchor="end"') +
      `<rect class="track" x="${x}" y="57" width="${tw}" height="4" rx="2"/><rect x="${x}" y="57" width="${Math.round((tw * ctx) / 100)}" height="4" rx="2" fill="${a.trip ? WARN : COLOR[a.tier]}"/>`,
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
      label(w, 21, 12, 'dim', `${approx(fmtUsd(cost))} · saved ${fmtPriced(saved)}`, ' text-anchor="end"'),
  )
}

// The band's crabs: those at work, or pennycrab's own with its penny while none is.
const CREW_H = 28
const crewSvg = (live: Agent[]) => {
  const shown = live.slice(0, 5)
  return svg(Math.max(1, shown.length) * 32, CREW_H, shown.length ? shown.map((a, i) => crab(i * 32, 0, costumeOf(a), true, 2)).join('') : crab(0, 0, 'other', false, 2))
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
  const mins = Math.ceil(left / 60_000)
  const leftText = mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m` : `${mins}m`
  const state = c.isTurnOpen ? 'Cache in use' : left > 0 ? `Cache warm · ${leftText} left` : 'Cache expired'
  const pings = c.pings ? ` · ${c.pings} ping${c.pings === 1 ? '' : 's'} ${approx(fmtPriced(c.pingUsd))}` : ''
  return state + pings
}
// The line's minutes move on while the person is away, every CACHE_TICK_MS, until the drawings' time `shown`
// reaches the entry's lapse, so that it ends on 'Cache expired' whenever the ticks land.
const isCacheCounting = (c: Cache, shown: number, at: number) => {
  if (c.isTurnOpen || c.ttlMs === null || c.lastRequestAt === null) return false
  const lapse = c.lastRequestAt + c.ttlMs
  return shown < lapse && (at - shown >= CACHE_TICK_MS || at >= lapse)
}

// --- what the hooks call

async function view($: EngineInterface) {
  const list = await read($, agents)
  const m = await read($, main)
  const s = await read($, savings)
  const u = await read($, ui)
  const c = await read($, cache)
  const at = Math.max(await read($, now), ...list.map(a => a.startedAt), c.lastRequestAt ?? 0, 0)
  return { list, m, s, u, c, at, mainPct: pctOf(m), cacheText: cacheLine(c, at) }
}
const pctOf = (m: Main) => (m.contextWindow ? Math.round((m.contextTokens / m.contextWindow) * 100) : 0)

export async function renderPane($: EngineInterface, e: RenderInput<'Pane'>) {
  noteViewport(e)
  const r = $.ui.resolve(e)
  const { Box, Text, Button } = r
  const { list, m, s, u, c, at, mainPct, cacheText } = await view($)
  const running = list.filter(a => isLive(a) && !isGuarded(a)).reverse()
  const guarded = list.filter(isGuarded).reverse()
  const done = list.filter(a => !isLive(a)).reverse()
  const summary = `${approx(fmtUsd(m.costUsd))} · saved ${fmtPriced(s.usd)} · main ${mainPct}%`
  const collapse = (
    <Button key="collapse" plain label={u.isCompact ? 'Expand' : 'Collapse'} onPress={() => update($, ui, v => ({ ...v, isCompact: !v.isCompact }))} />
  )
  const toggleDone = () => update($, ui, v => ({ ...v, isDoneOpen: !v.isDoneOpen }))
  const finished = <Button key="finished" plain label={`${u.isDoneOpen ? '▾' : '▸'} Finished · ${done.length}`} onPress={toggleDone} />

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
    const section = (name: string, n: number) => <Svg key={`section-${name}`} source={sectionSvg(w, name, n)} alt={`${name} ${n}`} width={w} height={SECTION_H} />
    const ping = pingNote(c)
    return (
      <Box flexDirection="column">
        <Svg source={heroSvg(w, m.costUsd, s.usd, c, at, mainPct)} alt={`${summary}${cacheText ? ` · ${cacheText}` : ''}`} width={w} height={HERO_H} />
        {ping !== undefined && <Svg key="ping" {...noteOf(w, ping)} alt={ping} width={w} />}
        {isPlan(c) && <Svg key="plan" {...noteOf(w, PLAN_NOTE)} alt={PLAN_NOTE} width={w} />}
        {collapse}
        {list.length === 0 && <Svg key="empty" {...emptyOf(w)} alt="No subagents yet. They show up here as they start." width={w} />}
        {running.length > 0 && section('WORKING', running.length)}
        {running.map(row)}
        {guarded.length > 0 && section('STOPPING · GUARD', guarded.length)}
        {guarded.map(row)}
        {done.length > 0 && section('FINISHED', done.length)}
        {done.length > 0 && <Button key="finished" plain label={u.isDoneOpen ? '▾ Hide' : '▸ Show'} onPress={toggleDone} />}
        {u.isDoneOpen && done.map(row)}
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
        <Text dimColor>{` ctx ${ctxOf(a)}% · ${tokOf(a)} · ${approx(fmtCost(a))} · ${fmtTime(elapsed(a, at))}`}</Text>
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

// What the person chose to see: the band always, while subagents work or never; the status line; the pane opening
// by itself. They are options, so a change reloads pennycrab with the new ones.
export type Display = { band: 'always' | 'working' | 'off'; isStatusLine: boolean; isAutoOpen: boolean }
export const displayOf = (o: Record<string, unknown>): Display => ({
  band: o.band === 'working' || o.band === 'off' ? o.band : 'always',
  isStatusLine: o.statusLine !== 'off',
  isAutoOpen: o.autoOpen !== 'off',
})

// The band above the prompt: crabs, who is working, what was spent and saved, and the Pane and Settings buttons on
// the same row. Other mods' bands stay beneath it. It draws nothing that moves with time, so it reads neither the
// clock nor the cache, and is not redrawn each second.
export async function renderBand(
  $: EngineInterface,
  e: RenderInput<'AbovePrompt'>,
  next: (e: RenderInput<'AbovePrompt'>) => Promise<RenderElement>,
  display: Display,
) {
  noteViewport(e)
  const list = await read($, agents)
  const m = await read($, main)
  const s = await read($, savings)
  const live = list.filter(isLive)
  if (display.band === 'off' || (display.band === 'working' && live.length === 0) || e.props.hasSurvey) return next(e)
  // The engine's own empty band ({ type: 'engine' }) must not end up inside ours: the desktop then drops the whole band.
  const drawn = await Promise.resolve(next(e)).catch(() => null)
  const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

  const r = $.ui.resolve(e)
  const { Box, Text, Button } = r
  const guarded = live.filter(isGuarded).length
  const saved = s.usd > 0 ? `saved ${fmtPriced(s.usd)}` : s.usd < 0 ? `saved ${fmtUsd(s.usd)}` : 'nothing saved yet'
  // The terminal also lists an Svg, which draws nothing there, so the surface is checked as well.
  const crabs =
    e.surface !== 'terminal' && 'Svg' in r ? (
      <r.Svg source={crewSvg(live)} alt={`${live.length} subagents`} width={Math.max(1, Math.min(live.length, 5)) * 32} height={CREW_H} />
    ) : (
      <Text>
        {live.length ? live.slice(0, 6).map(a => <Text key={a.id} color={isGuarded(a) ? WARN : COLOR[a.tier]}>▣</Text>) : '🦀'}
      </Text>
    )
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" alignItems="center" gap={2} width={e.props.bodyColumns}>
        {crabs}
        {live.length ? <Text bold>{`${live.length - guarded} working`}</Text> : <Text dimColor>pennycrab</Text>}
        {guarded > 0 && <Text color="warning">{`· ${guarded} stopped by the guard`}</Text>}
        <Box flexGrow={1} />
        {live.length > 0 && <Text dimColor>{`spent ${approx(fmtUsd(m.costUsd))}`}</Text>}
        <Text bold={s.usd > 0} color={s.usd > 0 ? 'success' : s.usd < 0 ? 'error' : undefined} dimColor={s.usd === 0}>
          {live.length || s.usd === 0 ? saved : `${saved} this session`}
        </Text>
        <Button key="pennycrab-pane" plain label="Pane" onPress={() => void togglePane($)} />
        <Button key="pennycrab-settings" plain label="⚙ Settings" onPress={() => void openSettings($)} />
      </Box>
      {below && <Box marginTop={1}>{below}</Box>}
    </Box>
  )
}

// --- settings: every option of pennycrab's, changed through the engine's /config rows.

export const SETTINGS = 'pennycrab-settings'
type Field = { field: string; section: string; name: string; def: string; hint: (v: string) => string; label?: (v: string) => string }
const FIELDS: Field[] = [
  {
    field: 'router',
    section: 'ROUTER',
    name: 'Which subagents move to a cheaper model',
    def: 'auto',
    hint: v =>
      ({
        auto: 'Explore runs on Haiku at low effort; general-purpose on Sonnet when you are on Opus or Fable.',
        explore: 'Explore, which only reads and searches, runs on Haiku at low effort. Subagents that write code keep your model.',
        prudent: 'Explore and general-purpose run on Sonnet when you are on Opus or Fable.',
        off: 'Every subagent runs on your model.',
      })[v] ?? '',
  },
  {
    field: 'forecast',
    section: 'GUARD',
    name: 'Token forecast',
    def: 'on',
    hint: v =>
      ({
        on: 'Past what runs like it usually take, a subagent is nudged to wrap up; past twice that, it hands back what it found. Same for the same call repeated with the same result. Learned from your runs, once there are ten of a kind.',
        nudge: 'The nudge only: a subagent past its forecast, or repeating itself, is asked to wrap up, never stopped.',
        off: 'No forecast and no nudge: only the budget, if set, stops a subagent.',
      })[v] ?? '',
  },
  {
    field: 'budget',
    section: 'GUARD',
    name: 'Budget per subagent',
    def: 'off',
    hint: v => (v === 'off' ? 'No spend cap: the forecast catches a run gone wrong.' : 'A cap on top of the forecast: past it, the subagent hands back what it found, then is stopped if it keeps going.'),
    label: v => (v === 'off' ? 'off' : `$${v}`),
  },
  {
    field: 'keepWarm',
    section: 'CACHE',
    name: 'Keep the prompt cache warm while you are away',
    def: 'auto',
    hint: v =>
      v === 'off'
        ? 'No pings: after the cache lapses, your next message writes it again.'
        : v === 'auto'
          ? 'A short ping before the cache lapses, while the pings cost less than the rewrite they spare, up to 8 hours.'
          : `A short ping before the cache lapses, for ${v} after your last message.`,
  },
  {
    field: 'band',
    section: 'DISPLAY',
    name: 'Bar above the prompt',
    def: 'always',
    hint: v => ({ always: 'The savings and the Settings button stay in reach.', working: 'Only while subagents run.', off: 'No bar: Settings is then /pennycrab settings.' })[v] ?? '',
    label: v => (v === 'working' ? 'while subagents work' : v),
  },
  { field: 'statusLine', section: 'DISPLAY', name: 'Status line', def: 'on', hint: () => "The crabs at work and their time, above Claude's own line." },
  { field: 'autoOpen', section: 'DISPLAY', name: 'Open the pane by itself', def: 'on', hint: () => 'When a wave of subagents starts, where the pane docks beside the chat.' },
]
// A row of ours: `<plugin>.<field>`, the plugin named as installed (pennycrab, or pennycrab@<marketplace>).
const fieldOf = (key: string) => (/^pennycrab(@[^.]*)?\./.test(key) ? key.slice(key.indexOf('.') + 1) : undefined)

export async function openSettings($: EngineInterface) {
  await $.ui.open({ id: SETTINGS, title: 'Pennycrab settings' })
}

async function setOption($: EngineInterface, key: string, value: string) {
  const { deny } = await $.config.set({ key, value })
  if (deny) $.ui.toast(`Pennycrab could not change it: ${deny}`)
}

export async function renderSettings($: EngineInterface, e: RenderInput<'Pane'>) {
  const r = $.ui.resolve(e)
  const { Box, Text, Button } = r
  const rows = new Map((await $.config.list()).flatMap(row => (fieldOf(row.key) ? [[fieldOf(row.key)!, row] as const] : [])))
  const shown = FIELDS.filter(f => rows.has(f.field))
  const sections = [...new Set(shown.map(f => f.section))]
  const reset = async () => {
    for (const f of shown) if (!rows.get(f.field)!.isLocked && String(rows.get(f.field)!.value) !== f.def) await setOption($, rows.get(f.field)!.key, f.def)
  }
  return (
    <Box flexDirection="column" gap={1}>
      {sections.map(section => (
        <Box key={section} flexDirection="column">
          <Text bold dimColor>{section}</Text>
          {shown
            .filter(f => f.section === section)
            .map(f => {
              const row = rows.get(f.field)!
              const value = String(row.value)
              const label = f.label ?? (v => v)
              return (
                <Box key={f.field} flexDirection="column" marginTop={1}>
                  {row.isLocked || !('Select' in r) ? (
                    <Text>
                      <Text bold>{f.name}</Text>
                      <Text dimColor>{`  ${row.isLocked ? '🔒 ' : ''}${label(value)}${row.isLocked ? ' · set by your organization' : ''}`}</Text>
                    </Text>
                  ) : (
                    // The name on its own line: beside a long one the menu runs past the pane's edge.
                    <Box flexDirection="column">
                      <Text bold>{f.name}</Text>
                      <r.Select
                      key={`pennycrab-${f.field}`}
                      value={value}
                      options={(row.options ?? [value]).map(v => ({ value: v, label: label(v) }))}
                      onSelect={v => void setOption($, row.key, v)}
                      />
                    </Box>
                  )}
                  <Text dimColor wrap="wrap">{f.hint(value)}</Text>
                </Box>
              )
            })}
        </Box>
      ))}
      <Text dimColor>Changes apply at once: pennycrab reloads with them.</Text>
      <Button key="pennycrab-reset" plain label="Reset to defaults" onPress={() => void reset()} />
    </Box>
  )
}

// Up to two running subagents, then a count; the savings once nothing runs.
function statusLine(list: Agent[], saved: number, at: number) {
  const live = list.filter(isLive)
  if (live.length === 0) return saved > 0 ? `🦀 saved ${fmtUsd(saved)}` : undefined
  const shown = live.slice(-2).map(a => `🦀${LETTER[a.tier]} ${ctxOf(a)}% ${fmtTime(elapsed(a, at))}`)
  return [...shown, ...(live.length > 2 ? [`+${live.length - 2}`] : [])].join(' · ')
}

let shownStatus: string | undefined
// Each second: while subagents run the clock the drawings read moves on, and the status line follows; while the
// cache counts down, every CACHE_TICK_MS.
export async function tick($: EngineInterface, display: Display) {
  const list = await read($, agents)
  const at = await $.clock.now()
  const isCounting = isCacheCounting(await read($, cache), await read($, now), at)
  if (list.some(isLive) || isCounting) await update($, now, () => at)
  const line = display.isStatusLine ? statusLine(list, (await read($, savings)).usd, at) : undefined
  if (line !== shownStatus) $.ui.status((shownStatus = line))
}

// Opens the pane, or closes it when it is drawn; true when it ends up open. One opened unasked that waits
// undrawn for room is opened again, now asked.
export async function togglePane($: EngineInterface) {
  if ((await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

// Whether each surface that drew may dock a pane beside the transcript: false where it said it places one inline
// above the prompt (the terminal's main screen), true where it said it docks or has not said. Unasked, the pane
// opens only where it would be a sidebar, not inline on top of the band that already shows the crabs.
const docks = new Map<string, boolean>()
function noteViewport(e: RenderInput<'Pane'> | RenderInput<'AbovePrompt'>) {
  docks.set(e.surface, e.viewport?.isFullscreen !== false)
}
const isSidebar = () => docks.size === 0 || [...docks.values()].some(Boolean)

// The first of a wave (`isFirst`: none other running) opens the pane:
// closed during a wave, it stays closed until the next one.
export async function onSpawnUi($: EngineInterface, isFirst: boolean, display: Display) {
  const at = await $.clock.now()
  await update($, now, () => at)
  // The pane is a nicety: a refused open must never reach the spawn.
  if (isFirst && display.isAutoOpen && isSidebar()) void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
}
