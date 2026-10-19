/**
 * 委派效果统计路由契约测试（node:test，全部合成 fixture，禁碰真实 ~/.dsh——
 * DSH_HOME 与 DSH_PAODING_CWD 钉到临时目录，会话库与配置文件都在里面）。
 *
 * 钉死契约：
 *   - GET stats → 200 { ok, project, windowDays, generatedAt, roles,
 *     sessionsScanned, delegatedSessions, skipped }：只认 agentPreset 以
 *     paoding-role- 开头的会话，角色名去前缀；roles 按调用数降序（同量按
 *     最近使用新者在前）。
 *   - 失败判据（判据与真实库证据见 stats-core.mjs 文件头）：owned 段
 *     turn/start ≥ 1 且与 turn/end 平衡 = 正常完成；零轮次 / 轮次中断计入
 *     failures。inheritedEventCount 切掉继承前缀后才计数与取窗口（防续跑
 *     子会话的上一轮化身污染时长与首事件时间）。
 *   - 窗口 days：按会话首事件（owned 段）时间过滤，整数夹取 [1,365]，
 *     缺省 30；days=abc 回落缺省。
 *   - 读句柄抛错 / 目录缺日志文件的会话跳过并计入 skipped，路由不 5xx。
 *   - ctx.reflect 软探测：缺 sessionPersistence → { ok:false,
 *     reason:'persistence-unavailable' }；不进 inject 数组（本测试的桩 ctx
 *     不提供可注入服务面，apply 能挂载即是证据）。
 *   - 摘要缓存：日志文件 mtime/size 未变不重开读句柄（假服务 reads 计数
 *     验证）；文件 mtime 变更后仅重读该会话。
 *   - project 清洗：仅 [A-Za-z0-9._-]（'..' / 含分隔符 → 422），缺省 =
 *     当前面板项目（DSH_PAODING_CWD → projectKeyOf 换算），合法但目录不存在
 *     → 空结果不报错；project=all 跨项目聚合（仅内部 / 测试用）。
 *   - 信任围栏先行：stats 也在 /api/paoding 前缀下，cross-site → 403。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const index = await import('../plugins/paoding-config-ui/index.mjs')
const { projectKeyOf } = await import('../plugins/paoding-config-ui/stats-core.mjs')

// ── 临时环境 + 合成会话库 ─────────────────────────────────────────────────────

const dshHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-stats-'))
const sessionsRoot = path.join(dshHome, 'sessions')
const projectCwd = path.join(dshHome, 'proj')
const slug = projectKeyOf(projectCwd)
const slug2 = projectKeyOf(path.join(dshHome, 'proj2'))
const configFile = path.join(dshHome, 'dsh-paoding.config.yml')

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()

const ENV_KEYS = ['DSH_HOME', 'DSH_PAODING_CWD', 'DSH_PAODING_CONFIG']
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

// 假 sessionPersistence 服务的 fixture 注册表与调用计数（reads 只在真读时递增，
// 供缓存增量用例对账；opens 无论成败都递增）。
const fixtures = Object.create(null)
const calls = { opens: 0, reads: 0, closes: 0 }

function fakePersistence() {
  return {
    async open(id) {
      calls.opens++
      const fx = fixtures[id]
      if (!fx) throw new Error('simulated corrupt/unreadable session log: ' + id)
      return {
        header: fx.header,
        inheritedEventCount: fx.inherited,
        async read() {
          calls.reads++
          return { events: fx.events }
        },
        async close() {
          calls.closes++
        },
      }
    },
  }
}

/** 造一个合成会话：目录 + 日志文件（内容随意——冷读走假服务，文件只供缓存
 *  对账 stat mtime/size），并在 fixture 表注册头与事件。broken = 只留坏目录
 *  （open 必抛），验证 skipped 计数。 */
function makeSession(id, { preset, events = [], inherited = 0, slug: slugDir = slug, broken = false } = {}) {
  const dir = path.join(sessionsRoot, slugDir, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), 'synthetic fixture payload\n', 'utf8')
  if (broken) return
  fixtures[id] = {
    header: { agentPreset: preset, createdAt: events.length ? events[0].time : now },
    inherited,
    events,
  }
}

