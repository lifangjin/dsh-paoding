/**
 * 客户端面板 i18n 测试（node:test，纯 vm 执行 04 片段，零 DOM / 零网络）。
 *
 * 钉死契约：
 * - zh / en 字典 key 集合一致、{param} 占位符集合一致；
 * - 源码里所有 t("<key>") 字面引用（含 55 模板 label/desc、82 委派标题回落、
 *   70 体检六码 warn.title.<code>）都能在字典里命中；
 * - 语言解析（zh 信号优先）：localStorage 显式 > navigator/页面 lang 带
 *   zh > 中文时区 > en 信号 > 兜底 zh；
 * - setLang 幂等、写盘、广播；onLangChange 反注册生效；
 * - t() 插值 {name}/{n}/{v}，缺 key 原样返回 key。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.join(HERE, '..', 'plugins', 'paoding-config-ui', 'src', 'client')

/** 干净沙箱：可注入 localStorage 预置值、navigator.language(s)、宿主页
 * <html lang> 与时区（Intl 桩，只实现探测用到的 resolvedOptions().timeZone）。 */
function loadI18n({ stored, navLang, navLangs, docLang, tz } = {}) {
  const ls = {
    _kv: stored ? { 'paoding-lang': stored } : {},
    getItem(k) { return this._kv[k] ?? null },
    setItem(k, v) { this._kv[k] = String(v) },
    removeItem(k) { delete this._kv[k] },
  }
  const navigator_ = { language: navLang ?? 'zh-CN' }
  if (navLangs) navigator_.languages = navLangs
  const sandbox = {
    window: { localStorage: ls },
    localStorage: ls,
    navigator: navigator_,
    document: docLang ? { documentElement: { lang: docLang } } : { documentElement: {} },
    Intl: {
      DateTimeFormat: function () {
        return { resolvedOptions: () => ({ timeZone: tz ?? 'Asia/Shanghai' }) }
      },
    },
  }
  vm.createContext(sandbox)
  const src = readFileSync(path.join(CLIENT_DIR, '04-i18n.js'), 'utf8')
  vm.runInContext(src, sandbox, { timeout: 2000 })
  return sandbox
}

// ── 字典形状 ────────────────────────────────────────────────────────────────

test('字典形状：zh/en key 集合一致', () => {
  const sb = loadI18n()
  const dict = sb.PAODING_I18N_DICT
  const keys = Object.keys(dict)
  assert.ok(keys.length >= 200, `字典规模骤降？${keys.length}`)
  for (const k of keys) {
    const e = dict[k]
    assert.ok(e && typeof e === 'object', `${k} 条目缺失`)
    assert.equal(typeof e.zh, 'string', `${k}.zh 不是字符串`)
    assert.equal(typeof e.en, 'string', `${k}.en 不是字符串`)
  }
})

test('字典形状：zh/en 占位符集合一致', () => {
  const sb = loadI18n()
  const dict = sb.PAODING_I18N_DICT
  const ph = (s) => [...new Set(String(s).match(/\{[A-Za-z]+\}/g) || [])].sort().join(',')
  for (const [k, e] of Object.entries(dict)) {
    assert.equal(ph(e.zh), ph(e.en), `${k} 占位符不一致：zh="${ph(e.zh)}" en="${ph(e.en)}"`)
  }
})

// ── 语言解析 ────────────────────────────────────────────────────────────────

test('语言解析：localStorage 显式值优先于一切探测', () => {
  assert.equal(loadI18n({ stored: 'en', navLang: 'zh-CN', tz: 'Asia/Shanghai' }).pdLang(), 'en')
  assert.equal(loadI18n({ stored: 'zh', navLang: 'en-US', tz: 'America/New_York' }).pdLang(), 'zh')
  // 非法显式值忽略，回落探测
  assert.equal(loadI18n({ stored: 'fr', navLang: 'en-US', tz: 'America/New_York' }).pdLang(), 'en')
})

test('语言解析：zh 信号优先于 en——Electron 外壳 navigator 被钉成 en-US 的中文机器', () => {
  // 用户实报场景：DSH Electron webview navigator.language=en-US（应用 locale），
  // 操作系统时区 Shanghai——时区压过假 en 信号
  assert.equal(loadI18n({ navLang: 'en-US', tz: 'Asia/Shanghai' }).pdLang(), 'zh')
  // 常规英文浏览器（en 语言 + 非中文时区）仍是 en
  assert.equal(loadI18n({ navLang: 'en-US', tz: 'America/New_York' }).pdLang(), 'en')
  // 偏好列表里带 zh 也算（Electron languages 偶有保留 OS 偏好）
  assert.equal(loadI18n({ navLang: 'en-US', navLangs: ['en-US', 'zh-CN'], tz: 'America/New_York' }).pdLang(), 'zh')
})

