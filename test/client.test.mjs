import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * React is not a runtime dependency of this package: the browser bundle
 * resolves it from DSH's platform module table. Tests use a local React when
 * one is installed (`npm install`), fall back to `DSH_REACT_DIR`, and skip the
 * browser-side checks when neither exists.
 */
function loadReact() {
  const roots = [
    import.meta.url,
    join(process.env.DSH_REACT_DIR ?? join(homedir(), 'workspace/dsh-org/plugin/node_modules'), 'noop.cjs'),
    join(process.cwd(), 'noop.cjs'),
  ]
  for (const from of roots) {
    try {
      const req = createRequire(from)
      return { React: req('react'), renderToStaticMarkup: req('react-dom/server').renderToStaticMarkup }
    } catch {
      // try the next resolution root
    }
  }
  return undefined
}

const runtime = loadReact()
const clientTest = runtime === undefined ? test.skip : test

let entry
let bundle
const loaded = []

if (runtime !== undefined) {
  // The bundle registers itself through the loader exactly once per module
  // instance, so it is loaded at module scope and reused by every test.
  globalThis.window = { __ModuleLoader__: { load: (item) => loaded.push(item) } }
  await import('../lib/client.js')
  entry = loaded[0]
  bundle = entry.factory((id) => {
    if (id === 'react') return runtime.React
    throw new Error('unexpected module request: ' + id)
  })
} else {
  test('browser-side checks', { skip: 'no React installed: run `npm install` or set DSH_REACT_DIR' }, () => {})
}

clientTest('the bundle registers under the package name and exports a plugin', () => {
  assert.equal(loaded.length, 1)
  assert.equal(entry.id, 'dsh-token-usage')
  assert.equal(typeof bundle.apply, 'function')
  assert.deepEqual(bundle.inject, ['slots'])
})

clientTest('apply registers one Token 用量 settings section', () => {
  const registrations = []
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (name, factory) => {
        assert.equal(name, 'settings.section')
        return factory()
      },
      register: (definition, component) => {
        registrations.push({ definition, component })
        return () => {}
      },
    },
  }

  bundle.apply(ctx)

  assert.equal(registrations.length, 1)
  const { definition, component } = registrations[0]
  assert.equal(definition.name, 'settings.section')
  assert.equal(definition.id, 'token-usage')
  assert.equal(definition.order, 20)
  assert.equal(definition.label(), 'Token 用量')
  assert.equal(typeof component, 'function')
})

clientTest('the section renders a calendar with today, per-model rows and totals', () => {
  const now = new Date()
  const key = bundle.__test.dayKeyOf(now.getFullYear(), now.getMonth(), now.getDate())
  const model = 'deepseek-v4.1-flash-1017'
  const day = {
    calls: 1289,
    input: 3634255,
    cacheRead: 249335296,
    cacheWrite: 0,
    output: 890248,
    total: 253170790,
    models: [{
      model,
      calls: 1289,
      input: 3634255,
      cacheRead: 249335296,
      cacheWrite: 0,
      output: 890248,
      total: 253170790,
    }],
  }
  const ledger = {
    data: {
      generatedAt: now.getTime(),
      timeZone: 'Asia/Shanghai',
      ttlMs: 120000,
      sessions: 12,
      failedSessions: 0,
      totals: day,
      days: { [key]: day },
      models: day.models,
    },
    error: null,
    loading: false,
  }

  const html = runtime.renderToStaticMarkup(runtime.React.createElement(bundle.__test.TokenUsageView, {
    ledger,
    refresh: () => {},
  }))

  assert.match(html, /Token 用量/)
  assert.match(html, /2\.53 亿/)
  assert.match(html, /deepseek-v4\.1-flash-1017/)
  assert.match(html, /1,289 次调用/)
  assert.match(html, /回到今天/)
  assert.match(html, /输入 3,634,255/)
})

clientTest('compact formatting switches units', () => {
  const { compact, full } = bundle.__test
  assert.equal(compact(0), '0')
  assert.equal(compact(999), '999')
  assert.equal(compact(12345), '1.2 万')
  assert.equal(compact(253170790), '2.53 亿')
  assert.equal(compact(100000000), '1 亿')
  assert.equal(full(253170790), '253,170,790')
})

clientTest('monthGrid is Monday-first and lands in whole weeks', () => {
  const cells = bundle.__test.monthGrid(2026, 9)
  assert.equal(cells.length % 7, 0)
  // 2026-10-01 is a Thursday: three leading blanks (Monday-first), then day 1.
  assert.deepEqual(cells.slice(0, 4), [null, null, null, 1])
  assert.equal(cells.filter((cell) => cell !== null).length, 31)
})