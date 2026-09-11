/**
 * paoding-config-ui — DSH Web 插件 (cordis)
 *
 * 把 dsh-paoding 可视化配置器整合进 DSH Web GUI（设置页分区，无独立服务端）：
 *   - Node 侧：注册 /api/paoding/* 前缀路由（state/models/preview/apply/rescan +
 *     client.css 静态样式），经 ./api-core.mjs 复用 tools/install.mjs 的
 *     检测与生成管线。
 *   - Client 侧：lib/client.js 将配置面板挂到设置页的 settings.section 槽位。
 *
 * 挂载（~/.dsh/cordis.patch.yml）:
 *   - id: paoding-config-ui
 *     name: paoding-config-ui   # 解析自 $DSH_HOME/node_modules（或插件市场安装）
 *
 * 借鉴 dsh-better-sidebar 的机制（详见其 docs/plans 与 AGENTS.md）：
 *   - 客户端 bundle 以 window.__ModuleLoader__.load({id, factory}) 注册，由
 *     dsh-client-modules 节点半扫描 dsh.client 声明并以 /plugins/<id>/client.js
 *     下发；bundle 的注册 id 必须等于包名（图行 id）。
 *   - 设置分区经 ctx.slots.inject('settings.section') + slots.register() 挂载，
 *     id/order/label 驱动设置壳导航（与 ui-settings-general 的 general 分区同款）。
 *   - 宿主路由自带信任围栏：/api/paoding 长于 /api 前缀，webserver 最长前缀
 *     优先会命中本插件而绕过 /api 网关的围栏，故在此复刻同一围栏语义
 *     （Host 回环或 webRuntime.trustedHosts，拒绝 cross-site 浏览器请求）。
 */
import { readFile } from 'node:fs/promises'
import { getState, refreshState, hasStateCache, serializeState, installAssignments } from './api-core.mjs'
import { collectRuntimeFacts } from './runtime-inventory.mjs'

export const name = 'paoding-config-ui'
// apiProxy：宿主 API 代理服务——models 路由经 ctx.apiProxy.llm.models({})
// 取 DSH 已配置/已注册的模型目录（设置页模型选择器同款目录，JSON-safe 纯
// 对象；失败组在 failures 里，不抛错）。
export const inject = ['webServer', 'apiProxy']

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

