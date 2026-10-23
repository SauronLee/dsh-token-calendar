/**
 * dsh-token-calendar — host half.
 *
 * Folds every durable session log into a per-day, per-model token ledger and
 * serves it to the browser half over one JSON route. Reads go through
 * `ctx.sessionQuery`, so live sessions, persisted sessions, compression and
 * historical formats stay the persistence backend's problem — this plugin
 * never touches session files.
 *
 * Nothing is written to disk: the ledger is a pure projection of the session
 * logs, rebuilt on demand and cached in process for `ttlMs`.
 *
 * @module dsh-token-calendar
 */

/** Route the browser half polls. */
export const DATA_ROUTE = '/plugins/dsh-token-calendar/data'

/** How long one built ledger is served before it is rebuilt, in milliseconds. */
const DEFAULT_TTL_MS = 120_000

/** Concurrent session reads during one rebuild. */
const READ_CONCURRENCY = 4

/** Model name used when a session logged usage without a model route. */
const UNKNOWN_MODEL = '未知模型'

export const name = 'dsh-token-calendar'

/** The Web carrier serves the ledger route; history is resolved lazily. */
export const inject = ['webServer']

/**
 * Local calendar day of one epoch-millisecond timestamp (`YYYY-MM-DD`).
 * @param milliseconds - epoch milliseconds.
 * @returns the host-local calendar day.
 */
export function localDayKey(milliseconds) {
  const date = new Date(milliseconds)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Read one optional usage counter as a finite non-negative number.
 * @param value - raw provider field.
 * @returns the counter, or zero for anything unusable.
 */
function counter(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** @returns a zeroed usage bucket. */
function emptyBucket() {
  return { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }
}

/**
 * Accumulate one provider usage report into a bucket.
 * @param bucket - mutable bucket to add to.
 * @param usage - provider-reported usage record.
 */
export function addUsage(bucket, usage) {
  const input = counter(usage.inputTokens)
  const cacheRead = counter(usage.cacheReadTokens)
  const cacheWrite = counter(usage.cacheWriteTokens)
  const output = counter(usage.outputTokens)
  bucket.calls += 1
  bucket.input += input
  bucket.cacheRead += cacheRead
  bucket.cacheWrite += cacheWrite
  bucket.output += output
  bucket.total += input + cacheRead + cacheWrite + output
}

/**
 * Look up or create the bucket for one key in a plain object map.
 * @param map - bucket map keyed by day or model.
 * @param key - bucket key.
 * @returns the existing or fresh bucket.
 */
function bucketFor(map, key) {
  let bucket = map[key]
  if (bucket === undefined) {
    bucket = emptyBucket()
    map[key] = bucket
  }
  return bucket
}

/**
 * Fold one session's events into the day and model maps.
 *
 * Only `assistant/message` events carry provider usage, and one such event is
 * one billed attempt: retries and failed attempts that still reported usage
 * each contribute their own report.
 *
 * @param events - complete, replay-validated session events.
 * @param days - day-keyed ledger, mutated in place.
 * @param models - model-keyed total across all days, mutated in place.
 */
export function foldUsageEvents(events, days, models) {
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    if (event.type !== 'assistant/message') continue
    const data = event.data
    if (data === null || typeof data !== 'object') continue
    const usage = data.usage
    if (usage === null || typeof usage !== 'object') continue
    const source = data.message !== null && typeof data.message === 'object' ? data.message.source : undefined
    const model = typeof source?.model === 'string' && source.model !== '' ? source.model : UNKNOWN_MODEL
    const time = typeof event.time === 'number' ? event.time : Date.now()
    const dayKey = localDayKey(time)

    const day = bucketFor(days, dayKey)
    if (day.models === undefined) day.models = {}
    addUsage(day, usage)
    addUsage(bucketFor(day.models, model), usage)
    addUsage(bucketFor(models, model), usage)
  }
}

/**
 * Sort a model bucket map into a descending list by total tokens.
 * @param map - model-keyed buckets.
 * @returns the ordered list carrying `model` with each bucket.
 */
function modelRows(map) {
  return Object.entries(map)
    .map(([model, bucket]) => ({ model, ...bucket }))
    .sort((left, right) => right.total - left.total || right.calls - left.calls)
}

/**
 * Run tasks with a fixed concurrency limit, preserving no result order.
 * @param items - work items.
 * @param limit - maximum in-flight tasks.
 * @param task - async worker for one item.
 */
async function eachLimit(items, limit, task) {
  const queue = items.slice()
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      await task(next)
    }
  })
  await Promise.all(workers)
}

