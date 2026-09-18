/**
 * paoding-config-ui — DSH Web 插件 (cordis)
 *
 * 把 dsh-paoding 可视化配置器整合进 DSH Web GUI（左侧栏全页配置，无独立服务端）：
 *   - Node 侧：注册 /api/paoding/* 前缀路由（state/models/workspaces/version/
 *     upgrade/preview/apply/rescan + client.css 静态样式），经
 *     ./api-core.mjs 复用 tools/install.mjs 的检测与生成管线；workspaces 直连
 *     宿主 workspaceRegistry 服务（list / create，幂等）；version
 *     复用 tools/lib/version.mjs 的版本检测（npm registry 优先、GitHub release
 *     兜底）；upgrade 经 tools/lib/upgrade.mjs spawn `dsh plugin update` 完成
 *     一键升级。首装 / 升级后 preset 自动重生成（ensurePresetInstalled，等价
 *     install --auto 语义）在路由注册完成后异步触发，不阻塞启动。
 *   - Client 侧：lib/client.js 在左侧栏「新会话」下方注入「庖丁配置」入口，
 *     点击后在会话中栏打开全页配置 overlay（data-dsh-paoding-active）。
 *
 * 挂载（~/.dsh/cordis.patch.yml）:
 *   - id: paoding-config-ui
 *     name: dsh-paoding   # 指向 pnpm 装进 profile 的本包（与 cordis.patch.yml 一致）
 *
 * 借鉴 dsh-better-sidebar 的机制（详见其 docs/plans 与 AGENTS.md）：
 *   - 客户端 bundle 以 window.__ModuleLoader__.load({id, factory}) 注册，由
 *     dsh-client-modules 节点半扫描 dsh.client 声明并以 /plugins/<id>/client.js
 *     下发；bundle 的注册 id 必须等于包名（图行 id）。
 *   - 全页配置页不走宿主槽位：入口经 DOM 注入 + MutationObserver 自愈挂到
 *     侧栏（与 dsh-mnemon 同款 sidebar 模式），overlay 容器挂到会话中栏，
 *     打开态由 html[data-dsh-paoding-active] 驱动，与其它全页面板互斥。
 *   - 宿主路由自带信任围栏：/api/paoding 长于 /api 前缀，webserver 最长前缀
 *     优先会命中本插件而绕过 /api 网关的围栏，故在此复刻同一围栏语义
 *     （Host 回环或 webRuntime.trustedHosts，拒绝 cross-site 浏览器请求）。
 */
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getState, refreshState, isStateCacheStale, serializeState, installAssignments, resolveDshHome, discoverWorkspaceCandidates, ensurePresetInstalled, pluginVersion } from './api-core.mjs'
import { detectSkills } from '../../tools/lib/skills.mjs'
import { collectRuntimeFacts } from './runtime-inventory.mjs'
import { getVersionInfo } from '../../tools/lib/version.mjs'
import { runUpgrade } from '../../tools/lib/upgrade.mjs'

export const name = 'paoding-config-ui'

// 挂载形态判定（version 路由的 layout 字段，供客户端确认框分流文案；不放进
// 共享的 version.mjs——CLI 不需要这个概念，路由层合并即可）：
//   dev       → 插件包根（本文件向上两级）含 .git，即开发检出、`dsh plugin
//               add link:<仓库绝对路径>` 直连本仓库；无法就地升级（upgrade
//               会拒绝并提示手动 dsh plugin add dsh-paoding@latest 切到
//               registry 版本）。
//   installed → registry 版本（插件通道 pnpm 安装进 profile），升级原地换版本。
const MOUNT_LAYOUT = existsSync(new URL('../../.git', import.meta.url)) ? 'dev' : 'installed'
// llm：宿主模型运行时服务（DSH ≥ 0.1.6 取代旧 apiProxy.llm）——models 路由
// 经 ctx.llm.listProviders() + listModels(provider) 取已注册的模型目录
//（设置页模型选择器同款目录，JSON-safe 纯对象；失败组在 failures 里，不抛错）。
// workspaceRegistry：宿主工作区注册表（list / resolveByPath / create）。
export const inject = ['webServer', 'llm', 'workspaceRegistry']