/** Read a JSON request body (bounded). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 5 * 1024 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
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

export function apply(ctx) {
  const { webServer } = ctx
  // webRuntime 由 dsh-web-app 的 web-runtime 行提供；非 web 部署下缺失时退化为
  // 仅回环信任（每次请求读实时值，trustedHosts 变化无需重启插件）。
  const trustedHostsOf = () => ctx.get('webRuntime')?.trustedHosts ?? []

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
            json(res, 500, { error: `client.css unavailable: ${err.message}` })
          }
          return
        }

        if (route === 'state' && req.method === 'GET') {
          // 仅缓存缺失时带实时运行时事实做一次全量检测（成本同旧版首次 GET），
          // 命中缓存直接返回——运行时注册表只在 DSH 重启/插件启停时变化，
          // 没必要让每次打开面板都重握手 MCP。
          if (!hasStateCache()) {
            const facts = await collectRuntimeFacts(ctx)
            await refreshState(facts)
          }
          const s = await getState()
          json(res, 200, serializeState(s))
          return
        }

        if (route === 'models' && req.method === 'GET') {
          // 模型目录：DSH 设置页模型选择器同款目录（deepseek-official 三模型、
          // pi-ai 各路由等），JSON-safe 纯对象。与 state 缓存无关，每次实调——
          // 目录发现可能稍慢，属正常。失败组在 failures 里，不抛错；这里自捕
          // 一层，保证错误也走 { ok: false, error } 形状（外层 catch 是 { error }）。
          try {
            // apiProxy 的 llm.* 是裸 RPC handler：入参 { rpcId, payload } 信封、
            // 返回 { rpcId, result: { ok, value | error } } 信封（ok()/err() 同源
            // 形状），不是直接吐 { groups, failures }——必须拆一层信封再取 value。
            const envelope = await ctx.apiProxy.llm.models({ rpcId: 'paoding-models', payload: {} })
            const result = envelope && typeof envelope.result === 'object' && envelope.result !== null
              ? envelope.result
              : null
            if (!result || !result.ok) {
              const message = result && result.error && result.error.message ? result.error.message : '模型目录调用失败'
              throw new Error(message)
            }
            const catalog = result.value
            if (!catalog || !Array.isArray(catalog.groups)) throw new Error('模型目录响应缺少 groups')
            json(res, 200, { ok: true, groups: catalog.groups, failures: Array.isArray(catalog.failures) ? catalog.failures : [] })
          } catch (err) {
            json(res, 500, { ok: false, error: err.message })
          }
          return
        }

        if (route === 'rescan' && req.method === 'POST') {
          // 重新检测 = 采集实时事实 → 带事实重刷状态（getState 不再自己重刷）
          const facts = await collectRuntimeFacts(ctx)
          await refreshState(facts)
          const s = await getState()
          json(res, 200, serializeState(s))
          return
        }

        // ── TEMP PROBE (generic runtime detection groundwork; remove later) ──
        // 崩溃安全：任何一步失败都记入 errors 而非 500；访问路径分别报告
        // reflect.get / ctx.get / ctx[key] 三种取法的可用性（cordis 的 ctx[key]
        // 受 inject 护栏约束，ctx.reflect.get 是官方无 inject 读取口）。
        if (route === 'probe' && req.method === 'GET') {
          const cap = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : arr)
          const methodNamesOf = (svc) => {
            const methods = []
            for (let p = Object.getPrototypeOf(svc); p && p !== Object.prototype && methods.length < 60; p = Object.getPrototypeOf(p)) {
              for (const m of Object.getOwnPropertyNames(p)) {
                if (m !== 'constructor' && typeof svc[m] === 'function' && !methods.includes(m)) methods.push(m)
              }
            }
            return methods
          }
          const probe = { errors: [] }
          const tryReport = (label, fn) => {
            try { probe[label] = fn() } catch (err) { probe[label] = 'error: ' + String(err?.message ?? err) }
          }

          // 1) 每类服务三种取法的可用性 + 方法表面
          //    ⚠️ 切勿把服务实例本身放进结果：ctx 服务是 cordis 代理，JSON
          //    stringify 访问其 toJSON 会触发 inject 护栏抛错。只留纯数据。
          const svcNames = ['tools', 'pluginInventory', 'loader', 'commands', 'mnemon', 'codegraph',
            'agentLoop', 'systemPrompt', 'settings', 'webRuntime', 'webServer', 'llm', 'mcp', 'attachments', 'reflect']
          const services = {}
          for (const key of svcNames) {
            const row = {}
            let found = undefined
            for (const [path, access] of [
              ['reflect', () => ctx.reflect?.get?.(key, false)],
              ['get', () => ctx.get?.(key)],
              ['prop', () => ctx[key]],
            ]) {
              try {
                const v = access()
                if (v !== undefined && v !== null) {
                  row[path] = 'ok'
                  if (found === undefined) found = v
                } else {
                  row[path] = 'missing'
                }
              } catch (err) { row[path] = 'throw: ' + String(err?.message ?? err) }
            }
            if (found !== undefined) row.methods = methodNamesOf(found)
            services[key] = row
          }
          probe.services = services

          // 2) pluginInventory.list() 直接采样
          tryReport('pluginInventory', () => {
            const pi = ctx.reflect?.get?.('pluginInventory', false) ?? ctx.get?.('pluginInventory')
            if (!pi || typeof pi.list !== 'function') return 'no service / no list()'
            const entries = pi.list()?.entries
            if (!Array.isArray(entries)) return 'list() shape: ' + typeof entries
            return entries.slice(0, 60).map((e) => ({ entryId: e.entryId, moduleName: e.moduleName, enabled: e.enabled, fiberPhase: e.fiberPhase }))
          })

          // 3) tools 服务的枚举口 + 工具名采样
          tryReport('toolsMethods', () => {
            const t = ctx.reflect?.get?.('tools', false) ?? ctx.get?.('tools')
            return t ? methodNamesOf(t) : 'no service'
          })
          for (const [label, method] of [
            ['toolsSchemas', 'schemas'],
            ['toolsEntries', 'entries'],
          ]) {
            tryReport(label, () => {
              const t = ctx.reflect?.get?.('tools', false) ?? ctx.get?.('tools')
              if (!t || typeof t[method] !== 'function') return 'no ' + method + '()'
              const result = t[method]()
              if (result == null || typeof result[Symbol.iterator] !== 'function') return 'not iterable: ' + typeof result
              const names = []
              for (const item of result) {
                const name = typeof item === 'string' ? item : (item && typeof item === 'object' ? (typeof item.name === 'string' ? item.name : (Array.isArray(item) ? item[0] : undefined)) : undefined)
                if (typeof name === 'string') names.push(name)
                if (names.length >= 120) break
              }
              return { count: names.length, sample: cap(names, 120) }
            })
          }

          json(res, 200, probe)
          return
        }

        if ((route === 'preview' || route === 'apply') && req.method === 'POST') {
          const body = await readBody(req)
          const s = await getState()
          const dryRun = route === 'preview'
          try {
            const result = installAssignments(s, body.assignments, {
              dryRun,
              saveConfigOnWrite: !dryRun,
            })
            // apply 落盘后必须重刷状态缓存：stateCache 仍是应用前的快照（existing
            // 还是旧 config 的 roles），浏览器刷新读到的就是它——角色专用模型 /
            // 显示名等会“看起来保存丢失、回落默认”。这里与 rescan 同款带运行时
            // 事实重刷；best-effort：刷新失败不影响 apply 已成功的落盘结果
            // （refreshState 自捕错误置空缓存，下次 GET state 会带事实重建）。
            if (!dryRun && result.wrote) {
              try {
                const facts = await collectRuntimeFacts(ctx)
                await refreshState(facts)
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
              configFile: s.configFile,
            })
          } catch (err) {
            json(res, 422, { error: err.message })
          }
          return
        }

        json(res, 404, { error: `no such route: ${req.method} /api/paoding/${route}` })
      } catch (err) {
        json(res, 500, { error: err.message })
      }
    },
  })

  ctx.logger?.info?.('paoding-config-ui: /api/paoding/* routes registered')
  return disposer
}