const ev = (type, time) => ({ type, time })
/** 一轮正常助手轮次（start 在 t0，end 在 t0+dur——时间向新推进）。 */
function oneTurn(t0, dur) {
  return [ev('turn/start', t0), ev('assistant/message', t0 + Math.floor(dur / 2)), ev('turn/end', t0 + dur)]
}

// 会话各成员的期望值（测试断言直接引用，口径与 stats-core.mjs 一致）。
const T_IMP1_START = now - 2 * DAY
const T_IMP2_START = now - 1 * DAY
const T_CODER_START = now - 3 * DAY
const T_WRITER_START = now - 5 * DAY
const T_REVIEW_OWNED_START = now - 40 * DAY // inherited 前缀更老（100 天前）
const IMP_DUR1 = 60 * 1000
const IMP_DUR2 = 180 * 1000

before(() => {
  process.env.DSH_HOME = dshHome
  process.env.DSH_PAODING_CWD = projectCwd
  process.env.DSH_PAODING_CONFIG = configFile
  // 预创建配置文件：插件 apply() 的后台 preset 自愈在有既有配置时只读不写，
  // 避免自愈与用例互踩（与 tests/api-config.test.mjs 同款隔离手法）。
  writeFileSync(configFile, 'profile: web\n', 'utf8')

  // ① implement ×2：正常完成（轮次平衡），同角色聚合 calls=2
  makeSession('11111111-0000-4000-8000-000000000001', {
    preset: 'paoding-role-implement',
    events: [...oneTurn(T_IMP1_START, IMP_DUR1)],
  })
  makeSession('22222222-0000-4000-8000-000000000002', {
    preset: 'paoding-role-implement',
    events: [...oneTurn(T_IMP2_START, IMP_DUR2)],
  })
  // ③ coder：轮次中断（start 有、end 无）→ 失败
  makeSession('33333333-0000-4000-8000-000000000003', {
    preset: 'paoding-role-coder',
    events: [ev('turn/start', T_CODER_START), ev('assistant/message', T_CODER_START + 1000)],
  })
  // ④ writer：零轮次（spawn 后即死）→ 失败
  makeSession('44444444-0000-4000-8000-000000000004', {
    preset: 'paoding-role-writer',
    events: [ev('permission/preset', T_WRITER_START), ev('session/end-seed', T_WRITER_START + 500)],
  })
  // ⑤ review：带 2 条继承前缀（100 天前），owned 段从 40 天前开始且正常——
  //   days=30 滤掉、days=90 收进；若实现误用全量首事件（100 天前）则 90 天
  //   窗口也会滤掉，兼验 inheritedEventCount 切片。
  makeSession('55555555-0000-4000-8000-000000000005', {
    preset: 'paoding-role-review',
    inherited: 2,
    events: [
      ev('turn/end', now - 100 * DAY),
      ev('session/end-seed', now - 100 * DAY + 10),
      ...oneTurn(T_REVIEW_OWNED_START, 30 * 1000),
    ],
  })
  // ⑥ 非 paoding preset：忽略不计
  makeSession('66666666-0000-4000-8000-000000000006', {
    preset: 'orchestrator',
    events: [...oneTurn(now - DAY, 1000)],
  })
  // ⑦ 损坏会话：open 必抛 → skipped
  makeSession('broken7777-0000-4000-8000-000000000007', { broken: true })
  // ⑧ 跨项目（proj2）：只进 project=all 的账
  makeSession('88888888-0000-4000-8000-000000000008', {
    preset: 'paoding-role-test',
    events: [...oneTurn(now - DAY, 5000)],
    slug: slug2,
  })
})

after(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  rmSync(dshHome, { recursive: true, force: true })
})

// ── 路由装填（桩 ctx 与 tests/api-config.test.mjs 同款，另加 reflect 软探测）──