// ── 浏览器信任围栏（复刻 dsh-client-connection 的 /api 网关围栏语义，
//    参考 dsh-better-sidebar/src/trust-fence.ts，BSD-3-Clause 同源实现）──────

function header(headers, name) {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority) {
  try { return new URL(`http://${authority}`) } catch { return undefined }
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/** Host 头是否落在部署信任列表（精确 host:port 或裸 hostname）。 */
function isTrustedAuthority(hostUrl, trustedHosts) {
  return (trustedHosts ?? []).some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return entryUrl.port === ''
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/** DNS-rebinding / cross-site 防御（非认证）：Host 回环或受信 + 非 cross-site。 */
function isTrustedApiRequest(req, trustedHosts) {
  const host = header(req.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(req.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(req.headers, 'origin')
  if (origin === undefined) return true
  try { return new URL(origin).hostname === hostUrl.hostname } catch { return false }
}

/** Read a JSON request body (bounded). 失败错误带 statusCode（413/400），
 *  外层 catch 据此回对应状态码；客户端提前断开时 reject（Promise 已 settled
 *  则 reject 为 no-op，正常完成后的 close 事件同样无害）。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 5 * 1024 * 1024) {
        const err = new Error('request body too large')
        err.statusCode = 413
        reject(err)
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        const err = new Error('invalid JSON body')
        err.statusCode = 400
        reject(err)
      }
    })
    req.on('error', reject)
    req.on('close', () => reject(new Error('request closed before body completed')))
    req.on('aborted', () => reject(new Error('request aborted')))
  })
}

function json(res, status, payload) {
  const text = JSON.stringify(payload, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

// ── 对外错误信息脱敏（home 目录 / 插件安装根 → ~）───────────────────────────
// 错误原文（可能带本机绝对路径）只进日志；回给浏览器的 message 先过这里。

const SANITIZE_HOME_DIR = os.homedir()
const SANITIZE_PLUGIN_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]+$/, '')

function sanitizeMessage(message) {
  let text = String(message ?? '')
  // 先长后短：安装根通常是 home 的子路径，先替换更具体的
  text = text.split(SANITIZE_PLUGIN_ROOT).join('~')
  text = text.split(SANITIZE_HOME_DIR).join('~')
  return text
}

// ── 首装 / 升级后 preset 自动重生成（启动钩子）──────────────────────────────

// 进程级防抖：每次插件 apply 至多触发一次自愈（防未来的热重载 / 多次 apply
// 重复跑全量检测 + 落盘）。
let presetEnsureStarted = false

/** 路由注册完成后异步触发 preset 自愈（不 await、不阻塞启动；结果只进日志）。
 *  isDisposed：dispose 探针——ensurePresetInstalled 在各 await 点后检查，
 *  插件卸载后在途的生成不再继续写盘。 */
function triggerPresetEnsure(ctx, isDisposed) {
  if (presetEnsureStarted) return
  presetEnsureStarted = true
  const generatorVersion = pluginVersion()
  // ensurePresetInstalled 自身绝不抛；.catch 只是防御性兜底。
  ensurePresetInstalled({ dshHome: resolveDshHome(), generatorVersion, shouldAbort: isDisposed })
    .then((r) => {
      if (r.installed) {
        ctx.logger?.info?.(
          `paoding-config-ui: orchestrator preset 已重生成（generator v${generatorVersion}，${r.reason}）`,
        )
      } else if (r.error) {
        // 失败复位防抖闩：下次 activate（热重载 / 重注册）可重试
        presetEnsureStarted = false
        ctx.logger?.warn?.(`paoding-config-ui: preset 自动生成失败（可在 设置 → 庖丁配置 手动应用）: ${r.error}`)
      }
      // 版本一致的常规跳过不打日志：每次启动都刷一行纯噪音。
    })
    .catch((err) => {
      presetEnsureStarted = false
      ctx.logger?.warn?.('paoding-config-ui: preset 自动生成异常: ' + String(err?.message ?? err))
    })
}

// ── persistence 探测（可续子代理的前置条件，只喂面板警告，不拦 preview/apply）──
//
// DSH 的可续（continuable）子代理要求 host 同时提供 sessionPersistence 与
// sessionQuery 两个服务，缺一个委派就直接报 PERSISTENCE_UNAVAILABLE /
// CONTINUATION_UNAVAILABLE。此处做免 inject 的安全探测：cordis 的
// ctx.reflect.get(name, false) 读不到返回 undefined，也不触发 inject 护栏
//（ctx[name] 直取才会抛）；整个探测 try/catch 兜底，任何异常一律按「不可用」
// 处理——false 只影响面板警告文案的显隐。
function persistenceAvailableOf(ctx) {
  try {
    const reflect = ctx.reflect
    if (!reflect || typeof reflect.get !== 'function') return false
    return !!(reflect.get('sessionPersistence', false) && reflect.get('sessionQuery', false))
  } catch {
    return false
  }
}

/** 面板 state 响应统一挂 persistenceAvailable（state / rescan 同一形状）。 */
function stateResponse(ctx, state) {
  return { ...state, persistenceAvailable: persistenceAvailableOf(ctx) }
}

// ── state 读取共享 helper（「采集运行时事实 → 重刷 → 读缓存 →〔按需〕序列化」）──

// in-flight 去重：全量检测进行中时并发请求共用同一次采集（并发 GET state 只
// 跑一次检测，不重复重握手 MCP）。检测本身不抛（collectRuntimeFacts /
// refreshState 均自捕），promise 不会 reject。
let stateDetectInFlight = null

/**
 * 取原始 state（给生成管线 installAssignments / generateAndInstall 用的原始
 * state 通道：Set/Map/dstDir/yamlMod 原样，绝不能过 serializeState——JSON
 * 视图会丢 dstDir/yamlMod、Set→排序数组、Map→普通对象，喂进生成管线必炸
 * TypeError，apply/preview 一律 422；契约由 tests/api-apply.test.mjs 钉死）。
 * 缓存命中且配置文件 mtime 未变（外部 CLI / 手编改动检测）时直接返回缓存；
 * 否则（缓存缺失 / 已失效 / force）带实时运行时事实做一次全量检测再返回。
 * state 首刷 / rescan / apply 前后共三处走这一条路径（前两处再过序列化层）。
 */
async function rawStateWithRuntimeFacts(ctx, { force = false } = {}) {
  if (!force && !isStateCacheStale()) return getState()
  stateDetectInFlight ??= (async () => {
    const facts = await collectRuntimeFacts(ctx)
    await refreshState(facts)
  })()
  try {
    await stateDetectInFlight
  } finally {
    stateDetectInFlight = null
  }
  return getState()
}

/** 取面板 state（浏览器 JSON 视图）：原始 state 过 serializeState 的序列化层。 */
async function stateWithRuntimeFacts(ctx, { force = false } = {}) {
  return serializeState(await rawStateWithRuntimeFacts(ctx, { force }))
}

// apply in-flight 闸（模块级）：apply 落盘期间再来的 apply 直接 409，防并发写配置。
let applyInFlight = false

export function apply(ctx) {
  const { webServer } = ctx
  // dispose 探针：插件卸载后，在途异步任务（preset 自愈）不得再写盘。
  let disposed = false
  // webRuntime 由 dsh-web-app 的 web-runtime 行提供；非 web 部署下缺失时退化为
  // 仅回环信任（每次请求读实时值，trustedHosts 变化无需重启插件）。读取自捕：
  // 围栏检查不能以 unhandled rejection 收场（读不到按空信任表继续）。
  const trustedHostsOf = () => {
    try { return ctx.get('webRuntime')?.trustedHosts ?? [] } catch { return [] }
  }

  const disposer = webServer.register({
    kind: 'prefix',
    path: '/api/paoding',
    handler: async (req, res) => {
      if (!isTrustedApiRequest(req, trustedHostsOf())) {
        json(res, 403, { error: 'forbidden' })
        return
      }
      const url = new URL(req.url, 'http://dsh.internal')
      const route = url.pathname.replace(/^\/api\/paoding\/?/, '')

      try {
        // ── 静态样式：面板 CSS 正文（lib/base.css）─────────────────────────
        // 客户端 mountCss 只注入 <link href="/api/paoding/client.css">，正文
        // 由此按请求现读——改 base.css 无需重启插件，GUI 刷新即生效（响应带
        // no-cache）。落在同前缀信任围栏内（上方 isTrustedApiRequest 已把关）。
        if (route === 'client.css' && req.method === 'GET') {
          try {
            const css = await readFile(new URL('./lib/base.css', import.meta.url), 'utf8')
            res.writeHead(200, {
              'content-type': 'text/css; charset=utf-8',
              'content-length': Buffer.byteLength(css),
              'cache-control': 'no-cache',
            })
            res.end(css)
          } catch (err) {
            ctx.logger?.warn?.('paoding-config-ui: client.css read failed: ' + String(err?.message ?? err))
            json(res, 500, { error: sanitizeMessage(`client.css unavailable: ${err.message}`) })
          }
          return
        }

        if (route === 'state' && req.method === 'GET') {
          // 缓存命中且配置文件 mtime 未变直接返回；缓存缺失 / 外部（CLI/手编）
          // 改过配置时带实时运行时事实做一次全量检测（成本同旧版首次 GET）。
          // 运行时注册表只在 DSH 重启/插件启停时变化，没必要每次打开面板都重
          // 握手 MCP；mtime 对账保证外部改动不视而不见。并发请求共用同一次
          // 检测（stateWithRuntimeFacts 去重）。响应附带 persistenceAvailable
          //（sessionPersistence + sessionQuery 双服务在场的免 inject 探测，
          // 面板据此显隐可续模式的警告；缺失只警告，preview/apply 不拦截）。
          json(res, 200, stateResponse(ctx, await stateWithRuntimeFacts(ctx)))
          return
        }

        if (route === 'models' && req.method === 'GET') {
          // 模型目录：DSH 设置页模型选择器同款目录（deepseek-official 三模型、
          // pi-ai 各路由等），JSON-safe 纯对象。与 state 缓存无关，每次实调——
          // 目录发现可能稍慢，属正常。失败组在 failures 里，不抛错；这里自捕
          // 一层，保证错误也走 { ok: false, error } 形状（外层 catch 是 { error }）。
          try {
            // ctx.llm（DSH ≥ 0.1.6 的宿主模型运行时）：listProviders() 给已注册
            // 适配器的 provider 路由（{ id, ... }），listModels(provider) 给该
            // 路由的目录（{ provider, id, name, ... }）。逐 provider 并发实调
            // 映射成客户端的 groups 形状（group.id = provider 路由 id）；单路由
            // 失败隔离记入 failures 不抛错，与旧 apiProxy 时代的容错语义一致。
            const providers = ctx.llm.listProviders()
            const failures = []
            const results = await Promise.all((Array.isArray(providers) ? providers : []).map(async (provider) => {
              const id = provider && typeof provider.id === 'string' ? provider.id : null
              if (!id) return null
              try {
                const models = await ctx.llm.listModels(id)
                return {
                  id,
                  name: provider.name || provider.displayName || id,
                  models: (Array.isArray(models) ? models : [])
                    .filter((m) => m && typeof m.id === 'string' && m.id !== '')
                    .map((m) => ({ id: m.id, name: m.name || m.id })),
                }
              } catch (err) {
                failures.push(`${id}: ${err.message}`)
                return null
              }
            }))
            json(res, 200, { ok: true, groups: results.filter(Boolean), failures })
          } catch (err) {
            json(res, 500, { ok: false, error: err.message })
          }
          return
        }

        if (route === 'workspaces' && req.method === 'GET') {
          // 按工作区拉技能（?skills=1&path=<urlencoded 绝对路径>）：技能扫描
          // 不跟随 GUI 进程启动目录后，客户端工作区视角的技能网格由此取数——
          // 用户级两根恒扫（detectSkills(dshHome, null)），项目级两根按 path
          // 显式追加；projectSkills = 全集里不在用户级的部分（该项目根独有）。
          // path 缺失 / 空值 422；目录不存在不报错——detectSkills 自己跳过
          // 缺失根，项目集自然为空。下方无参 / discover 分支行为不动。
          if (url.searchParams.get('skills') === '1') {
            const wsPath = url.searchParams.get('path')
            if (typeof wsPath !== 'string' || wsPath.trim() === '') {
              json(res, 422, { error: '缺少工作区目录绝对路径（query.path）' })
              return
            }
            const dshHome = resolveDshHome()
            const userSkills = detectSkills(dshHome, null)
            const all = detectSkills(dshHome, wsPath)
            const userSet = new Set(userSkills)
            const projectSkills = all.filter((s) => !userSet.has(s))
            json(res, 200, { ok: true, skills: all, projectSkills })
            return
          }
          // 候选发现（?discover=1）：给「添加工作区」组合框供候选——扫已知工作区
          // 路径的父目录与 home 一层里带项目标记（.git / .codegraph / package.json）
          // 的目录，已在注册表 / 配置里的不再建议。两路数据源都允许失败：宿主注册
          // 表拉不到就当空注册表继续扫，配置键取 getState() 失败也按空数组继续，
          // discovery 不因此 5xx；只有扫描本身出错才 500（客户端届时静默降级纯手输）。
          if (url.searchParams.get('discover') === '1') {
            let registryPaths = []
            try {
              // workspaceRegistry.list() 同步返回注册表实体（{ id, path, ... }）
              registryPaths = ctx.workspaceRegistry.list()
                .map((w) => (w && typeof w.path === 'string' && w.path !== '' ? w.path : null))
                .filter(Boolean)
            } catch { /* 注册表不可用：按空名单继续发现 */ }
            let configPaths = []
            try {
              const s = await getState()
              configPaths = Object.keys((s.existing && s.existing.workspaces) || {})
            } catch { /* 状态缓存不可用：按无配置工作区继续 */ }
            try {
              json(res, 200, { ok: true, items: discoverWorkspaceCandidates({ registryPaths, configPaths }) })
            } catch (err) {
              json(res, 500, { ok: false, error: err.message })
            }
            return
          }
          // 工作区列表：宿主 workspaceRegistry（同步 list），精简成 UI 需要的
          // { workspaceId, path, title, sessionCount }。失败 500 + ok:false
          //（客户端 api 助手对非 2xx 一律 throw，面板据此降级为只用配置文件里
          // 的工作区键，不阻塞使用）。
          try {
            const items = ctx.workspaceRegistry.list()
            json(res, 200, {
              ok: true,
              items: items.map((w) => ({
                workspaceId: w?.id,
                path: w?.path,
                title: w?.title ?? null,
                sessionCount: Array.isArray(w?.sessionIds) ? w.sessionIds.length : 0,
              })),
            })
          } catch (err) {
            json(res, 500, { ok: false, error: err.message })
          }
          return
        }

        if (route === 'workspaces' && req.method === 'POST') {
          // 注册工作区（宿主 workspace.create 幂等：已注册原样返回 created:false）。
          // 只收非空字符串路径；创建成功后把归一后的 path/title 回给客户端，
          // UI 直接切到该工作区。
          const body = await readBody(req)
          const wsPath = typeof body.path === 'string' ? body.path.trim() : ''
          if (wsPath === '') {
            json(res, 422, { error: '缺少工作区目录绝对路径（body.path）' })
            return
          }
          // 存在预检：调宿主 create 之前先确认路径真实存在且是目录——坏路径
          // 不必劳宿主一趟（create 幂等语义也可能把不存在的路径照单全收），
          // 这里一句中文报错直给客户端，落 wsAddErr 展示。
          let wsStat = null
          try { wsStat = statSync(wsPath) } catch { /* 不存在：stat 抛错，落到下方 422 */ }
          if (!wsStat || !wsStat.isDirectory()) {
            json(res, 422, { error: `目录不存在或不是目录：${wsPath}` })
            return
          }
          try {
            // 与宿主 WorkspaceCommands.create 同款幂等语义：先 resolveByPath
            // 查重，已注册原样返回 created:false，否则 create 新建。
            const existing = await ctx.workspaceRegistry.resolveByPath(wsPath)
            const workspace = existing !== undefined ? existing : await ctx.workspaceRegistry.create(wsPath)
            json(res, 200, {
              ok: true,
              // path 以宿主返回的归一路径为准；title 宿主会兜底成 basename。
              workspace: {
                path: typeof workspace.path === 'string' && workspace.path !== '' ? workspace.path : path.normalize(path.resolve(wsPath)),
                title: typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : null,
              },
              created: existing === undefined,
            })
          } catch (err) {
            json(res, 500, { ok: false, error: err.message })
          }
          return
        }

        if (route === 'rescan' && req.method === 'POST') {
          // 重新检测 = 无视缓存强制带实时运行时事实重刷一次再返回
          //（getState 不再自己重刷；与其他请求并发时共用同一次检测）。
          // 与 state 同款挂 persistenceAvailable，客户端 setData 两处同形状。
          json(res, 200, stateResponse(ctx, await stateWithRuntimeFacts(ctx, { force: true })))
          return
        }

        if ((route === 'preview' || route === 'apply') && req.method === 'POST') {
          const body = await readBody(req)
          const dryRun = route === 'preview'
          // apply in-flight 闸（预览无写副作用不受限）：落盘期间重复 apply 直接
          // 409，防并发写配置文件。
          if (!dryRun && applyInFlight) {
            json(res, 409, { error: '已有一次应用（apply）正在进行，请稍后重试' })
            return
          }
          if (!dryRun) applyInFlight = true
          try {
            // 可选工作区定位：body.workspace 非空字符串时归一成绝对路径，为该
            // 工作区生成独立 preset（orchestrator-<slug>）并把条目并进配置
            // workspaces 段；缺省 / null = 全局（现状行为）。
            const rawWorkspace = typeof body.workspace === 'string' ? body.workspace.trim() : ''
            const workspacePath = rawWorkspace === '' ? null : path.normalize(path.resolve(rawWorkspace))
            // 工作区预检：与 POST /workspaces 同款 statSync+isDirectory——坏路径
            // 不劳生成管线一趟，直接 422。
            if (workspacePath !== null) {
              let wsStat = null
              try { wsStat = statSync(workspacePath) } catch { /* 不存在：stat 抛错，落到下方 422 */ }
              if (!wsStat || !wsStat.isDirectory()) {
                json(res, 422, { error: `目录不存在或不是目录：${rawWorkspace}` })
                return
              }
            }
            // 落盘前确保基于新鲜 state：外部（CLI/手编）改过配置时按 mtime 作废
            // 缓存重读（带运行时事实），防止陈旧 existing 覆盖丢失外部修改
            //（generateAndInstall 只护 workspaces 段，其余以传入 state 为准）。
            // 必须走原始 state 通道（Set/Map/dstDir/yamlMod 齐全）——序列化视图
            // 喂生成管线会炸 TypeError（契约由 tests/api-apply.test.mjs 钉死）。
            const s = await rawStateWithRuntimeFacts(ctx)
            try {
              const result = installAssignments(s, body.assignments, {
                dryRun,
                saveConfigOnWrite: !dryRun,
                workspacePath,
              })
              // apply 落盘后必须重刷状态缓存：stateCache 仍是应用前的快照（existing
              // 还是旧 config 的 roles），浏览器刷新读到的就是它——角色专用模型 /
              // 显示名等会“看起来保存丢失、回落默认”。这里强制带运行时事实重刷；
              // best-effort：刷新失败不影响 apply 已成功的落盘结果（缓存仍标失效，
              // 下次 GET state 会带事实重建）。
              if (!dryRun && result.wrote) {
                try {
                  // 返回值本就丢弃：原始通道即可，白做一次序列化毫无意义。
                  await rawStateWithRuntimeFacts(ctx, { force: true })
                } catch (err) {
                  ctx.logger?.warn?.('paoding-config-ui: post-apply state refresh failed: ' + String(err?.message ?? err))
                }
              }
              json(res, 200, {
                dryRun,
                wrote: result.wrote,
                staleNote: result.staleNote,
                roleResults: result.roleResults,
                text: result.text,
                // 本次落点：全局 orchestrator 或工作区专属 orchestrator-<slug>。
                presetId: result.presetId,
                configFile: s.configFile,
              })
            } catch (err) {
              json(res, 422, { error: err.message })
            }
          } finally {
            if (!dryRun) applyInFlight = false
          }
          return
        }

        if (route === 'version' && req.method === 'GET') {
          // 版本提示：npm registry 优先、GitHub release 兜底（tools/lib/version.mjs，
          // 带 1 小时内存缓存，命中不发外网请求）。绝不 5xx——检测失败也回
          // 200 + error 字段，面板据此静默降级（不打扰使用）。timeoutMs 3000：
          // 检测只是锦上添花，不值得让面板等更久。layout 告知客户端挂载形态
          //（升级确认框按此分流警示文案），见 MOUNT_LAYOUT 注释。
          json(res, 200, { ...(await getVersionInfo({ timeoutMs: 3000 })), layout: MOUNT_LAYOUT })
          return
        }

        if (route === 'upgrade' && req.method === 'POST') {
          // 一键升级：spawn `dsh plugin --profile <name> update dsh-paoding`
          // 原地换版本（编排、profile 探测与互斥在 tools/lib/upgrade.mjs）。
          // ① 双保险：先取缓存内的版本信息，已无新版（按钮不该出现——竞态或
          //    误触 POST）就直接报最新，绝不无谓拉起子进程。
          const info = await getVersionInfo({ timeoutMs: 3000 })
          if (!info.updateAvailable) {
            json(res, 200, { ok: true, upToDate: true, current: info.current })
            return
          }
          // ② 真正执行：升级只换 profile 里的插件包本体，本进程代码不变、不越
          //    俎代庖；DSH_HOME 经环境继承给 dsh 子进程自行解析。
          const result = await runUpgrade()
          // 失败用 500 而非 apply 的 422：升级失败不是「提交的配置不合法」，
          // 而是环境/网络问题（pnpm 权限、断网、超时）；且客户端 api 助手
          // 对非 2xx 一律 throw 走 catch 醒目展示（这正是失败该有的观感），
          // 200 + ok:false 反而容易被当成成功静默掉。restartRequired 只在真
          // 的换了版本时为 true（upToDate / 失败都谈不上「需重启生效」）。
          // message：成功换版后的生效说明，客户端直接展示在更新卡。
          json(res, result.ok ? 200 : 500, {
            ...result,
            restartRequired: result.ok === true && result.upToDate !== true,
            ...(result.ok === true && result.upToDate !== true
              ? { message: `已升级到 v${result.version}，重启 DSH 后新版本生效（preset 会自动按新版重生成）` }
              : {}),
          })
          return
        }

        json(res, 404, { error: `no such route: ${req.method} /api/paoding/${route}` })
      } catch (err) {
        // 错误原文（可能带本机绝对路径）留日志；对外 message 先脱敏（home /
        // 插件安装根 → ~）。readBody 的 413/400 带 statusCode，按其状态码回。
        ctx.logger?.warn?.('paoding-config-ui: request failed: ' + String(err?.message ?? err))
        json(res, Number.isInteger(err?.statusCode) ? err.statusCode : 500, { error: sanitizeMessage(err?.message ?? err) })
      }
    },
  })

  ctx.logger?.info?.('paoding-config-ui: /api/paoding/* routes registered')
  // 路由就绪后异步触发首装 / 升级后 preset 自愈（不 await，不阻塞启动；
  // 结果只走日志，成败都不影响路由服务）。
  triggerPresetEnsure(ctx, () => disposed)
  // 包装宿主 disposer：先立 disposed 标志（在途 preset 自愈就此止步、不再
  // 写盘），再交给宿主注销路由。
  return () => {
    disposed = true
    disposer?.()
  }
}
