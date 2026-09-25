/**
 * 插件包展示元数据回归测试（node:test，纯文件断言、零网络）：DSH 0.1.7 起
 * 插件管理器读取的展示元数据契约 —— 根 package.json 顶层 icon 字段（相对
 * 路径、.svg、存在且 ≤ 256 KiB）、locale/<lang>.json 本地化 meta（en 锚点 +
 * zh，title/description 非空、语言名合法）、exports 暴露（package.json +
 * locale JSON 可被 Node ESM 解析）、files 白名单收录 locale/ 与 icon.svg，
 * 以及根包与 plugins/paoding-config-ui 版本号一致且 ≥ 0.3.6。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootPkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const pluginPkg = JSON.parse(readFileSync(path.join(repoRoot, 'plugins', 'paoding-config-ui', 'package.json'), 'utf8'))

// locale 文件名规则（DSH package-meta：en 锚点之外的同级文件名约束）
const LOCALE_NAME_RE = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/

/** semver 主次补三元组比较：a >= b 返 true（忽略 prerelease 后缀）。 */
function versionAtLeast(version, [wMaj, wMin, wPatch]) {
  const [maj, min, patch] = version.split('-')[0].split('.').map(Number)
  if (maj !== wMaj) return maj > wMaj
  if (min !== wMin) return min > wMin
  return patch >= wPatch
}

test('root package.json: 顶层 icon 为存在的相对 .svg 路径且 ≤ 256 KiB', () => {
  assert.equal(typeof rootPkg.icon, 'string', '顶层 icon 必须是字符串')
  assert.ok(rootPkg.icon.startsWith('./'), 'icon 只允许相对路径')
  assert.ok(rootPkg.icon.endsWith('.svg'))
  const iconPath = path.join(repoRoot, rootPkg.icon)
  assert.ok(existsSync(iconPath), `icon 文件缺失: ${rootPkg.icon}`)
  assert.ok(statSync(iconPath).size <= 256 * 1024, 'icon 文件不得超过 256 KiB')
})

for (const lang of ['en', 'zh']) {
  test(`locale/${lang}.json: 合法 JSON，meta.title/description 非空，语言名合法`, () => {
    assert.match(lang, LOCALE_NAME_RE)
    const file = path.join(repoRoot, 'locale', `${lang}.json`)
    assert.ok(existsSync(file), `locale 文件缺失: ${lang}.json`)
    const locale = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(typeof locale.meta?.title, 'string')
    assert.ok(locale.meta.title.length > 0, 'meta.title 不得为空')
    assert.equal(typeof locale.meta?.description, 'string')
    assert.ok(locale.meta.description.length > 0, 'meta.description 不得为空')
  })
}

test('root exports: 暴露 ./package.json 且可解析 ./locale/en.json（精确或通配）', () => {
  assert.ok(rootPkg.exports['./package.json'], './package.json 必须保留在 exports 中')
  const resolvesLocaleEn =
    rootPkg.exports['./locale/en.json'] === './locale/en.json' ||
    rootPkg.exports['./locale/*.json'] === './locale/*.json'
  assert.ok(resolvesLocaleEn, 'exports 必须能解析 ./locale/en.json（精确键或 ./locale/*.json 通配）')
})

test('root files: 白名单收录 locale/ 与 icon.svg（随包发布）', () => {
  assert.ok(Array.isArray(rootPkg.files), 'files 必须是数组')
  assert.ok(rootPkg.files.includes('locale/'), 'files 缺 locale/')
  assert.ok(rootPkg.files.includes('icon.svg'), 'files 缺 icon.svg')
})

test('版本一致性: 根包与 plugins/paoding-config-ui 相等且 ≥ 0.3.6', () => {
  assert.equal(pluginPkg.version, rootPkg.version, '插件包版本必须跟随根包版本')
  assert.ok(versionAtLeast(rootPkg.version, [0, 3, 6]), `根包版本 ${rootPkg.version} 应 ≥ 0.3.6`)
})