async function loadRouteHandler(persistence) {
  let def = null
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get() { return undefined },
    // reflect.get(name, false) 软探测口：只认 sessionPersistence（sessionQuery
    // 在场与否不影响 stats，顺带模拟双服务在场的真实形态）。
    reflect: {
      get(name) {
        if (name === 'sessionPersistence') return persistence
        if (name === 'sessionQuery') return persistence ? {} : undefined
        return undefined
      },
    },
    webServer: {
      register(d) {
        def = d
        return () => { if (def === d) def = null }
      },
    },
  }
  await index.apply(ctx)
  assert.ok(def && def.kind === 'prefix' && def.path === '/api/paoding', 'apply 应注册 /api/paoding 前缀路由')
  return () => def.handler
}

function fakeReq(url, { headers = {} } = {}) {
  const req = new EventEmitter()
  req.url = url
  req.method = 'GET'
  req.headers = { host: '127.0.0.1:19387', ...headers }
  return req
}

async function callRoute(handler, url, opts = {}) {
  const res = {
    statusCode: 0,
    raw: '',
    writeHead(code) { this.statusCode = code },
    end(text) { this.raw = String(text ?? '') },
  }
  await handler(fakeReq(url, opts), res)
  let json = null
  try { json = JSON.parse(res.raw) } catch { /* 非 JSON 响应保持 null */ }
  return { status: res.statusCode, json }
}

const handler = await loadRouteHandler(fakePersistence())

// ── 用例 ─────────────────────────────────────────────────────────────────────

