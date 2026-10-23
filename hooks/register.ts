import type { Register } from 'claude-code'

import { keepWarm, keepWarmOf, onMainStep, onMainTurnEnd, onMainTurnStart } from './cache'
import type { KeepWarm } from './cache'
import { forecastFor, forecastModeOf, keyOf, learn } from './forecast'
import { afterTool, budgetOf, denyOf, forget, guardStep, handBackAlone, stopOf } from './guard'
import type { Budget, Limits } from './guard'
import { loadStoredPrices, refreshPrices, tierOf } from './prices'
import { spawnRouted, withRoutedEffort } from './router'
import type { RouterMode } from './router'
import { announceSetup } from './setup'
import { addAgent, finish, recordStep, setTool } from './telemetry'
import { displayOf, onSpawnUi, openSettings, renderBand, renderPane, renderSettings, tick, togglePane, unitsOf, useUnits } from './ui'

// One hook per event (the engine takes no second unmatched one); each module adds its part here.
// Every hook fails open: on an error the engine's own behaviour goes on.
export const register: Register = (on, options) => {
  const mode = (options.router as RouterMode | undefined) ?? 'auto'
  const budgetUsd = budgetOf(options.budget as Budget | undefined)
  const limits: Limits = { budgetUsd, forecast: forecastModeOf(options.forecast) }
  // The project a run's history is kept under; session.start sets it again after a reload.
  let project = ''
  const warm = keepWarmOf(options.keepWarm as KeepWarm | undefined)
  const display = displayOf(options)
  useUnits(unitsOf(options.units))

  on('session.start', async ($, e, next) => {
    project = e.cwd
    await $.command.register({ name: 'pennycrab', description: 'Show or hide the pennycrab pane: your subagents, their models, context and cost. /pennycrab settings: its options' })
    await loadStoredPrices($)
    // The page again every ten minutes while the kept prices are a day old or missing (no network at the start).
    void refreshPrices($).catch(() => undefined)
    $.clock.every(10 * 60_000, () => void refreshPrices($).catch(() => undefined))
    $.clock.every(1000, () => {
      void tick($, display)
      void keepWarm($, warm).catch(() => undefined)
    })
    return next(e)
  })

  on('command.run', { command: 'pennycrab' }, async ($, e) => {
    if (e.args.trim() === 'settings') return { text: (await openSettings($), 'Pennycrab settings opened.') }
    return { text: (await togglePane($)) ? 'Pennycrab pane opened.' : 'Pennycrab pane closed.' }
  })

  on('ui.render', { component: 'Pane', requestId: 'pennycrab' }, ($, e) => renderPane($, e, display))
  on('ui.render', { component: 'Pane', requestId: 'pennycrab-settings' }, ($, e) => renderSettings($, e, options))

  // Nothing on screen says how a closed pane comes back, so the close says it.
  on('ui.close', ($, e, next) => {
    if (e.id === 'pennycrab' && e.origin.kind === 'person') $.ui.toast('Pennycrab closed. Type /pennycrab to bring it back.')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => renderBand($, e, next, display)).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const { started, route } = await spawnRouted($, e, next, mode)
    if (started.agentId !== undefined) {
      const key = keyOf(e.subagentType, tierOf(started.model), e.fork)
      const forecast = limits.forecast === 'off' || e.resume || e.isTeammate ? undefined : await forecastFor($, project, key)
      await onSpawnUi($, await addAgent($, e, started.agentId, started.model, route, { key, forecast }), display)
    }
    return started
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await onMainTurnStart($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const stop = await stopOf($, e.agentId, limits)
    if (stop !== undefined) return yield* handBackAlone(e, stop)
    // The main thread's cache entry lives from the request's start, not from the end of its reply.
    const sentAt = e.agentId === undefined ? await $.clock.now() : 0
    const result = yield* next(await withRoutedEffort($, e))
    if (result.usage) {
      await recordStep($, e.agentId, e.model, result.usage)
      if (e.agentId === undefined) await onMainStep($, e.model, result.usage, sentAt)
      await guardStep($, e.agentId, limits, result.toolUses.length > 0)
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id === undefined) return next(e)
    const deny = await denyOf($, id, e.tool, limits)
    if (deny !== undefined) return { deny }
    await setTool($, id, e.tool)
    const ran = await next(e)
    await setTool($, id, undefined)
    return afterTool($, id, e, ran, limits)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await learn($, project, await finish($, e.agentId, e.reason), e.reason)
      forget(e.agentId)
    } else {
      await announceSetup($, await onMainTurnEnd($), { router: mode, budgetUsd, forecast: limits.forecast, warm })
    }
    return next(e)
  })
}