test('语言解析：宿主页面 <html lang> 与最终兜底', () => {
  assert.equal(loadI18n({ navLang: 'zh-TW', tz: 'America/New_York' }).pdLang(), 'zh')
  assert.equal(loadI18n({ navLang: 'ja-JP', docLang: 'zh-CN', tz: 'America/New_York' }).pdLang(), 'zh')
  assert.equal(loadI18n({ navLang: 'ja-JP', docLang: 'en-US', tz: 'America/New_York' }).pdLang(), 'en')
  // 无任何 zh/en 信号：兜底 zh（服务端消息仅中文，en 面板必混排）
  assert.equal(loadI18n({ navLang: 'ja-JP', tz: 'America/New_York' }).pdLang(), 'zh')
})

// ── setLang / 订阅 ──────────────────────────────────────────────────────────

test('setLang：写盘、广播、幂等（值不变不重复广播）', () => {
  const sb = loadI18n({ navLang: 'zh-CN' })
  let fired = 0
  const off = sb.onLangChange(function () { fired++ })
  assert.equal(typeof off, 'function', 'onLangChange 必须返回反注册函数')
  sb.setLang('en')
  assert.equal(sb.pdLang(), 'en')
  assert.equal(sb.window.localStorage.getItem('paoding-lang'), 'en')
  sb.setLang('en') // 幂等：同值不再广播
  assert.equal(fired, 1)
  sb.setLang('zh')
  assert.equal(fired, 2)
  off() // 反注册后不再收到广播
  sb.setLang('en')
  assert.equal(fired, 2)
})

// ── t() 取词 ────────────────────────────────────────────────────────────────

test('t()：插值、缺 key 原样返回、tHas、语言切换即时生效', () => {
  const sb = loadI18n({ navLang: 'zh-CN' })
  assert.equal(sb.t('nav.entryTitle'), '庖丁配置')
  assert.equal(sb.t('ws.sessionCount', { n: 3 }), '3 会话')
  assert.equal(sb.t('panel.definitely.not.a.key'), 'panel.definitely.not.a.key')
  assert.equal(sb.tHas('nav.entryTitle'), true)
  assert.equal(sb.tHas('panel.definitely.not.a.key'), false)
  sb.setLang('en')
  assert.equal(sb.t('nav.entryTitle'), 'Paoding Config')
  assert.equal(sb.t('ws.sessionCount', { n: 3 }), '3 sessions')
})

// ── 源码引用对账 ────────────────────────────────────────────────────────────

const dictKeys = () => new Set(Object.keys(loadI18n().PAODING_I18N_DICT))

test('源码对账：全部 t("key") 字面引用都在字典里', () => {
  const dict = dictKeys()
  const keyRe = /(^|[^\w$.])t\(\s*"([A-Za-z0-9_.]+)"/g
  const missing = []
  for (const f of readdirSync(CLIENT_DIR)) {
    if (!f.endsWith('.js') || f.startsWith('04-')) continue // 04 本身不含 t() 调用
    const src = readFileSync(path.join(CLIENT_DIR, f), 'utf8')
    for (const m of src.matchAll(keyRe)) {
      const key = m[2]
      if (key.endsWith('.')) continue // t("warn.title." + code) 动态拼接，另行断言
      if (!dict.has(key)) missing.push(`${f}: ${key}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('源码对账：55 模板 label/desc 与 82 委派标题回落都是字典 key', () => {
  const dict = dictKeys()
  const tplSrc = readFileSync(path.join(CLIENT_DIR, '55-templates.js'), 'utf8')
  for (const m of tplSrc.matchAll(/(?:label|desc):\s*"([A-Za-z0-9_.]+)"/g)) {
    assert.ok(dict.has(m[1]), `55 模板引用了字典外的 key：${m[1]}`)
  }
  const delSrc = readFileSync(path.join(CLIENT_DIR, '82-delegate-rows.js'), 'utf8')
  for (const m of delSrc.matchAll(/"(role\.title\.[A-Za-z_]+)"/g)) {
    assert.ok(dict.has(m[1]), `82 回落表引用了字典外的 key：${m[1]}`)
  }
})

test('源码对账：六个体检码 warn.title.<code> 全部本地化', () => {
  const dict = dictKeys()
  for (const code of ['generation', 'generation_error', 'preset_drift', 'unknown_model', 'unmounted_tool', 'zero_tool_role']) {
    assert.ok(dict.has(`warn.title.${code}`), `缺 warn.title.${code}`)
  }
})
