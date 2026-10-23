import { expect, test } from 'claude-code/testing'

import { forecastModeOf, forecastOf, keyOf } from './forecast'

test('no forecast below ten runs; from ten, the 90th percentile times 1.5', () => {
  const runs = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) * 100)
  expect(forecastOf(runs(9))).toBeUndefined()
  expect(forecastOf(runs(10))).toBe(1350)
  expect(forecastOf(runs(30))).toBe(4050)
})

test('one odd run does not set the forecast', () => {
  expect(forecastOf([...Array(19).fill(1000), 50_000_000])).toBe(1500)
})

test('the kind of a run, and the option read with "on" as its default', () => {
  expect([keyOf('Explore', 'haiku', false), keyOf('general-purpose', 'sonnet', true)]).toEqual(['Explore · haiku', 'general-purpose · sonnet · fork'])
  expect([forecastModeOf(undefined), forecastModeOf('nudge'), forecastModeOf('off'), forecastModeOf('x')]).toEqual(['on', 'nudge', 'off', 'on'])
})
