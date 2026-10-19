/**
 * config 域路由契约测试（node:test，禁网络 —— dshHome 与配置文件一律钉到临时
 * 目录，不触碰真实 $DSH_HOME；临时目录里无 cordis.patch.yml 不触发 MCP 握手，
 * 与 tests/api-apply.test.mjs 同款隔离手法）。
 *
 * 钉死契约：
 *   - GET  config/export → 200 { ok, filename, content }：content = 配置文件
 *     原文（字节不动）；文件不存在回落基础模板文本（与首装自愈写入同源），
 *     且导出绝不写盘。
 *   - POST config/import { content } → 200 { ok: true }：解析校验与 loadConfig
 *     同口径（顶层非映射 → 422 { error }，不写盘；测试环境无宿主 yaml 模块，
 *     走内置 parseYamlSubset —— 它不抛错，真正的校验闸是顶层映射检查）；通过
 *     后 saveConfig 单一写盘路径落盘（头注释 + 规范化），写盘即改 mtime →
 *     state 缓存对账自动失效；写盘前自动轮换备份（当前配置推入 bak-1）。
 *   - GET  config/backups → 200 { ok, backups }：备份清单新→旧
 *    （{ file, mtimeMs, size }），无备份返回空数组。
 *   - POST config/restore { file } → 200 { ok: true }：文件名白名单
 *    （「配置文件名.bak-1/2/3」，拒任何分隔符 / 上跳段 = 防路径穿越）、备份
 *     可解析才允许覆盖（坏备份 422 / 不存在 404，不写盘）；回滚先把当前配置
 *     推入备份链（滚错还能再滚回来），再落选定快照——内容在轮换前先读进内存，
 *     轮换后移不改写入选定快照的落盘结果。
 *   - rotateConfigBackups：bak-3←bak-2←bak-1←当前，bak-3 淘汰；首次保存
 *    （无当前配置）不产生任何备份。
 *   - diffAssignments：目标字段差分纯函数（工具 / persona / 模型 / 启停方式 /
 *     技能 / roles_remove 各维度），零文案，changed = 任一子维度有变化。
 *   - slimStatsOf：工具面瘦身统计——total = presetUniverse ∪ inventory（可用
 *     工具全集），main = computeRestrictAllow 同口径的主 agent 有效 allow 计数。
 *   - POST preview 响应附带 diff（相对磁盘现配置）与 slim（按提交 assignments）。
 *   - 空文本 → 422（路由层先拦，语义是「没选内容」而非「顶层不是映射」）。
 *   - 信任围栏：cross-site 请求一律 403（围栏先于路由分发）。
 *
 * 已知取舍（有意为之，见 api-core.importConfigContent 注释）：导入 = 整体覆盖
 * 且经 normalize→serialize 规范化，注释 / 未知键 / 排版不保留，schema 字段全保。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const index = await import('../plugins/paoding-config-ui/index.mjs')
const apiCore = await import('../plugins/paoding-config-ui/api-core.mjs')
const { diffAssignments, loadConfig, normalizeTargetFields } = await import('../tools/lib/config.mjs')

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

// ── rotateConfigBackups：轮换语义（核心函数级，自定义配置路径隔离）────────────

test('rotateConfigBackups：首次保存（无当前配置）不产生备份，轮换 bak-3←bak-2←bak-1←当前', () => {
  const specConfig = path.join(dshHome, 'rotate-spec.yml')
  process.env.DSH_PAODING_CONFIG = specConfig
  try {
    // 无「当前」：一个字节都不写，清单恒空
    assert.equal(apiCore.rotateConfigBackups(), false, '无当前配置 → 不备份')
    assert.equal(apiCore.listConfigBackups().length, 0)

    // 四轮写入 + 轮换：v1 被淘汰，活下来的三层 = v4/v3/v2（新→旧）
    const versions = ['v1', 'v2', 'v3', 'v4']
    for (const v of versions) {
      writeFileSync(specConfig, v + '\n', 'utf8')
      assert.equal(apiCore.rotateConfigBackups(), true)
    }
    const layer = (n) => readFileSync(`${specConfig}.bak-${n}`, 'utf8')
    assert.equal(layer(1), 'v4\n', 'bak-1 = 最新一轮的当前配置')
    assert.equal(layer(2), 'v3\n')
    assert.equal(layer(3), 'v2\n', 'bak-3 = 三轮前的快照')
    assert.ok(!existsSync(`${specConfig}.bak-4`), '只保留三层，更老的一律淘汰')
    // 当前文件原地保留（拷贝进 bak-1，不是改名挪走）
    assert.equal(readFileSync(specConfig, 'utf8'), 'v4\n', '当前文件轮换后原样保留')

    // 清单：新→旧排序，形状 { file, mtimeMs, size }
    const list = apiCore.listConfigBackups()
    assert.deepEqual(list.map((b) => b.file), [
      'rotate-spec.yml.bak-1',
      'rotate-spec.yml.bak-2',
      'rotate-spec.yml.bak-3',
    ], '清单按新→旧排序')
    for (const b of list) {
      assert.deepEqual(Object.keys(b).sort(), ['file', 'mtimeMs', 'size'], '清单条目三字段')
      assert.equal(typeof b.mtimeMs, 'number')
      assert.equal(typeof b.size, 'number')
    }
  } finally {
    process.env.DSH_PAODING_CONFIG = configFile
  }
})

// ── GET config/backups / POST config/restore（路由级契约）─────────────────────

const CFG_A = [
  '# A 版配置',
  'profile: web',
  'main_agent_display_name: 甲版主控',
  'roles_remove:',
  '  - design',
  'roles:',
  '  implement:',
  '    tools:',
  '      - read',
].join('\n') + '\n'
const CFG_B = [
  '# B 版配置',
  'profile: web',
  'main_agent_display_name: 乙版主控',
  'roles_remove:',
  '  - design',
].join('\n') + '\n'

test('backups 路由：200 { ok, backups }，按新→旧返回；restore 成功路径：验名 → 备当前 → 落快照', async () => {
  // 清掉前序用例（import 落盘前的自动轮换）留下的备份，保证本用例从零造历史
  for (const n of [1, 2, 3]) rmSync(`${configFile}.bak-${n}`, { force: true })
  // 造两层历史：当前=A → 轮换（bak-1=A）；当前=B → 轮换（bak-1=B, bak-2=A）
  writeFileSync(configFile, CFG_A, 'utf8')
  apiCore.rotateConfigBackups()
  writeFileSync(configFile, CFG_B, 'utf8')
  apiCore.rotateConfigBackups()

  // 清单路由：纯读不写
  const list1 = await callRoute(handlerOf(), '/api/paoding/config/backups')
  assert.equal(list1.status, 200)
  assert.equal(list1.json.ok, true)
  assert.deepEqual(list1.json.backups.map((b) => b.file), [
    'dsh-paoding.config.yml.bak-1',
    'dsh-paoding.config.yml.bak-2',
  ], '新→旧：bak-1（B）在前')
  assert.equal(readFileSync(configFile, 'utf8'), CFG_B, '清单绝不改写配置文件')

  // 回滚到 bak-2（A 版）：200 { ok: true }，配置回到 A，且「当前 B」被推入 bak-1
  await apiCore.getState() // 预热缓存，让下方 mtime 失效断言不依赖内部刷新
  assert.equal(apiCore.isStateCacheStale(), false, '前提：缓存新鲜')
  const r = await callRoute(handlerOf(), '/api/paoding/config/restore', {
    body: { file: 'dsh-paoding.config.yml.bak-2' },
  })
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, { ok: true })
  assert.equal(readFileSync(configFile, 'utf8'), CFG_A, '配置内容回到选定快照（A 版）')
  assert.equal(readFileSync(`${configFile}.bak-1`, 'utf8'), CFG_B, '回滚前的当前配置（B）先推入 bak-1')
  // 轮换链整体后移一层：bak-1(B)→bak-2、原 bak-2(A)→bak-3，再拷当前(B)进 bak-1
  assert.equal(readFileSync(`${configFile}.bak-2`, 'utf8'), CFG_B, '轮换后 bak-2 = 原 bak-1（B）')
  assert.equal(readFileSync(`${configFile}.bak-3`, 'utf8'), CFG_A, '轮换后 bak-3 = 原 bak-2（A）')
  assert.equal(apiCore.isStateCacheStale(), true, '回滚落盘改 mtime，state 缓存按对账自动失效')
})

test('restore 拒绝路径：穿越 / 非法层号 / 非字符串 → 422；不存在 → 404；坏备份 → 422，均不写盘', async () => {
  const before1 = readFileSync(configFile, 'utf8')
  // 文件名白名单：分隔符、上跳段、层号越界、类型不对一律 422
  for (const bad of ['../evil.yml', 'sub/dir.yml', '..', 'dsh-paoding.config.yml.bak-9', 'dsh-paoding.config.yml', '']) {
    const r = await callRoute(handlerOf(), '/api/paoding/config/restore', { body: { file: bad } })
    assert.equal(r.status, 422, `非法名应 422：${JSON.stringify(bad)}`)
    assert.match(r.json.error, /备份文件名不合法/)
  }
  {
    const r = await callRoute(handlerOf(), '/api/paoding/config/restore', { body: { file: 123 } })
    assert.equal(r.status, 422, '非字符串 file 一律 422')
  }
  assert.equal(readFileSync(configFile, 'utf8'), before1, '拒绝路径不写盘')
  assert.ok(!existsSync(`${configFile}.bak-4`), '拒绝路径也不产生新备份')

  // 层号合法但备份不存在 → 404（用自定义配置名的空备份钉这条：主配置名的
  // bak-1/2/3 都已在前序用例里真实存在）
  process.env.DSH_PAODING_CONFIG = absentConfig
  try {
    const r = await callRoute(handlerOf(), '/api/paoding/config/restore', {
      body: { file: 'absent-export.yml.bak-1' },
    })
    assert.equal(r.status, 404, '合法名但备份文件不存在 → 404')
    assert.match(r.json.error, /备份不存在/)
  } finally {
    process.env.DSH_PAODING_CONFIG = configFile
  }

  // 坏备份（顶层是列表，非映射）→ 422，不写盘
  writeFileSync(`${configFile}.bak-3`, '- a\n- b\n', 'utf8')
  {
    const r = await callRoute(handlerOf(), '/api/paoding/config/restore', {
      body: { file: 'dsh-paoding.config.yml.bak-3' },
    })
    assert.equal(r.status, 422, '备份解析不出顶层映射 → 拒绝回滚')
    assert.match(r.json.error, /备份无法解析/)
    assert.equal(readFileSync(configFile, 'utf8'), before1, '坏备份绝不覆盖当前配置')
  }
})

test('import 写盘前自动轮换备份：落盘前当前配置进 bak-1', async () => {
  const pre = '# 导入前快照\nprofile: web\nmain_agent_display_name: 导入前主控\n'
  writeFileSync(configFile, pre, 'utf8')
  apiCore.rotateConfigBackups() // bak-1 = pre
  const r = await callRoute(handlerOf(), '/api/paoding/config/import', {
    body: { content: '# 导入版\nprofile: web\nmain_agent_display_name: 导入后主控\n' },
  })
  assert.equal(r.status, 200)
  assert.equal(readFileSync(`${configFile}.bak-1`, 'utf8'), pre, '导入落盘前的当前配置被推入 bak-1')
  assert.match(readFileSync(configFile, 'utf8'), /导入后主控/, '导入内容正常落盘')
})

// ── diffAssignments：目标字段差分纯函数（各维度）──────────────────────────────

test('diffAssignments：恒等 → changed=false 全空；extra/remove 增删汇入主 agent 工具增删', () => {
  // 恒等（含两侧同引用与两侧各自规范化后等价两种形态）
  const same = diffAssignments({}, {})
  assert.equal(same.changed, false)
  assert.deepEqual(same, {
    changed: false,
    mainAgent: { toolsAdded: [], toolsRemoved: [], personaChanged: false, modelChanged: false, skillsChanged: false },
    roles: [],
    rolesRemove: { added: [], removed: [] },
    mainExtra: { added: [], removed: [] },
  })

  // extra 增 + remove 撤销（read 从 remove 名单撤下，恢复可用）= 工具增加；
  // extra 删 + remove 新增 = 工具减少
  const d = diffAssignments(
    { main_agent_extra: ['keep', 'gone'], main_agent_remove: ['read'] },
    { main_agent_extra: ['keep', 'new1'], main_agent_remove: ['bash'] },
  )
  assert.deepEqual(d.mainExtra, { added: ['new1'], removed: ['gone'] })
  assert.deepEqual(d.mainAgent.toolsAdded, ['new1', 'read'], 'extra 新增 + remove 撤销都算工具增加')
  assert.deepEqual(d.mainAgent.toolsRemoved, ['gone', 'bash'], 'extra 删除 + remove 新增都算工具减少')
  assert.equal(d.changed, true)

  // persona（null → 文本）变化；主 agent modelChanged 恒 false（无专用模型键）
  const p = diffAssignments({}, { main_agent_persona_extra: '追加句' })
  assert.equal(p.mainAgent.personaChanged, true)
  assert.equal(p.mainAgent.modelChanged, false)
  assert.equal(p.changed, true)
})

test('diffAssignments：技能三维（skills 映射 / 主 agent 软硬引用）任一变化即 skillsChanged', () => {
  assert.equal(diffAssignments({}, { skills: { caveman: ['implement'] } }).mainAgent.skillsChanged, true)
  assert.equal(diffAssignments({}, { main_agent_skills: ['caveman'] }).mainAgent.skillsChanged, true)
  assert.equal(diffAssignments({}, { main_agent_skills_inline: ['caveman'] }).mainAgent.skillsChanged, true)
  // 列表按集合语义对比（与 extra / 角色工具同口径）：换序不算变化，增删才算
  assert.equal(diffAssignments({ main_agent_skills: ['a', 'b'] }, { main_agent_skills: ['b', 'a'] }).mainAgent.skillsChanged, false)
  assert.equal(diffAssignments({ main_agent_skills: ['a', 'b'] }, { main_agent_skills: ['b', 'c'] }).mainAgent.skillsChanged, true)
  assert.equal(diffAssignments({ skills: { s: ['implement'] } }, { skills: { s: ['implement'] } }).mainAgent.skillsChanged, false)
})

test('diffAssignments：角色按名对齐（新增 / 删除 / 变更六维度），roles_remove 增删', () => {
  const d = diffAssignments(
    {
      roles: {
        implement: { tools: ['read', 'write'], model: null, persona: null, start_mode: 'fresh', background_mode: 'one-shot' },
        search_external: { tools: ['read'] },
        gone_role: { tools: ['read'] },
      },
      roles_remove: ['design'],
    },
    {
      roles: {
        implement: { tools: ['read'], model: 'deepseek-reasoner', persona: '自定义', start_mode: 'fork', background_mode: 'continuable' },
        search_external: { tools: ['read', 'grep'], provider: 'pi-ai' },
        new_role: { tools: ['read'] },
      },
      roles_remove: ['design', 'search_external'],
    },
  )
  const byName = Object.fromEntries(d.roles.map((r) => [r.name, r]))
  assert.deepEqual(byName.implement, {
    name: 'implement',
    op: 'changed',
    toolsAdded: [],
    toolsRemoved: ['write'],
    personaChanged: true,
    modelChanged: true,
    startModeChanged: true,
    backgroundModeChanged: true,
  }, '变更条目带全部六维')
  assert.deepEqual(byName.search_external, {
    name: 'search_external',
    op: 'changed',
    toolsAdded: ['grep'],
    toolsRemoved: [],
    personaChanged: false,
    modelChanged: true, // 仅 provider 变化也归模型维度（LLM 路由成对生效）
    startModeChanged: false,
    backgroundModeChanged: false,
  }, '未变的维度必须是 false / 空表，缺角色显示为新增')
  assert.deepEqual(byName.new_role, { name: 'new_role', op: 'added' }, '新增只带 name + op')
  assert.deepEqual(byName.gone_role, { name: 'gone_role', op: 'removed' }, '删除只带 name + op')
  assert.deepEqual(d.rolesRemove, { added: ['search_external'], removed: [] })
  assert.equal(d.changed, true)

  // 无任何变化的角色不出现在结果里
  const quiet = diffAssignments(
    { roles: { implement: { tools: ['read'] } } },
    { roles: { implement: { tools: ['read'] } } },
  )
  assert.deepEqual(quiet.roles, [])
  assert.equal(quiet.changed, false)
})

test('diffAssignments：旧值为 null（无磁盘配置）全算新增；profile / workspaces 段不参与对比', () => {
  const d = diffAssignments(null, {
    profile: 'desktop',
    workspaces: { '/tmp/x': { roles_remove: ['design'] } },
    main_agent_extra: ['mcp__tavily__search'],
    roles: { implement: { tools: ['read'] } },
  })
  assert.deepEqual(d.mainExtra.added, ['mcp__tavily__search'])
  assert.deepEqual(d.roles, [{ name: 'implement', op: 'added' }])
  assert.equal(d.changed, true)
  // profile / workspaces 不在对比维度：两侧只差这两键 = 无变化
  const onlyContainers = diffAssignments(
    { profile: 'web', workspaces: { '/tmp/a': {} } },
    { profile: 'desktop', workspaces: { '/tmp/b': {} } },
  )
  assert.equal(onlyContainers.changed, false)
})

// ── slimStatsOf：工具面瘦身统计口径（合成 state，原始通道与序列化视图两态）────

const SLIM_STATE_RAW = {
  restrictBase: ['read', 'bash', 'web_search'],
  blocks: new Map([['implement', { names: ['write', 'edit'] }]]),
  inventory: new Set(['mcp__tavily__search']),
}

test('slimStatsOf：total = presetUniverse ∪ inventory 全集；main 与 computeRestrictAllow 同口径', () => {
  // total = 3（base）+ 2（角色块 write/edit，web_search 已在 base）+ 1（检测库存）= 6
  assert.equal(slimStatsOfStub_total(), 6)
  // 空配置：main = base 三件全可用（都在 presetUniverse）
  assert.deepEqual(slimStatsOfStub_stats({}), { total: 6, main: 3 })
  // extra：可用的 MCP 工具计入（inventory 在场），幽灵名（不在 preset 面、不在
  // 检测库存）不算；remove 生效
  assert.deepEqual(
    slimStatsOfStub_stats({ main_agent_extra: ['mcp__tavily__search', 'ghost_tool'], main_agent_remove: ['web_search'] }),
    { total: 6, main: 3 },
  )
  // 自定义角色名直通计入主 allow（与生成口径一致：自定义角色委派行必须可达）；
  // total 不含自定义角色名——它是「preset 自带面 ∪ 检测库存」的工具名全集
  assert.deepEqual(
    slimStatsOfStub_stats({ roles: { my_custom: { tools: ['read'] } } }),
    { total: 6, main: 4 },
  )
})

function slimStatsOfStub_total() {
  return apiCore.slimStatsOf(SLIM_STATE_RAW, {}).total
}
function slimStatsOfStub_stats(assignments) {
  return apiCore.slimStatsOf(SLIM_STATE_RAW, assignments)
}

test('slimStatsOf：序列化视图形态（blocks 普通对象 / inventory 数组）与原始通道同口径', () => {
  const view = { restrictBase: ['read'], blocks: { implement: ['write'] }, inventory: ['mcp__t__x'] }
  assert.deepEqual(apiCore.slimStatsOf(view, {}), { total: 3, main: 1 })
  // 无配置（existing null）按空目标字段算：main = base 可用名数
  assert.deepEqual(apiCore.slimStatsOf(view, null), { total: 3, main: 1 })
})

// ── POST preview 响应附带 diff 与 slim（路由级增量字段契约）───────────────────

test('preview：200 响应带 diff（相对磁盘现配置）与 slim（按提交 assignments）', async () => {
  // 磁盘现配置带 roles_remove: [design]；提交空目标字段 → diff 应报出该差异
  writeFileSync(configFile, CFG_A, 'utf8')
  const r = await callRoute(handlerOf(), '/api/paoding/preview', {
    body: { assignments: normalizeTargetFields({}) },
  })
  assert.equal(r.status, 200, `preview 应成功：${r.json?.error ?? ''}`)
  assert.equal(r.json.diff.changed, true)
  assert.deepEqual(r.json.diff.rolesRemove.removed, ['design'], 'diff 旧值 = 磁盘真实内容（非缓存）')
  assert.deepEqual(r.json.diff.mainExtra, { added: [], removed: [] })
  // slim：total = 可用工具全集（>0），main = 本次提交（空目标字段）下的有效 allow
  assert.equal(typeof r.json.slim.total, 'number')
  assert.ok(r.json.slim.total > 0)
  assert.ok(r.json.slim.main > 0)
  assert.ok(r.json.slim.main <= r.json.slim.total, 'main 恒不大于 total')
  // 纯增量：既有字段原样保留
  assert.equal(r.json.dryRun, true)
  assert.equal(Array.isArray(r.json.warnings), true)
})
