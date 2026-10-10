/**
 * 委派子代理标签带角色名回归测试（node:test，纯内存伪造 ctx + 临时 dshHome，
 * 禁网络 —— collectState 只在无 patch 文件的临时目录上跑，不触发 MCP 握手；
 * 禁依赖真实 $DSH_HOME）。覆盖三组：
 *   - delegation-labels.mjs 插件：tools/pre-execute 处理器注册与改写（命中角色
 *     加「角色名 · 」前缀、幂等不双写、非角色/缺 description/空 description/
 *     非字符串/arguments 异形一律不动、异常仍放行且 warn 一次、roles 全空不
 *     注册处理器、next() 返回值透传）；
 *   - 生成/安装链路：assertPresetSourceFiles 对 delegation-labels.mjs 与
 *     restrict.mjs 同口径、PRESET_ASIS_FILES 清单钉死、generateAndInstall
 *     物化四件套 + 生成文本 roles 映射 + 声明行绝对 file: URL。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { apply, name as PLUGIN_NAME } from '../presets/orchestrator/delegation-labels.mjs'
import { PRESET_ASIS_FILES, assertPresetSourceFiles, collectState, generateAndInstall } from '../tools/lib/state.mjs'
import { SRC_DIR } from '../tools/lib/util.mjs'

// ── 插件单测：伪造 ctx ──────────────────────────────────────────────────────

/** 伪造 ctx：捕获 ctx.on 注册的 (event, handler)，收集 logger.warn 文案。 */
function fakeCtx() {
  const handlers = {}
  const warnings = []
  const ctx = {
    on(event, handler) {
      handlers[event] = handler
    },
    logger: { warn: (msg) => warnings.push(msg) },
  }
  return { ctx, handlers, warnings }
}

/** 注册一个只带显示名映射的插件，返回 tools/pre-execute 处理器。 */
function handlerOf(config) {
  const { ctx, handlers } = fakeCtx()
  apply(ctx, config)
  return handlers['tools/pre-execute']
}

/** 跑一次瀑布，返回 next 调用信息与 handler 返回值。 */
async function run(handler, exec, nextResult = 'NEXT') {
  let nextCalled = 0
  const result = await handler(exec, async () => {
    nextCalled++
    return nextResult
  })
  return { result, nextCalled }
}

test('命中角色且 description 非空 → 前缀注入；next() 返回值透传', async () => {
  const handler = handlerOf({ roles: { implement: '民工码农' } })
  const args = { description: '修复标签显示' }
  const { result, nextCalled } = await run(handler, { name: 'implement', arguments: args })
  assert.equal(args.description, '民工码农 · 修复标签显示')
  assert.equal(nextCalled, 1, '放行恰好一次')
  assert.equal(result, 'NEXT', 'next() 返回值原样透传')
})

test('已带前缀 → 不双写（幂等）', async () => {
  const handler = handlerOf({ roles: { implement: '民工码农' } })
  const args = { description: '民工码农 · 修复标签显示' }
  await run(handler, { name: 'implement', arguments: args })
  assert.equal(args.description, '民工码农 · 修复标签显示')
})

test('非角色工具 → 不动；自定义分隔符生效；显示名 trim 后落前缀', async () => {
  const handler = handlerOf({ separator: '：', roles: { design: '  设计师  ' } })
  const grepArgs = { description: '找调用点' }
  await run(handler, { name: 'grep', arguments: grepArgs })
  assert.equal(grepArgs.description, '找调用点', '映射外的工具名不改写')

  const designArgs = { description: '画个首页' }
  await run(handler, { name: 'design', arguments: designArgs })
  assert.equal(designArgs.description, '设计师：画个首页')
})

test('description 缺失 / 空 / 纯空白 / 非字符串 → 不动', async () => {
  const handler = handlerOf({ roles: { implement: '民工码农' } })
  for (const description of [undefined, null, '', '   ', 42, {}]) {
    const args = { description }
    await run(handler, { name: 'implement', arguments: args })
    assert.equal(args.description, description, `description=${JSON.stringify(description)} 应保持原样`)
  }
  const noArgs = { name: 'implement' }
  await run(handler, noArgs)
  assert.equal(noArgs.description, undefined, 'arguments 缺 description 不新增键')
})