/**
 * Rebuild the complete ledger from the session-query corpus.
 * @param ctx - plugin context carrying the optional `sessionQuery` service.
 * @param ttlMs - cache lifetime reported to the browser.
 * @returns the wire payload.
 */
async function buildLedger(ctx, ttlMs) {
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    throw new Error('sessionQuery 服务未挂载：无法读取会话历史')
  }
  const listed = await query.listSessions()
  const days = {}
  const models = {}
  let read = 0
  let failed = 0

  await eachLimit(listed, READ_CONCURRENCY, async (entry) => {
    const id = entry?.header?.id
    if (typeof id !== 'string' || id === '') {
      failed += 1
      return
    }
    try {
      const snapshot = await query.readSession(id)
      foldUsageEvents(snapshot.events ?? [], days, models)
      read += 1
    } catch {
      // A corrupt or still-materializing log must not void the whole ledger.
      failed += 1
    }
  })

  const wireDays = {}
  let grandTotal = emptyBucket()
  for (const [dayKey, bucket] of Object.entries(days)) {
    wireDays[dayKey] = {
      calls: bucket.calls,
      input: bucket.input,
      cacheRead: bucket.cacheRead,
      cacheWrite: bucket.cacheWrite,
      output: bucket.output,
      total: bucket.total,
      models: modelRows(bucket.models ?? {}),
    }
    grandTotal = {
      calls: grandTotal.calls + bucket.calls,
      input: grandTotal.input + bucket.input,
      cacheRead: grandTotal.cacheRead + bucket.cacheRead,
      cacheWrite: grandTotal.cacheWrite + bucket.cacheWrite,
      output: grandTotal.output + bucket.output,
      total: grandTotal.total + bucket.total,
    }
  }

  return {
    generatedAt: Date.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ttlMs,
    sessions: read,
    failedSessions: failed,
    totals: grandTotal,
    days: wireDays,
    models: modelRows(models),
  }
}

/**
 * Register the ledger route plus its lazy rebuild cache.
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  const server = ctx.get('webServer') ?? ctx.get('httpServer')
  if (server === undefined) return

  const ttlMs = DEFAULT_TTL_MS
  /** @type {object | undefined} */
  let ledger
  let builtAt = 0
  /** @type {Promise<object> | undefined} */
  let inflight

  const rebuild = async () => {
    const next = await buildLedger(ctx, ttlMs)
    ledger = next
    builtAt = Date.now()
    return next
  }

  /**
   * Serve the freshest allowed ledger.
   * @param force - rebuild even when the cache is still warm.
   * @returns the wire payload.
   */
  const read = async (force) => {
    if (!force && ledger !== undefined && Date.now() - builtAt <= ttlMs) return ledger
    if (inflight === undefined) {
      inflight = rebuild().finally(() => {
        inflight = undefined
      })
    }
    try {
      return await inflight
    } catch (error) {
      // Keep the last good snapshot alive instead of blanking the calendar.
      if (ledger !== undefined) return { ...ledger, stale: true, error: String(error?.message ?? error) }
      throw error
    }
  }

  /**
   * Answer one ledger request.
   * @param req - inbound request.
   * @param res - outbound response.
   */
  const handler = async (req, res) => {
    const gate = ctx.get('connection')
    if (gate !== undefined && typeof gate.requestRejection === 'function') {
      const rejection = gate.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: rejection === 401 ? 'unauthorized' : rejection === 403 ? 'forbidden' : 'authentication unavailable' }))
        return
      }
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    try {
      const payload = await read(url.searchParams.get('refresh') === '1')
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(payload))
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error: String(error?.message ?? error) }))
    }
  }

  ctx.effect(() => server.register({ kind: 'exact', path: DATA_ROUTE, handler }), 'token-usage: ledger route')

  // Warm the cache once the profile is idle enough that a background fold is
  // free; the settings page also rebuilds on demand.
  const warm = setTimeout(() => {
    read(false).catch(() => {})
  }, 3000)
  if (typeof warm.unref === 'function') warm.unref()
  ctx.effect(() => () => clearTimeout(warm), 'token-usage: warm timer')
}