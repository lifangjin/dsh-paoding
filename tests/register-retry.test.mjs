/**
 * registerPrefixRouteWithRetry 兜底重试契约测试（node:test，纯内存 fake，禁网络）。
 *
 * 背景：dsh 0.1.7-rc.2 / 0.2.0-rc.x 插件列表「禁用→启用」会重建条目纤维，新
 * apply() 先执行、旧 incarnation 的路由注销走异步结算，注册瞬间旧路由常仍在
 * 表里，webServer.register 对同 (kind, path) 一律抛 duplicate。兜底助手只对
 * 这一种错误短重试等旧注销落地；其余错误原样抛，真组合冲突不掩盖。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerPrefixRouteWithRetry } from '../plugins/paoding-config-ui/index.mjs'

const DUPLICATE = () => new Error('webserver: duplicate prefix route "/api/paoding"')

/** 计数 fake：errors 队列逐次抛（耗尽后成功），成功时把 path 记入 Map 并返回注销函数。 */
function fakeWebServer(errors) {
  const routes = new Map()
  let calls = 0
  const webServer = {
    routes,
    calls: () => calls,
    register(route) {
      calls++
      if (calls <= errors.length) throw errors[calls - 1]
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  return webServer
}

test('前几次 duplicate 后成功：短重试拿到函数型 disposer，调用后 Map 清空', async () => {
  const webServer = fakeWebServer([DUPLICATE(), DUPLICATE(), DUPLICATE()])
  const disposer = await registerPrefixRouteWithRetry(
    webServer,
    { kind: 'prefix', path: '/api/paoding', handler: async () => {} },
    { attempts: 8, delayMs: 1 },
  )
  assert.equal(typeof disposer, 'function', '成功注册应返回函数型 disposer')
  assert.equal(webServer.calls(), 4, '前 3 次 duplicate，第 4 次成功')
  assert.equal(webServer.routes.size, 1, '成功后路由应在表里')
  disposer()
  assert.equal(webServer.routes.size, 0, 'disposer 调用后路由应从表里清除')
})

test('无关错误立即抛出：不掩盖真组合冲突，不做无谓重试', async () => {
  const webServer = fakeWebServer([new Error('boom')])
  // 助手是 async（返回 Promise），不会同步 throw，故用异步等价的 assert.rejects；
  // 「立即抛出、不做无谓重试」由下方调用计数 = 1 钉死。
  await assert.rejects(
    registerPrefixRouteWithRetry(
      webServer,
      { kind: 'prefix', path: '/api/paoding', handler: async () => {} },
      { attempts: 8, delayMs: 1 },
    ),
    /boom/,
  )
  assert.equal(webServer.calls(), 1, '无关错误只调一次，立即抛出')
})

test('永远 duplicate：耗尽 attempts 后抛出最后一次 duplicate 错误本身', async () => {
  const webServer = fakeWebServer([DUPLICATE(), DUPLICATE(), DUPLICATE()])
  await assert.rejects(
    registerPrefixRouteWithRetry(
      webServer,
      { kind: 'prefix', path: '/api/paoding', handler: async () => {} },
      { attempts: 3, delayMs: 1 },
    ),
    (err) => {
      assert.equal(err.message, 'webserver: duplicate prefix route "/api/paoding"', '应抛 duplicate 错误本身')
      return true
    },
  )
  assert.equal(webServer.calls(), 3, '重试次数恰好等于 attempts 后放弃')
})