test('arguments 为 null / 非对象（含字符串、数字、数组）→ 不动、不炸', async () => {
  const handler = handlerOf({ roles: { implement: '民工码农' } })
  for (const args of [null, 'str', 42, ['a']]) {
    const exec = { name: 'implement', arguments: args }
    const { nextCalled } = await run(handler, exec)
    assert.equal(nextCalled, 1, `arguments=${JSON.stringify(args)} 仍应放行`)
  }
})

test('handler 内部异常 → 仍返回 next() 结果，warn 恰一次不再刷', async () => {
  const { ctx, handlers, warnings } = fakeCtx()
  apply(ctx, { roles: { implement: '民工码农' } })
  const handler = handlers['tools/pre-execute']
  // arguments 取值即抛（模拟下游异形对象）：改写路径炸掉也必须放行
  const boomExec = {
    get name() {
      return 'implement'
    },
    get arguments() {
      throw new Error('boom')
    },
  }
  const result = await run(handler, boomExec, 'PASSTHROUGH')
  assert.equal(result.result, 'PASSTHROUGH', '异常不得吞掉放行')
  assert.equal(result.nextCalled, 1)
  assert.equal(warnings.length, 1, '出错 warn 一次')

  const before = warnings.length
  await run(handler, boomExec, 'PASSTHROUGH2')
  assert.equal(warnings.length, before, '同一进程内不重复刷 warn')
})

test('roles 全空（缺 config / 空对象 / 全空名）→ apply 不注册任何处理器', () => {
  for (const config of [undefined, {}, { roles: {} }, { roles: { implement: '' } }, { roles: { implement: '   ' } }, { roles: { '': '无名' } }]) {
    const { ctx, handlers } = fakeCtx()
    apply(ctx, config)
    assert.equal(handlers['tools/pre-execute'], undefined, `config=${JSON.stringify(config ?? null)} 不应注册处理器`)
  }
})

test('插件名钉死（cordis 装载诊断用）', () => {
  assert.equal(PLUGIN_NAME, 'orchestrator-delegation-labels')
})

// ── 生成/安装链路 ───────────────────────────────────────────────────────────

test('assertPresetSourceFiles: delegation-labels.mjs 与 restrict.mjs 同口径（缺任一件即点名报错）', () => {
  // 真实源目录四件齐全 → 通过
  assert.doesNotThrow(() => assertPresetSourceFiles(SRC_DIR))

  // 只缺 delegation-labels.mjs → 报错点名它
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-dl-src-'))
  for (const f of ['agent.cordis.yml', 'preset.yml', 'restrict.mjs']) {
    writeFileSync(path.join(dir, f), '# stub\n')
  }
  assert.throws(() => assertPresetSourceFiles(dir), /missing preset source file: .*delegation-labels\.mjs/)

  // 只缺 restrict.mjs → 报错点名它（同款口径，防止清单只照顾新文件）
  writeFileSync(path.join(dir, 'delegation-labels.mjs'), '// stub\n')
  const restrictPath = path.join(dir, 'restrict.mjs')
  renameSync(restrictPath, `${restrictPath}.away`)
  try {
    assert.throws(() => assertPresetSourceFiles(dir), /missing preset source file: .*restrict\.mjs/)
  } finally {
    renameSync(`${restrictPath}.away`, restrictPath)
  }
})

test('PRESET_ASIS_FILES 清单钉死：原样复制件 = preset.yml + restrict.mjs + delegation-labels.mjs', () => {
  assert.deepEqual([...PRESET_ASIS_FILES], ['preset.yml', 'restrict.mjs', 'delegation-labels.mjs'])
})