test('围栏先行：stats 也在前缀围栏之下，cross-site 403', async () => {
  const r = await callRoute(handler(), '/api/paoding/stats', { headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(r.status, 403)
  assert.equal(r.json.error, 'forbidden')
})

test('聚合与排序：去前缀、调用数降序、avgMs、failures、lastUsedAt', async () => {
  const r = await callRoute(handler(), '/api/paoding/stats?project=' + encodeURIComponent(slug))
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.project, slug)
  assert.equal(r.json.windowDays, 30, '缺省窗口 30 天')
  assert.equal(typeof r.json.generatedAt, 'string')
  assert.equal(r.json.sessionsScanned, 7, '单项目枚举 7 个会话目录')
  assert.equal(r.json.skipped, 1, '损坏会话跳过并计数')
  assert.equal(r.json.delegatedSessions, 4, '30 天内 paoding 委派会话数（review 40 天前被滤掉）')
  assert.deepEqual(r.json.roles.map((x) => x.role), ['implement', 'coder', 'writer'],
    'calls 降序，同量按最近使用新者在前')
  const impl = r.json.roles[0]
  assert.equal(impl.calls, 2)
  assert.equal(impl.failures, 0)
  assert.equal(impl.avgMs, Math.round((IMP_DUR1 + IMP_DUR2) / 2))
  assert.equal(impl.lastUsedAt, T_IMP2_START + IMP_DUR2, '最近使用 = 该角色末会话末事件时间')
  assert.deepEqual(
    r.json.roles.slice(1).map((x) => [x.calls, x.failures]),
    [[1, 1], [1, 1]],
    'coder（轮次中断）与 writer（零轮次）各记一次失败',
  )
})

test('days 窗口：90 天收进 40 天前的 review，365 上限夹取，days=abc 回落缺省', async () => {
  const r90 = await callRoute(handler(), `/api/paoding/stats?project=${encodeURIComponent(slug)}&days=90`)
  assert.equal(r90.json.delegatedSessions, 5)
  assert.deepEqual(r90.json.roles.map((x) => x.role), ['implement', 'coder', 'writer', 'review'],
    '同 calls=1 时按最近使用新者在前')
  assert.equal(r90.json.roles[3].calls, 1)
  assert.equal(r90.json.roles[3].failures, 0, 'review 的继承前缀不参与轮次计数（owned 段平衡）')

  const rBig = await callRoute(handler(), `/api/paoding/stats?project=${encodeURIComponent(slug)}&days=99999`)
  assert.equal(rBig.json.windowDays, 365, 'days 上限 365')

  const rBad = await callRoute(handler(), `/api/paoding/stats?project=${encodeURIComponent(slug)}&days=abc`)
  assert.equal(rBad.json.windowDays, 30, 'days=abc 回落缺省 30')
})

test('缓存增量：mtime/size 未变不重开读句柄，mtime 变更只重读该会话', async () => {
  const firstReads = calls.reads
  assert.ok(firstReads >= 6, `首轮应实读可读会话（实读 ${firstReads} 次）`)
  const r1 = await callRoute(handler(), `/api/paoding/stats?project=${encodeURIComponent(slug)}`)
  assert.equal(r1.status, 200)
  assert.equal(calls.reads, firstReads, '第二次调用命中缓存，未新开任何读句柄')

  // 只动一个会话日志文件的 mtime → 下一轮只多读这一个
  const touched = path.join(sessionsRoot, slug, '22222222-0000-4000-8000-000000000002', 'session.v4.jsonl.zstd')
  const st = await import('node:fs').then((fs) => fs.statSync(touched))
  utimesSync(touched, st.atime, new Date(st.mtimeMs + 5000))
  const r2 = await callRoute(handler(), `/api/paoding/stats?project=${encodeURIComponent(slug)}`)
  assert.equal(r2.status, 200)
  assert.equal(calls.reads, firstReads + 1, '仅 mtime 变更的会话被重读')
})

test('project 清洗：.. 与分隔符 422，合法但目录不存在回空，缺省 = 当前面板项目', async () => {
  const up = await callRoute(handler(), '/api/paoding/stats?project=..')
  assert.equal(up.status, 422)
  const travel = await callRoute(handler(), '/api/paoding/stats?project=' + encodeURIComponent('../evil'))
  assert.equal(travel.status, 422)
  const slash = await callRoute(handler(), '/api/paoding/stats?project=' + encodeURIComponent('a/b'))
  assert.equal(slash.status, 422)

  const absent = await callRoute(handler(), '/api/paoding/stats?project=no-such-proj')
  assert.equal(absent.status, 200)
  assert.deepEqual(absent.json.roles, [])
  assert.equal(absent.json.sessionsScanned, 0, '目录不存在的 slug 返回空，不报错')

  const def = await callRoute(handler(), '/api/paoding/stats')
  assert.equal(def.status, 200)
  assert.equal(def.json.project, slug, 'project 缺省 = DSH_PAODING_CWD 换算的 projectKey')
})

test('project=all：跨项目聚合（仅内部 / 测试用），proj2 的会话进账', async () => {
  const r = await callRoute(handler(), '/api/paoding/stats?project=all&days=90')
  assert.equal(r.status, 200)
  assert.equal(r.json.project, 'all')
  assert.equal(r.json.sessionsScanned, 8)
  assert.equal(r.json.delegatedSessions, 6, '单项目 5 + proj2 的 test 1')
  assert.ok(r.json.roles.some((x) => x.role === 'test'))
})

test('服务缺失 graceful：reflect 拿不到 sessionPersistence → ok:false + reason', async () => {
  const handlerNoSvc = await loadRouteHandler(undefined)
  const r = await callRoute(handlerNoSvc(), '/api/paoding/stats')
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, { ok: false, reason: 'persistence-unavailable' })
})

test('缓存满员后每轮仅重试损坏会话，成功 open/close 一一成对', async () => {
  const openBefore = calls.opens
  const closeBefore = calls.closes
  const r = await callRoute(handler(), `/api/paoding/stats?project=${encodeURIComponent(slug)}`)
  assert.equal(r.status, 200)
  assert.equal(calls.opens - openBefore, 1, '可读会话全命中缓存不再 open；只有 open 即抛的损坏会话每轮重试')
  assert.equal(calls.closes - closeBefore, 0, '损坏会话 open 即抛无句柄可关，成功路径由 readSessionSummary 的 finally 保证成对')
})

test('临时会话库确在临时目录（不碰真实 ~/.dsh）', () => {
  assert.ok(dshHome.startsWith(os.tmpdir()), dshHome)
  assert.ok(!existsSync(path.join(dshHome, 'sessions', '--')))
})
