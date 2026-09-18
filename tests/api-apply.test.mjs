/**
 * apply/preview 契约回归测试（node:test，禁网络 —— 不写任何 patch 文件就不触发
 * MCP 握手；禁依赖 $DSH_HOME 真实环境 —— dshHome / 配置文件一律用临时目录，
 * 且临时目录里不放 cordis.patch.yml）。
 *
 * 钉死契约：apply/preview 路由必须把【原始 collectState state】（Set/Map/
 * dstDir/yamlMod 齐全）喂给生成管线 installAssignments → generateAndInstall，
 * 绝不能喂 serializeState 产出的浏览器 JSON 视图。回归背景：0.3.0 工作区改版
 * 时 apply/preview 曾改用序列化视图（Set→排序数组、Map→普通对象、丢
 * dstDir/yamlMod），生成管线按请求体形状炸出各种 TypeError（实测出现过
 * inventory.has is not a function、blocks.get is not a function、
 * The "path" argument must be of type string、Cannot read properties of
 * undefined (reading 'indexOf')），所有 apply/preview 一律 422。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { collectState, generateAndInstall } from '../tools/install.mjs'
import { serializeState } from '../plugins/paoding-config-ui/api-core.mjs'

/** 空白隔离环境：临时 dshHome（无 patch 文件 → 不握手），无既有配置文件。 */
function freshEnv() {
  const dshHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-apply-'))
  // configFile 不落盘 = 无既有配置（loadConfig 对 ENOENT 回 null，走 fresh 安装路径）
  return { dshHome, configFile: path.join(dshHome, 'dsh-paoding.config.yml') }
}

test('契约钉死：serializeState 视图喂 generateAndInstall 必抛错（0.3.0 apply 422 回归）', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  const view = serializeState(state) // 浏览器 JSON 视图
  // 形状自证：视图确实丢了生成管线必需的字段 / 改了容器类型（契约前提）
  assert.equal(view.dstDir, undefined, 'JSON 视图丢失 dstDir')
  assert.equal(view.yamlMod, undefined, 'JSON 视图丢失 yamlMod')
  assert.ok(Array.isArray(view.inventory), 'JSON 视图 inventory 已变数组（原始为 Set）')
  assert.equal(view.inventory.has, undefined)
  assert.ok(!(view.blocks instanceof Map), 'JSON 视图 blocks 已变普通对象（原始为 Map）')
  // 喂视图必抛错：具体文案随 assignments 形状不同而不同（path 参数 / has / get /
  // indexOf 等），故只断言 throws、不断言消息。
  assert.throws(() => generateAndInstall(view, structuredClone(state.suggested), { dryRun: true }))
})

test('对照组：原始 state 喂 generateAndInstall(dryRun) 正常返回，差异确实来自序列化', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  // 同一份 assignments（suggested 深拷贝，含 roles / 主 agent 键的完整形状）：
  // 原始 state 走 dryRun 预览必须正常返回，不落任何盘。
  const result = generateAndInstall(state, structuredClone(state.suggested), { dryRun: true })
  assert.equal(result.wrote, false, 'dryRun 预览不得落盘')
  assert.ok(Array.isArray(result.roleResults), 'roleResults 应为数组')
  assert.equal(typeof result.text, 'string')
  assert.equal(result.presetId, 'orchestrator')
})
