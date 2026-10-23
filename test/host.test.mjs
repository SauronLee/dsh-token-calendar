import test from 'node:test'
import assert from 'node:assert/strict'

import { addUsage, foldUsageEvents, localDayKey } from '../lib/index.js'

/** Build one assistant message event carrying provider usage. */
function usageEvent(time, model, usage) {
  return {
    type: 'assistant/message',
    seq: 1,
    time,
    data: { message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'test', model } }, usage },
  }
}

test('localDayKey buckets by the host-local calendar day', () => {
  const noon = new Date(2026, 9, 22, 12, 0, 0).getTime()
  const lateNight = new Date(2026, 9, 22, 23, 59, 59).getTime()
  const nextDay = new Date(2026, 9, 23, 0, 0, 1).getTime()
  assert.equal(localDayKey(noon), '2026-10-22')
  assert.equal(localDayKey(lateNight), '2026-10-22')
  assert.equal(localDayKey(nextDay), '2026-10-23')
})

test('addUsage sums every counter and ignores garbage', () => {
  const bucket = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }
  addUsage(bucket, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, cacheWriteTokens: 5, totalTokens: 1025 })
  addUsage(bucket, { inputTokens: -1, outputTokens: Number.NaN, totalTokens: 7 })
  assert.deepEqual(bucket, { calls: 2, input: 100, cacheRead: 900, cacheWrite: 5, output: 20, total: 1025 })
})

test('foldUsageEvents splits one log across days and models', () => {
  const days = {}
  const models = {}
  const events = [
    usageEvent(new Date(2026, 9, 21, 10, 0, 0).getTime(), 'model-a', { inputTokens: 10, outputTokens: 2, cacheReadTokens: 90 }),
    usageEvent(new Date(2026, 9, 21, 11, 0, 0).getTime(), 'model-a', { inputTokens: 5, outputTokens: 1, cacheReadTokens: 50 }),
    usageEvent(new Date(2026, 9, 22, 9, 0, 0).getTime(), 'model-b', { inputTokens: 7, outputTokens: 3, cacheWriteTokens: 4 }),
    { type: 'user/message', seq: 4, time: Date.now(), data: {} },
    { type: 'assistant/message', seq: 5, time: Date.now(), data: { message: { role: 'assistant' } } },
  ]

  foldUsageEvents(events, days, models)

  assert.deepEqual(Object.keys(days).sort(), ['2026-10-21', '2026-10-22'])
  assert.equal(days['2026-10-21'].total, 158)
  assert.equal(days['2026-10-21'].calls, 2)
  assert.equal(days['2026-10-21'].models['model-a'].total, 158)
  assert.equal(days['2026-10-22'].total, 14)
  assert.equal(days['2026-10-22'].models['model-b'].cacheWrite, 4)
  assert.equal(models['model-a'].total, 158)
  assert.equal(models['model-b'].total, 14)
})

test('foldUsageEvents falls back to a placeholder instead of dropping usage', () => {
  const days = {}
  const models = {}
  foldUsageEvents([{ type: 'assistant/message', seq: 1, time: Date.now(), data: { usage: { inputTokens: 3 } } }], days, models)
  assert.equal(models['未知模型'].total, 3)
})
test('apply serves one JSON ledger over the data route', async () => {
  const { apply, DATA_ROUTE } = await import('../lib/index.js')
  const routes = []
  const events = [
    usageEvent(new Date(2026, 9, 22, 10, 0, 0).getTime(), 'model-a', { inputTokens: 10, outputTokens: 4, cacheReadTokens: 86 }),
  ]
  const query = {
    listSessions: async () => [{ header: { id: 'one' } }, { header: { id: 'broken' } }],
    readSession: async (id) => {
      if (id === 'broken') throw new Error('corrupt log')
      return { events }
    },
  }
  const ctx = {
    get(name) {
      if (name === 'webServer') {
        return {
          register(route) {
            routes.push(route)
            return () => {}
          },
        }
      }
      if (name === 'sessionQuery') return query
      return undefined
    },
    effect: (fn) => fn(),
  }

  apply(ctx)

  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'exact')
  assert.equal(routes[0].path, DATA_ROUTE)

  const response = { status: 0, body: '', writeHead(status) { this.status = status }, end(body) { this.body = body } }
  await routes[0].handler({ url: DATA_ROUTE, method: 'GET', headers: {} }, response)

  assert.equal(response.status, 200)
  const payload = JSON.parse(response.body)
  assert.equal(payload.sessions, 1)
  assert.equal(payload.failedSessions, 1)
  assert.equal(payload.totals.total, 100)
  assert.equal(payload.days['2026-10-22'].models[0].model, 'model-a')
  assert.equal(payload.models[0].calls, 1)
})

test('the data route refuses a rejected browser request', async () => {
  const { apply, DATA_ROUTE } = await import('../lib/index.js')
  const routes = []
  const ctx = {
    get(name) {
      if (name === 'webServer') return { register(route) { routes.push(route); return () => {} } }
      if (name === 'connection') return { requestRejection: () => 401 }
      return undefined
    },
    effect: (fn) => fn(),
  }

  apply(ctx)

  const response = { status: 0, body: '', writeHead(status) { this.status = status }, end(body) { this.body = body } }
  await routes[0].handler({ url: DATA_ROUTE, method: 'GET', headers: {} }, response)

  assert.equal(response.status, 401)
  assert.deepEqual(JSON.parse(response.body), { error: 'unauthorized' })
})
