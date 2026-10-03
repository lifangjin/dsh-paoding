/**
 * apply 形态契约回归（node:test）。
 *
 * 背景：cordis 4.0.4 isConstructor() 对普通函数声明返回 true，插件会被
 * `new callback()` 构造调用：apply 返回的 disposer 顶替 instance，
 * instance?.[symbols.init]?.() 落空，disposer 被静默吞掉——禁用不释放
 * prefix route，重激活撞 duplicate prefix route（0.3.6 实测）。async 函数
 * 声明 / 箭头 / 对象简写方法均走回调分支，返回值正常收集。0.3.8 起 apply
 * 为 async 声明。此测试钉死该形态与路由生命周期，防止改回同步声明。
 * cordis / webserver 从本机 dsh 安装解析（DSH_ROOT 可覆盖），缺失则跳过。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { apply } from '../plugins/paoding-config-ui/index.mjs'

const dshRoot = process.env.DSH_ROOT || '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh'
const cordisLib = path.join(dshRoot, 'node_modules/@deepseek-ai/cordis/lib/index.js')
const webserverLib = path.join(dshRoot, 'node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js')
const available = existsSync(cordisLib) && existsSync(webserverLib)
const SKIP_REASON = '本机未找到 dsh 安装（可用 DSH_ROOT 指定），跳过'

test('apply 形态：async 函数声明（AsyncFunction），注定走 cordis 回调分支', () => {
  assert.equal(typeof apply, 'function', 'apply 应导出为函数')
  // 钉死 async 声明形态：async 函数没有 .prototype，cordis isConstructor()
  // 判 false → 回调分支。构造分支吞 disposer 的根因就是同步函数声明。
  assert.equal(apply.constructor.name, 'AsyncFunction', 'apply 必须保持 async 函数声明，不得改回同步声明')
})

test('isConstructor 对照钉：真实 apply 走回调分支，普通同步声明确实走构造分支', { skip: available ? false : SKIP_REASON }, async () => {
  const { isConstructor } = await import(pathToFileURL(cordisLib).href)
  assert.equal(isConstructor(apply), false, '真实插件形态（async 声明）必须走回调分支，返回的 disposer 才会被收集')
  // 对照钉（此宿主行为的活文档）：普通同步函数声明有 .prototype，
  // isConstructor 判 true → `new callback()` 构造分支 → disposer 被吞。
  assert.equal(isConstructor(function stub() {}), true, '普通同步函数声明确实会被 cordis 当构造器调用')
})

test('路由生命周期：async 声明探针激活注册、dispose 释放路由、重激活不撞表', { skip: available ? false : SKIP_REASON }, async () => {
  const { Context } = await import(pathToFileURL(cordisLib).href)
  const { default: WebServer } = await import(pathToFileURL(webserverLib).href)
  const ctx = new Context()
  try {
    // 与宿主同款组合：webserver 服务先起（port 0 = OS 分配，只 bind 不请求）。
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })

    // 每次激活造一个新探针（与 0.3.8 apply 同形态：async 函数声明，注册
    // prefix 路由后返回包装 disposer，先立标志再释放），自带 disposed 标志。
    const startProbe = () => {
      let disposed = false
      async function probeApply(ctx) {
        const release = ctx.webServer.register({ kind: 'prefix', path: '/api/probe', handler() {} })
        return () => {
          disposed = true
          release()
        }
      }
      const fiber = ctx.plugin({ name: 'probe', inject: ['webServer'], apply: probeApply })
      return { fiber, disposed: () => disposed }
    }

    // 1. 激活：路由进表（webserver 实例的 prefixes Map 是可达的公开字段）。
    const first = startProbe()
    await first.fiber
    assert.equal(ctx.get('webServer').prefixes.has('/api/probe'), true, '激活后 prefix 路由应在 webServer.prefixes 表里')

    // 2. 禁用：disposer 真正运行、路由释放——构造分支形态下这里必挂。
    await first.fiber.dispose()
    assert.equal(first.disposed(), true, 'dispose 后 apply 返回的 disposer 应真正执行')
    assert.equal(ctx.get('webServer').prefixes.has('/api/probe'), false, 'dispose 后路由应从表里释放')

    // 3. 重激活：同形态探针再次注册成功，不撞 duplicate prefix route。
    const second = startProbe()
    await second.fiber
    assert.equal(ctx.get('webServer').prefixes.has('/api/probe'), true, '重激活后同 path 路由应再次注册成功')
    await second.fiber.dispose()
  } finally {
    await ctx.fiber.dispose()
  }
})
