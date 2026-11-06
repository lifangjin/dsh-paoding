/**
 * client bundle 注册 id 冒烟回归（node:test，零依赖不启浏览器）。
 *
 * 正面：lib/client.js 过 scripts/client-id-smoke.mjs 的 URL 形状矩阵——
 * 8 形状（裸路径 / 旧单 ?rev / 旧 combo 前后位 / 0.2.2-rc.1+ 集合式 ?? 单
 * 与 combo 前后位 / 无 src 回退）× 2 挂载名（paoding-config-ui / dsh-paoding），
 * 注册 id 必须与挂载名一致、factory 是函数。
 *
 * 阴性对照（dsh-maoying#5）：把真实产物的 id 行换成 maoying 出事的捕获正则
 * /\/plugins\/([^/]+)\/client\.js/ —— [^/]+ 会把 0.2.2-rc.1 集合式 URL 的
 * 「??」捕进包名（id 变 ??dsh-paoding），旧 combo 尾位则捕到陪跑插件名。
 * 断言冒烟必须抓红（failures 非空且点名 ?? 形状）——证明这道闸门真的能拦，
 * 而不是永远绿灯的摆设。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runClientIdSmoke } from '../scripts/client-id-smoke.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const libPath = path.join(repoRoot, 'plugins', 'paoding-config-ui', 'lib', 'client.js')
const source = readFileSync(libPath, 'utf8')

test('lib/client.js 过注册 id 冒烟：URL 形状矩阵 × 两挂载名 + 无 src 回退', () => {
  const failures = runClientIdSmoke(source)
  assert.deepEqual(failures, [], `冒烟应全绿，实得失败清单：\n  - ${failures.join('\n  - ')}`)
})

test('阴性对照：maoying#5 式捕获正则必须被冒烟抓红', () => {
  const goodLine = '  id: __dshSrc.indexOf("paoding-config-ui/client.js") !== -1 ? "paoding-config-ui" : "dsh-paoding",'
  assert.ok(source.includes(goodLine), 'lib/client.js 里找不到现行 id 解析行——解析逻辑改了，请同步更新本对照的替换锚点')
  const badLine = '  id: ((__dshSrc.match(/\\/plugins\\/([^/]+)\\/client\\.js/) || [])[1] || "dsh-paoding"),'
  const broken = source.replace(goodLine, badLine)
  assert.notEqual(broken, source, '阴性替换未生效——坏行写法与产物不一致')

  const failures = runClientIdSmoke(broken)
  assert.ok(failures.length > 0, '坏 id 行必须被抓红——冒烟失灵了')
  // 集合式 ?? 形状必在失败清单里点名（maoying#5 的直接死法）
  const qShape = failures.find((f) => f.includes('??'))
  assert.ok(qShape, `失败清单应覆盖 ?? 集合式形状，实得：\n  - ${failures.join('\n  - ')}`)
})

test('阴性对照 ②：语法坏掉的产物必须被编译闸拦下', () => {
  const failures = runClientIdSmoke(source.slice(0, Math.floor(source.length / 2)))
  assert.ok(failures.length > 0, '半截产物（语法不可编译）应被 ① 号闸拦下')
  assert.ok(failures[0].includes('语法不可编译'), `首条失败应是编译错误，实得：${failures[0]}`)
})
