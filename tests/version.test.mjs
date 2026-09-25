/**
 * 版本提示回归测试（node:test，禁网络——fetchImpl 全部注入桩）。覆盖：
 * 三级检测链顺序（npm registry → npmmirror → GitHub，各级只在上级失败后
 * 才被命中）、命中源 source 标记、三路皆败的 error 文案（带各级原因与代理
 * 排查提示）、compareVersions 数值段与预发布后缀语义、缓存 TTL 与
 * lastGood 窗的时间行为。模块级缓存跨用例存活，各用例用注入的递增时间基
 * 隔开（设计见下方常量注释）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compareVersions, fetchLatestFromMirror, getVersionInfo } from '../tools/lib/version.mjs'

// 各用例时间基：模块级缓存（TTL 1h / lastGood 7d）跨用例存活，用例间既隔过
// TTL（各自拿到新鲜检测）又保持单调递增（now 倒退会被当成缓存命中）；
// 三路皆败用例基线额外跨过前序成功写入的 7 天 lastGood 窗，否则返回的是
// 旧成功结果而非降级 error。
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const T0 = 1_700_000_000_000
const T_REGISTRY = T0
const T_MIRROR = T0 + 2 * HOUR
const T_GITHUB = T0 + 4 * HOUR
const T_ALL_FAIL = T0 + 9 * DAY
const T_CACHE = T0 + 10 * DAY

// 端点 → 桩响应表：按 URL 分流，visited 记录命中顺序供链路断言。
function makeFetch({ registry, mirror, github } = {}) {
  const visited = []
  const fn = async (url) => {
    visited.push(url)
    const respond = (entry) => {
      if (!entry) return { ok: false, status: 503, json: async () => ({}) }
      if (entry.throw) throw new Error(entry.throw)
      return { ok: true, status: 200, json: async () => entry.body }
    }
    if (url.includes('registry.npmjs.org')) return respond(registry)
    if (url.includes('registry.npmmirror.com')) return respond(mirror)
    if (url.includes('api.github.com')) return respond(github)
    return { ok: false, status: 404, json: async () => ({}) }
  }
  fn.visited = visited
  return fn
}

test('getVersionInfo: npm registry 命中时不碰镜像与 GitHub', async () => {
  const fetchImpl = makeFetch({ registry: { body: { version: '0.3.5' } } })
  const info = await getVersionInfo({ fetchImpl, now: T_REGISTRY })
  assert.equal(info.source, 'npm')
  assert.equal(info.latest, 'v0.3.5')
  assert.equal(info.updateAvailable, false, '工作区 0.3.5 对 0.3.5 无新版')
  assert.match(fetchImpl.visited[0], /registry\.npmjs\.org/)
  assert.equal(fetchImpl.visited.length, 1, '一级命中后不再兜底')
})

test('getVersionInfo: registry 失败 → npmmirror 兜底命中，source 标记 mirror', async () => {
  const fetchImpl = makeFetch({ registry: { throw: 'TimeoutError' }, mirror: { body: { version: '0.4.0' } } })
  const info = await getVersionInfo({ fetchImpl, now: T_MIRROR })
  assert.equal(info.source, 'mirror')
  assert.equal(info.latest, 'v0.4.0')
  assert.equal(info.updateAvailable, true, '0.3.5 < 0.4.0 应提示升级')
  assert.equal(fetchImpl.visited.length, 2)
  assert.match(fetchImpl.visited[1], /registry\.npmmirror\.com/)
})

test('getVersionInfo: registry 与镜像都挂 → GitHub 兜底，source 标记 github', async () => {
  const fetchImpl = makeFetch({
    registry: { throw: 'TimeoutError' },
    mirror: { throw: 'TimeoutError' },
    github: { body: { tag_name: 'v0.4.1', html_url: 'https://github.com/lifangjin/dsh-paoding/releases/tag/v0.4.1' } },
  })
  const info = await getVersionInfo({ fetchImpl, now: T_GITHUB })
  assert.equal(info.source, 'github')
  assert.equal(info.latest, 'v0.4.1')
  assert.equal(fetchImpl.visited.length, 3)
})

test('getVersionInfo: 三路皆败 → error 带各级原因与代理提示，latest 置空', async () => {
  const fetchImpl = makeFetch({
    registry: { throw: 'TimeoutError: aborted' },
    mirror: { throw: 'TimeoutError: aborted' },
    github: { throw: 'TimeoutError: aborted' },
  })
  const info = await getVersionInfo({ fetchImpl, now: T_ALL_FAIL })
  assert.equal(info.source, null)
  assert.equal(info.latest, null)
  assert.equal(info.updateAvailable, false)
  assert.match(info.error, /npm registry: TimeoutError: aborted/)
  assert.match(info.error, /npmmirror: TimeoutError: aborted/)
  assert.match(info.error, /GitHub: TimeoutError: aborted/)
  assert.match(info.error, /HTTPS_PROXY/, '代理排查提示必须在场——「浏览器能上、DSH 检测失败」的第一嫌疑')
})

test('getVersionInfo: 检测成功后 1 小时内命中缓存不发请求，过期重新检测', async () => {
  const fetchImpl = makeFetch({ registry: { body: { version: '0.3.5' } } })
  // 模块级缓存跨用例存活：把时间基拨过前序用例写入的 TTL，先强制一次新鲜
  // 检测，之后的断言才只受本用例的时间轴影响。
  await getVersionInfo({ fetchImpl, now: T_CACHE })
  assert.equal(fetchImpl.visited.length, 1, '前置：基线跨过前序缓存 TTL，完成一次真实检测')
  await getVersionInfo({ fetchImpl, now: T_CACHE + 60_000 })
  assert.equal(fetchImpl.visited.length, 1, 'TTL 内复用缓存')
  await getVersionInfo({ fetchImpl, now: T_CACHE + 61 * 60_000 })
  assert.equal(fetchImpl.visited.length, 2, '过期后重新发请求')
})

test('fetchLatestFromMirror: 端点与 source 标记正确', async () => {
  const fetchImpl = makeFetch({ mirror: { body: { version: '0.3.6' } } })
  const res = await fetchLatestFromMirror({ fetchImpl })
  assert.equal(res.ok, true)
  assert.equal(res.latest, 'v0.3.6')
  assert.equal(res.source, 'mirror')
  assert.match(fetchImpl.visited[0], /registry\.npmmirror\.com\/dsh-paoding\/latest/)
})

test('compareVersions: 数值段比较与预发布后缀语义', () => {
  assert.equal(compareVersions('0.3.2', '0.3.5') < 0, true)
  assert.equal(compareVersions('0.3.10', '0.3.9') > 0, true, '逐段数值比较，不看字符串长度')
  assert.equal(compareVersions('v0.3.5', '0.3.5'), 0, '剥 v 前缀后相等')
  assert.equal(compareVersions('0.3.0-rc.1', '0.3.0') < 0, true, '同核心段带预发布后缀视为更低')
})