test('安装链路: generateAndInstall 物化四件套，生成文本与声明行都带 roles 映射 / 绝对 URL', async () => {
  const dshHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-dl-inst-'))
  const configFile = path.join(dshHome, 'dsh-paoding.config.yml')
  const state = await collectState({ dshHome, configFile, cwd: dshHome, runtimeFacts: { presetSystem: 'declarative' } })

  const suggested = structuredClone(state.suggested)
  suggested.roles.implement = { ...(suggested.roles.implement ?? {}), name: '民工码农' }
  suggested.roles.design = { ...(suggested.roles.design ?? {}), name: '设计师' }
  generateAndInstall(state, suggested, {})

  // 四件套落盘（原样复制件来自 PRESET_ASIS_FILES，重写件 agent.cordis.yml）
  const dstDir = path.join(dshHome, '.agent-presets', 'orchestrator')
  for (const f of ['agent.cordis.yml', ...PRESET_ASIS_FILES]) {
    assert.ok(existsSync(path.join(dstDir, f)), `产物缺失: ${f}`)
  }

  // 生成文本：roles 占位被实际映射替换（键字典序），无名字的角色不进映射
  const agentText = readFileSync(path.join(dstDir, 'agent.cordis.yml'), 'utf8')
  const segStart = agentText.indexOf('- id: delegation-labels')
  assert.notEqual(segStart, -1, '生成文本应保留 delegation-labels 行')
  const segEnd = agentText.indexOf('# ── shell', segStart)
  const seg = agentText.slice(segStart, segEnd)
  assert.ok(seg.includes('    roles:\n      design: 设计师\n      implement: 民工码农\n'), 'roles 映射应按字典序落盘')
  assert.ok(!seg.includes('search_external'), '没配名字的角色不得进映射')

  // 声明行：delegation-labels 行换绝对 file: URL，不残留相对名（与 restrict 同款）
  const patchText = readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8')
  assert.ok(
    patchText.includes(`name: ${pathToFileURL(path.join(dstDir, 'delegation-labels.mjs')).href}`),
    '声明行内 delegation-labels 必须是绝对 file: URL',
  )
  assert.ok(!patchText.includes('./delegation-labels.mjs'), '声明行不得残留相对路径')
})

test('安装链路: 全默认（无名字）配置 roles 占位原样保留', async () => {
  const dshHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-dl-bare-'))
  const configFile = path.join(dshHome, 'dsh-paoding.config.yml')
  const state = await collectState({ dshHome, configFile, cwd: dshHome, runtimeFacts: { presetSystem: 'directory' } })
  generateAndInstall(state, structuredClone(state.suggested), {})
  const dstDir = path.join(dshHome, '.agent-presets', 'orchestrator')
  const agentText = readFileSync(path.join(dstDir, 'agent.cordis.yml'), 'utf8')
  assert.ok(agentText.includes('    roles: {}          # 生成器按 roles.<toolName>.name 填充'), '无名字配置应保持空占位')
})

test('安装链路: 四个角色都有名字时 roles 映射完整收录（含自定义角色）', async () => {
  const dshHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-dl-roles-'))
  const configFile = path.join(dshHome, 'dsh-paoding.config.yml')
  const state = await collectState({ dshHome, configFile, cwd: dshHome, runtimeFacts: { presetSystem: 'directory' } })

  // 四角色全带名字 + 自定义角色：全部进映射（独立临时目录，只装一次）
  const suggested = structuredClone(state.suggested)
  suggested.roles.implement = { name: '民工码农' }
  suggested.roles.design = { name: '设计师' }
  suggested.roles.search_external = { name: '侦察兵' }
  suggested.roles['skill-finder'] = { name: '技能专家', tools: ['read', 'grep'] }
  generateAndInstall(state, suggested, {})
  const dstDir = path.join(dshHome, '.agent-presets', 'orchestrator')
  const agentText = readFileSync(path.join(dstDir, 'agent.cordis.yml'), 'utf8')
  const segStart = agentText.indexOf('- id: delegation-labels')
  const segEnd = agentText.indexOf('# ── shell', segStart)
  const seg = agentText.slice(segStart, segEnd)
  for (const row of ['design: 设计师', 'implement: 民工码农', 'search_external: 侦察兵', 'skill-finder: 技能专家']) {
    assert.ok(seg.includes(`      ${row}\n`), `roles 映射缺 ${row}`)
  }
})
