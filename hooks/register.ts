import type { Register } from 'claude-code'

import { keepWarm, keepWarmOf, onMainStep, onMainTurnEnd, onMainTurnStart } from './cache'
import type { KeepWarm } from './cache'
import { answerAlone, budgetOf, denyOf, forget, guardStep, stopOf } from './guard'
import type { Budget } from './guard'
import { loadStoredPrices, refreshPrices } from './prices'
import { spawnRouted, withRoutedEffort } from './router'
import type { RouterMode } from './router'
import { announceSetup } from './setup'
import { addAgent, finish, recordStep, setTool } from './telemetry'
import { onSpawnUi, renderBand, renderPane, tick, togglePane } from './ui'

// One hook per event (the engine takes no second unmatched one); each module adds its part here.
// Every hook fails open: on an error the engine's own behaviour goes on.
export const register: Register = (on, options) => {
  const mode = (options.router as RouterMode | undefined) ?? 'auto'
  const budgetUsd = budgetOf(options.budget as Budget | undefined)
  const warm = keepWarmOf(options.keepWarm as KeepWarm | undefined)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pennycrab', description: 'Show or hide the pennycrab pane: your subagents, their models, context and cost' })
    await loadStoredPrices($)
    void refreshPrices($).catch(() => undefined)
    $.clock.every(1000, () => {
      void tick($)
      void keepWarm($, warm).catch(() => undefined)
    })
    return next(e)
  })

  on('command.run', { command: 'pennycrab' }, async $ => ({ text: (await togglePane($)) ? 'Pennycrab pane opened.' : 'Pennycrab pane closed.' }))

  on('ui.render', { component: 'Pane', requestId: 'pennycrab' }, ($, e) => renderPane($, e))

  // Nothing on screen says how a closed pane comes back, so the close says it.
  on('ui.close', ($, e, next) => {
    if (e.id === 'pennycrab' && e.origin.kind === 'person') $.ui.toast('Pennycrab closed. Type /pennycrab to bring it back.')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => renderBand($, e, next)).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const started = await spawnRouted($, e, next, mode)
    if (started.agentId !== undefined) {
      await addAgent($, e, started.agentId, started.model)
      await onSpawnUi($)
    }
    return started
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await onMainTurnStart($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const stop = await stopOf($, e.agentId, budgetUsd)
    if (stop !== undefined) return yield* answerAlone(e, stop)
    const result = yield* next(withRoutedEffort(e))
    if (result.usage) {
      await recordStep($, e.agentId, e.model, result.usage)
      if (e.agentId === undefined) await onMainStep($, e.model, result.usage)
      await guardStep($, e.agentId, budgetUsd, result.toolUses.length > 0)
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id === undefined) return next(e)
    const deny = await denyOf($, id, budgetUsd)
    if (deny !== undefined) return { deny }
    await setTool($, id, e.tool)
    const ran = await next(e)
    await setTool($, id, undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await finish($, e.agentId, e.reason)
      forget(e.agentId)
    } else {
      await announceSetup($, await onMainTurnEnd($), { router: mode, budgetUsd, warm })
    }
    return next(e)
  })
}
