import type { EngineInterface } from 'claude-code'

import type { Cache } from '../types'
import type { WarmPolicy } from './cache'
import type { RouterMode } from './router'

type Choice = { router: RouterMode; budgetUsd: number | undefined; warm: WarmPolicy | undefined }
const STORE_KEY = 'setup'

const hours = (ms: number) => (ms >= 3600_000 ? `${ms / 3600_000} h` : `${ms / 60_000} min`)

// What pennycrab chose for this account, in one line: the cache it found and how it keeps it warm, where the
// built-in subagents run, and the spend cap.
export function setupLine(c: Pick<Cache, 'ttlMs' | 'ttlSource'>, { router, budgetUsd, warm }: Choice) {
  const isHour = c.ttlMs !== null && c.ttlMs >= 3600_000
  const WHO: Record<Cache['ttlSource'], string> = {
    plan: 'your Claude subscription',
    'plan-over': 'your Claude subscription, past its limits',
    api: 'pay-per-token use',
    cloud: 'your cloud provider',
    env: 'your cache setting',
    setting: 'your cache setting',
    unknown: 'this session',
  }
  const who = WHO[c.ttlSource]
  const cache =
    c.ttlMs === null
      ? 'prompt caching is off'
      : !warm
        ? `${isHour ? '1-hour' : '5-minute'} cache, kept warm: off`
        : warm.isAuto
          ? isHour
            ? '1-hour cache, one ping an hour while you are away (up to 8 h)'
            : '5-minute cache, pings while you are away as long as they pay for themselves'
          : `${isHour ? '1-hour' : '5-minute'} cache, kept warm ${hours(warm.windowMs)} after your last turn`
  const route = router === 'auto' ? 'Explore on Haiku, general-purpose on Sonnet' : router === 'explore' ? 'Explore on Haiku, general-purpose on your model' : router === 'prudent' ? 'Explore and general-purpose on Sonnet' : 'router off'
  const cap = budgetUsd === undefined ? 'no spend cap' : `$${budgetUsd.toFixed(2)} cap per subagent`
  return `pennycrab is set for ${who}: ${cache} · ${route} · ${cap}. /plugin configure pennycrab to change it.`
}

// After a turn of the person's: the first time this choice applies (a new install, or the account, its cache or
// the options changed), one toast says it. The store remembers what was said.
export async function announceSetup($: EngineInterface, c: Pick<Cache, 'ttlMs' | 'ttlSource'>, choice: Choice) {
  const line = setupLine(c, choice)
  if ((await $.store.get(STORE_KEY).catch(() => undefined)) === line) return
  await $.store.set(STORE_KEY, line).catch(() => undefined)
  $.ui.toast(line, { timeoutMs: 12_000 })
}
