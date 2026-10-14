/**
 * config/export / config/import 路由契约测试（node:test，禁网络 —— dshHome 与
 * 配置文件一律钉到临时目录，不触碰真实 $DSH_HOME；临时目录里无 cordis.patch.yml
 * 不触发 MCP 握手，与 tests/api-apply.test.mjs 同款隔离手法）。
 *
 * 钉死契约：
 *   - GET  config/export → 200 { ok, filename, content }：content = 配置文件
 *     原文（字节不动）；文件不存在回落基础模板文本（与首装自愈写入同源），
 *     且导出绝不写盘。
 *   - POST config/import { content } → 200 { ok: true }：解析校验与 loadConfig
 *     同口径（顶层非映射 → 422 { error }，不写盘；测试环境无宿主 yaml 模块，
 *     走内置 parseYamlSubset —— 它不抛错，真正的校验闸是顶层映射检查）；通过
 *     后 saveConfig 单一写盘路径落盘（头注释 + 规范化），写盘即改 mtime →
 *     state 缓存对账自动失效。
 *   - 空文本 → 422（路由层先拦，语义是「没选内容」而非「顶层不是映射」）。
 *   - 信任围栏：cross-site 请求一律 403（围栏先于路由分发）。
 *
 * 已知取舍（有意为之，见 api-core.importConfigContent 注释）：导入 = 整体覆盖
 * 且经 normalize→serialize 规范化，注释 / 未知键 / 排版不保留，schema 字段全保。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const index = await import('../plugins/paoding-config-ui/index.mjs')
const apiCore = await import('../plugins/paoding-config-ui/api-core.mjs')
const { loadConfig } = await import('../tools/lib/config.mjs')

// ── 临时环境 + 路由装填 ───────────────────────────────────────────────────────

const dshHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-cfg-'))
const configFile = path.join(dshHome, 'dsh-paoding.config.yml')
const absentConfig = path.join(dshHome, 'absent-export.yml')

const ENV_KEYS = ['DSH_HOME', 'DSH_PAODING_CONFIG', 'DSH_PAODING_CWD']
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

before(() => {
  process.env.DSH_HOME = dshHome
  // 主配置文件预创建：插件 apply() 会在后台触发 preset 自愈（ensurePresetInstalled），
  // 有既有配置时它绝不写配置文件（saveConfigOnWrite = !existing），避免自愈与
  // 用例互相踩 mtime；无 cordis.patch.yml 也不握手，只是纯文件扫描。
  writeFileSync(configFile, [
    '# 手写注释：导入后按规范化丢弃',
    'profile: web',
    'main_agent_display_name: 原始主控',
    'roles_remove:',
    '  - design',
  ].join('\n') + '\n', 'utf8')
  process.env.DSH_PAODING_CWD = dshHome
})

after(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

// 假宿主：只捕前缀路由定义，其余服务（llm / workspaceRegistry / webRuntime）
// 一概不给 —— 导出/导入路由不依赖它们，顺便验证「宿主能力缺失不碍事」。
async function loadRouteHandler() {
  let def = null
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get() { return undefined },
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

// 假请求 / 响应：JSON body 经 nextTick 灌入（readBody 在 handler 首个 await 前
// 挂监听，时序成立）；res 只实现 writeHead / end，抓状态码与响应体。
// method 必须显式给 —— 路由分发按 req.method 分流（围栏只看 headers，所以
// 漏了 method 的假请求会一路 404，而不是在围栏处报错）。
function fakeReq(url, { method, headers = {}, body = null } = {}) {
  const req = new EventEmitter()
  req.url = url
  req.method = method || (body !== null ? 'POST' : 'GET')
  req.headers = { host: '127.0.0.1:19387', ...headers }
  if (body !== null) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)))
      req.emit('end')
    })
  }
  return req
}

async function callRoute(handler, url, opts = {}) {
  const res = {
    statusCode: 0,
    headers: null,
    raw: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers },
    end(text) { this.raw = String(text ?? '') },
  }
  await handler(fakeReq(url, opts), res)
  let json = null
  try { json = JSON.parse(res.raw) } catch { /* 非 JSON 响应保持 null */ }
  return { status: res.statusCode, json }
}

const handlerOf = await loadRouteHandler()

// ── 信任围栏 ──────────────────────────────────────────────────────────────────

