/**
 * 一键升级回归测试（node:test，禁网络禁真子进程——fetchImpl / spawnImpl 全部
 * 注入桩）。覆盖 tools/lib/upgrade.mjs 的通道分流：desktop profile 被 dsh CLI
 * 的 Electron 专属守卫硬拒，走 profile 目录直跑 `pnpm add dsh-paoding@<精确
 * 版本>`（含 profile 名大小写不敏感、目录未初始化诚实失败、pnpm 退出码收敛
 * 文案）；常规 profile 保持 dsh 插件转发器原样（args / cwd / 退出码文案）；
 * registry 不新于本地时 upToDate 短路。desktop 目录解析依赖 DSH_HOME，各用例
 * 用临时目录隔离并在收尾恢复原环境。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runUpgrade } from '../tools/lib/upgrade.mjs'

// registry / 镜像桩：两端点共用同一形状（顶层 version 即 latest），返回必新
// 于本地安装版的版本号，让流程稳定走到 spawn 段；传 '0.0.1' 则落在 upToDate。
function stubFetch(latest = '9.9.9') {
  return async () => ({ ok: true, status: 200, json: async () => ({ version: latest }) })
}

// spawn 桩：记录每次调用的形状供断言，按 result 收敛（同 defaultSpawn 形状）。
function stubSpawn(result = { code: 0, output: 'ok' }) {
  const calls = []
  const fn = async (command, args, options) => {
    calls.push({ command, args, options })
    return result
  }
  fn.calls = calls
  return fn
}

// DSH_HOME 环境门：desktop 分支据此解析 profile 目录，用例内指向临时目录、
// 收尾恢复原值（原本未设则删回未设，避免污染后续用例）。
function useDshHome(t, dir) {
  const saved = process.env.DSH_HOME
  t.after(() => {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  })
  process.env.DSH_HOME = dir
}

// 造一个 desktop profile 的家目录并返回 profile 目录绝对路径；initialized
// 为 false 时省掉 package.json，模拟「profile 未初始化」。
function makeDesktopProfile(t, { initialized = true } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), 'pd-upgrade-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  useDshHome(t, home)
  const profileDir = path.join(home, 'profiles', 'desktop')
  if (initialized) {
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(path.join(profileDir, 'package.json'), '{}')
  }
  return profileDir
}

// 与 upgrade.mjs 同款 win32 判定：.cmd shim + shell 拉起只在 win32 出现。
const useShell = process.platform === 'win32'

test('desktop profile：spawn pnpm add 精确版本，cwd 指向 profile 目录', async (t) => {
  const profileDir = makeDesktopProfile(t)
  const spawnImpl = stubSpawn()
  const result = await runUpgrade({ profile: 'desktop', fetchImpl: stubFetch('9.9.9'), spawnImpl })

  assert.equal(result.ok, true)
  assert.equal(result.version, '9.9.9')
  assert.equal(result.profile, 'desktop')
  assert.equal(typeof result.elapsedMs, 'number')
  assert.equal(spawnImpl.calls.length, 1)
  const call = spawnImpl.calls[0]
  assert.equal(call.command, useShell ? 'pnpm.cmd' : 'pnpm')
  assert.deepEqual(call.args, ['add', 'dsh-paoding@9.9.9'])
  assert.equal(call.options.cwd, profileDir)
  assert.equal(call.options.shell, useShell)
})

test('desktop profile：profile 名大小写不敏感，Desktop 同样走 pnpm 直装', async (t) => {
  makeDesktopProfile(t)
  const spawnImpl = stubSpawn()
  const result = await runUpgrade({ profile: 'Desktop', fetchImpl: stubFetch('9.9.9'), spawnImpl })

  assert.equal(result.ok, true)
  assert.equal(spawnImpl.calls[0].command, useShell ? 'pnpm.cmd' : 'pnpm')
  assert.deepEqual(spawnImpl.calls[0].args, ['add', 'dsh-paoding@9.9.9'])
})

test('desktop profile：目录未初始化（缺 package.json）→ 诚实失败且不 spawn', async (t) => {
  const profileDir = makeDesktopProfile(t, { initialized: false })
  const spawnImpl = stubSpawn()
  const result = await runUpgrade({ profile: 'desktop', fetchImpl: stubFetch('9.9.9'), spawnImpl })

  assert.equal(result.ok, false)
  assert.equal(result.error, `desktop profile 目录不存在或未初始化: ${profileDir}`)
  assert.equal(spawnImpl.calls.length, 0)
})

test('desktop profile：pnpm 退出码非 0 → 文案点明 pnpm add 并带输出尾部', async (t) => {
  makeDesktopProfile(t)
  const spawnImpl = stubSpawn({ code: 1, output: 'ERR_PNPM_NO_MATCHING_VERSION' })
  const result = await runUpgrade({ profile: 'desktop', fetchImpl: stubFetch('9.9.9'), spawnImpl })

  assert.equal(result.ok, false)
  assert.equal(result.error, 'pnpm add 退出码 1')
  assert.equal(result.output, 'ERR_PNPM_NO_MATCHING_VERSION')
})

test('常规 profile：保持 dsh 插件转发器原样（args / cwd / 退出码文案）', async (t) => {
  const spawnImpl = stubSpawn({ code: 2, output: 'boom' })
  const result = await runUpgrade({ profile: 'web', fetchImpl: stubFetch('9.9.9'), spawnImpl })

  assert.equal(result.ok, false)
  assert.equal(result.error, 'dsh plugin update 退出码 2')
  assert.equal(result.output, 'boom')
  assert.equal(spawnImpl.calls.length, 1)
  const call = spawnImpl.calls[0]
  assert.equal(call.command, useShell ? 'dsh.cmd' : 'dsh')
  assert.deepEqual(call.args, ['plugin', '--profile', 'web', 'update', 'dsh-paoding'])
  assert.equal(call.options.cwd, tmpdir())
  assert.equal(call.options.shell, useShell)
})

test('registry 不新于本地：upToDate 短路，不 spawn 任何子进程', async (t) => {
  const spawnImpl = stubSpawn()
  const result = await runUpgrade({ profile: 'web', fetchImpl: stubFetch('0.0.1'), spawnImpl })

  assert.equal(result.ok, true)
  assert.equal(result.upToDate, true)
  assert.equal(spawnImpl.calls.length, 0)
})
