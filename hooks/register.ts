import type { Register } from 'claude-code'

import { spawnRouted, withRoutedEffort } from './router'
import type { RouterMode } from './router'
import { addAgent, finish, recordStep, setTool } from './telemetry'
import { onSpawnUi, renderBand, renderPane, tick, togglePane } from './ui'

// One hook per event (the engine takes no second unmatched one); each module adds its part here.
// Every hook fails open: on an error the engine's own behaviour goes on.
export const register: Register = (on, options) => {
  const mode = (options.router as RouterMode | undefined) ?? 'prudent'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pennycrab', description: 'Show or hide the pennycrab pane: your subagents, their models, context and cost' })
    $.clock.every(1000, () => void tick($))
    return next(e)
  })

  on('command.run', { command: 'pennycrab' }, async $ => ({ text: (await togglePane($)) ? 'Pennycrab pane opened.' : 'Pennycrab pane closed.' }))

  on('ui.render', { component: 'Pane', requestId: 'pennycrab' }, ($, e) => renderPane($, e))

  // Nothing on screen says how a closed pane comes back, so the close says it.
  on('ui.close', ($, e, next) => {
    if (e.id === 'pennycrab' && e.origin === 'person') $.ui.toast('Pennycrab closed. Type /pennycrab to bring it back.')
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

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(withRoutedEffort(e))
    if (result.usage) await recordStep($, e.agentId, e.model, result.usage)
    return result
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id === undefined) return next(e)
    await setTool($, id, e.tool)
    const ran = await next(e)
    await setTool($, id, undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) await finish($, e.agentId, e.reason)
    return next(e)
  })
}