test('围栏先行：cross-site 请求 403，不进路由分发', async () => {
  const r = await callRoute(handlerOf(), '/api/paoding/config/export', {
    headers: { 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(r.status, 403)
  assert.equal(r.json.error, 'forbidden')
})

// ── GET config/export ────────────────────────────────────────────────────────

test('export：配置存在 → 原文逐字节返回，文件名取自配置路径，不写盘', async () => {
  const before1 = readFileSync(configFile, 'utf8')
  const r = await callRoute(handlerOf(), '/api/paoding/config/export')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.filename, 'dsh-paoding.config.yml')
  assert.equal(r.json.content, before1, '导出必须是配置文件原文（注释 / 排版原样）')
  assert.equal(readFileSync(configFile, 'utf8'), before1, '导出不得改写配置文件')
})

test('export：配置不存在 → 回落基础模板文本（同首装自愈写入），且不落盘', async () => {
  process.env.DSH_PAODING_CONFIG = absentConfig
  try {
    assert.equal(existsSync(absentConfig), false, '前提：目标配置不存在')
    const r = await callRoute(handlerOf(), '/api/paoding/config/export')
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.filename, 'absent-export.yml')
    assert.match(r.json.content, /^# dsh-paoding（庖丁）安装配置/, '回落内容带标准头注释')
    assert.match(r.json.content, /profile: web/)
    assert.equal(existsSync(absentConfig), false, '导出绝不写盘（回落模板也只是响应体）')
  } finally {
    process.env.DSH_PAODING_CONFIG = configFile
  }
})

// ── POST config/import：拒绝路径（不写盘）────────────────────────────────────

test('import：空文本 → 422「缺少配置文本」，文件原样', async () => {
  const before1 = readFileSync(configFile, 'utf8')
  const r = await callRoute(handlerOf(), '/api/paoding/config/import', { body: { content: '   ' } })
  assert.equal(r.status, 422)
  assert.match(r.json.error, /缺少配置文本/)
  assert.equal(readFileSync(configFile, 'utf8'), before1)
})

test('import：顶层是列表 → 422「顶层必须是键值映射」，文件原样', async () => {
  const before1 = readFileSync(configFile, 'utf8')
  const r = await callRoute(handlerOf(), '/api/paoding/config/import', { body: { content: '- a\n- b\n' } })
  assert.equal(r.status, 422)
  assert.match(r.json.error, /顶层必须是键值映射/)
  assert.equal(readFileSync(configFile, 'utf8'), before1)
})

// ── POST config/import：成功路径 ──────────────────────────────────────────────

test('import：合法配置 → 200 {ok} 落盘规范化，mtime 失效 state 缓存', async () => {
  // 导入的配置用块状 YAML（测试环境无宿主 yaml 模块，内置解析器不收流式序列
  // `[a, b]`——与 loadConfig 在此类宿主上的口径一致，不是导入特有的限制）。
  const incoming = [
    '# 手写注释：导入后按规范化丢弃',
    'profile: web',
    'main_agent_extra: []',
    'main_agent_display_name: 测试主控',
    'main_agent_remove:',
    '  - read',
    'roles_remove:',
    '  - design',
    'roles:',
    '  implement:',
    '    model: deepseek-reasoner',
    '    tools:',
    '      - read',
    '      - write',
    'skills:',
    '  caveman:',
    '    - implement',
    'workspaces:',
    "  '/tmp/ws-a':",
    '    roles_remove:',
    '      - design',
  ].join('\n') + '\n'

  // 预热缓存：importConfigContent 内部为取 yamlMod 会走 getState（记下导入前
  // 的 mtime 基准），这里显式预热让断言不依赖那次内部刷新。
  await apiCore.getState()
  assert.equal(apiCore.isStateCacheStale(), false, '前提：缓存已预热且新鲜')

  const r = await callRoute(handlerOf(), '/api/paoding/config/import', { body: { content: incoming } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, { ok: true })

  // 落盘 = 规范化写出：头注释换标准头、手写注释不保留（有意取舍，见文件头）
  const written = readFileSync(configFile, 'utf8')
  assert.match(written, /^# dsh-paoding（庖丁）安装配置/)
  assert.doesNotMatch(written, /手写注释/)
  assert.match(written, /main_agent_display_name: 测试主控/)
  assert.match(written, /main_agent_extra: \[\]/)
  assert.match(written, /'\/tmp\/ws-a'/)

  // 语义保真：loadConfig 回读，schema 字段（含显式空表的「缺省 vs 显式」标记）
  // 全部保留；换回宿主 yaml 的环境同样成立（同一 normalize/serialize 口径）。
  const cfg = loadConfig(configFile, null)
  assert.equal(cfg.main_agent_display_name, '测试主控')
  assert.deepEqual(cfg.roles_remove, ['design'])
  assert.deepEqual(cfg.main_agent_extra, [])
  assert.equal(cfg.has_main_agent_extra, true, '显式空表语义经往返保留')
  assert.deepEqual(cfg.main_agent_remove, ['read'])
  assert.equal(cfg.roles.implement.model, 'deepseek-reasoner')
  assert.deepEqual(cfg.roles.implement.tools, ['read', 'write'])
  assert.deepEqual(cfg.workspaces['/tmp/ws-a']?.roles_remove, ['design'], 'workspaces 段随整份文件导入')

  // mtime 对账：写盘后缓存必须被判失效，下一次 GET state 自会带新配置重刷
  assert.equal(apiCore.isStateCacheStale(), true, '导入落盘后 state 缓存按 mtime 自动失效')
})
