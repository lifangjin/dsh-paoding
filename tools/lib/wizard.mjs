/**
 * 交互式安装向导：runWizard（readline 驱动全流程；node:readline 保持原文件的
 * 动态 import('node:readline')）与 createCustomRole（新角色工具池选择）。
 * 依赖 util（ROLES）、config（normalizeMainAgentName / normalizeModelRef）、
 * host（isHostDependent）与 compose（firstLine）；被 cli 引用。
 */
import { ROLES } from './util.mjs'
import { normalizeMainAgentName, normalizeModelRef } from './config.mjs'
import { isHostDependent } from './host.mjs'
import { firstLine } from './compose.mjs'

// ── interactive wizard ──────────────────────────────────────────────────────

/**
 * Interactive install wizard (readline, zero dependencies).  Walks the user
 * through: detection report → MCP server assignment (default roles, main
 * agent, none, or a freshly created custom role) → custom role creation →
 * optional tweaks of the default roles → builtin role deletion
 * (roles_remove) → main-agent rename (main_agent_name) → builtin-role model
 * config (roles.<toolName>.model / .provider，4d：映射到 dsh-tool-subagent 的
 * agentOptions，回车 = 跟随主 agent 不注入) → main-agent base-tool removal →
 * skill assignment → main-agent soft skill rows (optional hard inline subset)
 * → confirm summary.  Returns the assignments object { roles, roles_remove,
 * main_agent_extra, main_agent_remove, main_agent_skills,
 * main_agent_skills_inline, main_agent_persona_extra, main_agent_name,
 * skills }，roles 条目形状 { name, model, provider, persona, tools }（内置角色
 * model/provider 取向导 4d 结果；自定义角色从 existingConfig 透传保留）。
 * main_agent_persona_extra 无独立问题步骤：从 existingConfig 原样继承（缺省 null），
 * null 时 compose 回落默认常量 DEFAULT_MAIN_AGENT_PERSONA_EXTRA；编辑/清空走配置 UI
 * 或手编配置。roles_remove / main_agent_name 同样从 existingConfig 继承为初值。
 */
export async function runWizard({ inventory, mcpReports, pluginReports, skills, staticBase, suggested, existingConfig, personaBlocks, srcText, restrictBase }) {
  const { createInterface } = await import('node:readline')
  // Node's rl.question() hangs on the second call when stdin is not a TTY, so
  // drive prompts from a line queue + one pending resolver instead.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  const inputQueue = []
  let pending = null
  rl.on('line', (line) => {
    if (pending !== null) {
      const resolve = pending
      pending = null
      resolve(line)
    } else {
      inputQueue.push(line)
    }
  })
  rl.on('close', () => {
    // Resolve any pending prompt with an empty line so the wizard can end
    // cleanly when stdin is exhausted early.
    if (pending !== null) {
      const resolve = pending
      pending = null
      resolve('')
    }
  })
  process.on('SIGINT', () => {
    console.log('\naborted')
    process.exit(130)
  })
  const question = (prompt) =>
    new Promise((resolve) => {
      if (inputQueue.length > 0) {
        resolve(inputQueue.shift())
        return
      }
      process.stdout.write(prompt)
      pending = resolve
    })
  const ask = async (prompt, fallback = '') => {
    const raw = (await question(prompt)).trim()
    return raw === '' ? fallback : raw
  }

  // Working state.  Seeded from the existing config when present (explicit
  // role tools/personas win), otherwise from smart defaults; custom roles are
  // appended during the wizard.
  const roleOrder = [...ROLES]
  const roleTools = new Map()
  const rolePersonas = new Map()
  // 角色专用模型工作态（roles.<toolName>.model / .provider，向导 4d）：内置角色
  // 从 existingConfig 播种（?? null = 跟随主 agent），suggested / 静态播种的内置
  // 角色一律 null（smartDefaults 不设模型）；自定义角色在结尾 rolesOut 处从
  // existingConfig 透传，不经这两个 Map。
  const roleModels = new Map()
  const roleProviders = new Map()
  const mainAgentExtra = new Set(existingConfig?.main_agent_extra ?? suggested.main_agent_extra)
  const mainAgentRemove = new Set(existingConfig?.main_agent_remove ?? [])
  const mainAgentSkills = new Set(existingConfig?.main_agent_skills ?? [])
  const mainAgentSkillsInline = new Set(existingConfig?.main_agent_skills_inline ?? [])
  const skillsMap = new Map(Object.entries(existingConfig?.skills ?? {}))
  for (const [toolName, role] of Object.entries(suggested.roles)) {
    roleTools.set(toolName, new Set(role.tools))
    rolePersonas.set(toolName, role.persona)
    roleModels.set(toolName, role.model ?? null)
    roleProviders.set(toolName, role.provider ?? null)
  }
  // Ensure every default role is present (seeded from the static base) so the
  // summary and the tweak step always see them, even when a role received no
  // host tools.
  for (const role of ROLES) {
    if (!roleTools.has(role)) {
      roleTools.set(role, new Set(staticBase[role] ?? []))
      rolePersonas.set(role, null)
      roleModels.set(role, null)
      roleProviders.set(role, null)
    }
  }
  for (const [toolName, role] of Object.entries(existingConfig?.roles ?? {})) {
    if (!roleTools.has(toolName)) roleOrder.push(toolName)
    roleTools.set(toolName, new Set(role.tools ?? []))
    rolePersonas.set(toolName, role.persona ?? null)
    roleModels.set(toolName, role.model ?? null)
    roleProviders.set(toolName, role.provider ?? null)
  }
  // 4b/4c 的持久状态：roles_remove / main_agent_name 从既有配置继承为初值。
  const rolesRemove = new Set(existingConfig?.roles_remove ?? [])
  let mainAgentName = existingConfig?.main_agent_name ?? null
  // 既有配置里已删除的内置角色不进角色列表/摘要/后续分配（同步工作集）。
  for (const role of [...rolesRemove]) {
    const i = roleOrder.indexOf(role)
    if (i !== -1) roleOrder.splice(i, 1)
    roleTools.delete(role)
    rolePersonas.delete(role)
    roleModels.delete(role)
    roleProviders.delete(role)
  }
  const mergeRole = (toolName, tools) => {
    if (!roleTools.has(toolName)) {
      roleTools.set(toolName, new Set())
      rolePersonas.set(toolName, null)
      roleOrder.push(toolName)
    }
    for (const t of tools) roleTools.get(toolName).add(t)
  }

  // Tool pool for custom-role selection: union of the static role allows plus
  // every detected host tool.
  const toolPool = [...new Set([...ROLES.flatMap((r) => staticBase[r] ?? []), ...inventory])].sort()

  // 1. welcome + detection report
  console.log('\ndsh-paoding（庖丁）交互式安装向导')
  console.log('-------------------------')
  console.log('检测到的工具：')
  for (const r of mcpReports) {
    const tools = [...inventory].filter((n) => n.startsWith(`mcp__${r.serverName}__`)).join(', ')
    console.log(`  MCP ${r.serverName} (${r.transport ?? '-'}): ${tools || '(no tools resolved)'}`)
  }
  for (const p of pluginReports) console.log(`  插件 ${p.label}: ${p.tools.join(', ')}`)
  if (skills.length > 0) console.log(`  技能: ${skills.join(', ')}`)
  console.log()

  // 2. per-server assignment
  for (const report of mcpReports) {
    const serverTools = [...inventory].filter((n) => n.startsWith(`mcp__${report.serverName}__`))
    if (serverTools.length === 0) continue
    const current = (() => {
      for (const [toolName, tools] of roleTools) {
        if (serverTools.every((t) => tools.has(t))) return toolName
      }
      if (serverTools.every((t) => mainAgentExtra.has(t))) return '主 agent'
      return '未分配'
    })()
    console.log(`服务器 ${report.serverName} 的工具: ${serverTools.join(', ')}`)
    console.log(`  当前分配: ${current}`)
    const choices = ['search_external', 'design', 'implement', '主 agent', '不分配', ...roleOrder.filter((r) => !ROLES.includes(r))]
    const menu = choices.map((c, i) => `[${i + 1}] ${c}`).join('  ')
    console.log(`  分配到哪里？ ${menu}  [0] 新建角色  [回车] 保持`)
    const pick = (await ask('  > ')).trim()
    if (pick === '') continue
    if (pick === '0') {
      const toolName = await createCustomRole({ question, ask, toolPool, roleTools, rolePersonas, roleOrder })
      if (toolName) {
        mergeRole(toolName, serverTools)
        console.log(`  → ${serverTools.length} 个工具已加入角色 ${toolName}`)
      }
      continue
    }
    const idx = Number(pick)
    if (!Number.isInteger(idx) || idx < 1 || idx > choices.length) {
      console.log('  无效输入，保持当前分配')
      continue
    }
    const target = choices[idx - 1]
    if (target === '主 agent') {
      for (const t of serverTools) {
        for (const set of roleTools.values()) set.delete(t)
        mainAgentExtra.add(t)
      }
    } else if (target === '不分配') {
      for (const t of serverTools) {
        for (const set of roleTools.values()) set.delete(t)
        mainAgentExtra.delete(t)
      }
    } else {
      mergeRole(target, serverTools)
      for (const t of serverTools) mainAgentExtra.delete(t)
    }
    console.log(`  → ${report.serverName} → ${target}`)
  }

  // 3. offer creating more custom roles
  for (;;) {
    const more = (await ask('创建自定义角色？[y/N] ', 'N')).toLowerCase()
    if (more !== 'y') break
    const toolName = await createCustomRole({ question, ask, toolPool, roleTools, rolePersonas, roleOrder })
    if (!toolName) break
    console.log(`  角色 ${toolName} 已创建`)
  }

  // 4. optional tweaks of the default roles (已删除/将删除的角色跳过)
  const tweak = (await ask('调整默认角色的 persona 或工具？[y/N] ', 'N')).toLowerCase()
  if (tweak === 'y') {
    for (const role of ROLES) {
      if (rolesRemove.has(role)) continue // roles_remove 命中的角色不再可调（整条委派行删除）
      console.log(`\n角色 ${role} — 当前工具 (${roleTools.get(role)?.size ?? 0}): ${[...(roleTools.get(role) ?? [])].join(', ')}`)
      if ((await ask('  修改 persona？[y/N] ', 'N')).toLowerCase() === 'y') {
        console.log('  输入新 persona（单独一行 `.` 结束，空行保持默认）：')
        const lines = []
        for (;;) {
          const line = await question('    > ')
          if (line.trim() === '.') break
          lines.push(line)
        }
        if (lines.length > 0) rolePersonas.set(role, lines.join('\n').trim())
      }
      const add = (await ask('  添加工具（工具池编号，逗号分隔，回车跳过）？', '')).trim()
      if (add !== '') {
        for (const n of add.split(',')) {
          const i = Number(n.trim())
          if (Number.isInteger(i) && i >= 1 && i <= toolPool.length) roleTools.get(role).add(toolPool[i - 1])
        }
      }
      const del = (await ask('  移除工具（当前列表编号，逗号分隔，回车跳过）？', '')).trim()
      if (del !== '') {
        const list = [...roleTools.get(role)]
        for (const n of del.split(',')) {
          const i = Number(n.trim())
          if (Number.isInteger(i) && i >= 1 && i <= list.length) roleTools.get(role).delete(list[i - 1])
        }
      }
    }
  }

  // 4b. 删除内置角色（roles_remove）：整条委派行 + 主 persona 引用 + restrict allow
  // 三处一并移除；非法名提示重问，回车 = 不新增删除（既有配置里已删的保持删除）。
  if (rolesRemove.size > 0) console.log(`  已配置删除内置角色: ${[...rolesRemove].join(', ')}`)
  for (;;) {
    const delBuiltin = (await ask('删除内置角色？(空格分隔名字, 回车=不删)：')).trim()
    if (delBuiltin === '') break
    const tokens = delBuiltin.split(/\s+/)
    const unknown = tokens.filter((t) => !ROLES.includes(t))
    if (unknown.length > 0) {
      console.log(`  '${unknown.join("', '")}' 不是内置角色（可选: ${ROLES.join(', ')}），请重输`)
      continue
    }
    for (const t of tokens) {
      if (rolesRemove.has(t)) continue
      rolesRemove.add(t)
      const i = roleOrder.indexOf(t)
      if (i !== -1) roleOrder.splice(i, 1)
      roleTools.delete(t)
      rolePersonas.delete(t)
      roleModels.delete(t)
      roleProviders.delete(t)
      console.log(`  → 已标记删除内置角色: ${t}`)
    }
    break
  }

  // 4c. 主 agent 名称（main_agent_name）：preset 显示名 + persona 身份行两处生效；
  // 回车 = 维持默认（既有配置已设名则保持该名，否则默认「编排模式 (Orchestrator)」）。
  const nameHint = existingConfig?.main_agent_name ?? '默认编排模式 (Orchestrator)'
  for (;;) {
    const raw = (await ask(`主 agent 名称？(显示名 + persona 身份行，回车 = ${nameHint})：`)).trim()
    if (raw === '') break
    try {
      mainAgentName = normalizeMainAgentName(raw)
      break
    } catch (err) {
      console.log(`  ${err.message}，请重输（回车 = 保持默认「${nameHint}」）`)
    }
  }

  // 4d. 内置角色专用模型（roles.<toolName>.model / .provider）：生成层映射到
  // dsh-tool-subagent 的 agentOptions（provider 在前、model 在后）。回车 = 跟随
  // 主 agent（null，不注入）；provider 仅在模型非空时才问/生效。roles_remove
  // 命中的角色跳过（委派行已整条删除）。非 TTY / 回车跳过时保持播种值不变。
  if ((await ask('为内置角色配置专用模型？[y/N] ', 'N')).toLowerCase() === 'y') {
    for (const role of ROLES) {
      if (rolesRemove.has(role)) continue
      const currentModel = roleModels.get(role) ?? null
      const currentProvider = roleProviders.get(role) ?? null
      console.log(`  角色 ${role} — 当前模型: ${currentModel ? `${currentProvider ? currentProvider + '/' : ''}${currentModel}` : '（跟随主 agent）'}`)
      for (;;) {
        const raw = (await ask('    专用模型 id（回车=跟随主 agent）：')).trim()
        if (raw === '') {
          roleModels.set(role, null)
          break
        }
        try {
          roleModels.set(role, normalizeModelRef(raw, `roles.${role}.model`))
          break
        } catch (err) {
          console.log(`    ${err.message}，请重输（回车 = 跟随主 agent）`)
        }
      }
      // provider-alone 不生效：模型为空时 provider 强制置 null，不再提问。
      if ((roleModels.get(role) ?? null) !== null) {
        for (;;) {
          const raw = (await ask('    provider 路由（回车=跟随主 agent 的 provider，如 deepseek-official）：')).trim()
          if (raw === '') {
            roleProviders.set(role, null)
            break
          }
          try {
            roleProviders.set(role, normalizeModelRef(raw, `roles.${role}.provider`))
            break
          } catch (err) {
            console.log(`    ${err.message}，请重输（回车 = 跟随主 agent 的 provider）`)
          }
        }
      } else {
        roleProviders.set(role, null)
      }
    }
  }

  // 5. main-agent base-tool removal (main_agent_remove)
  const mainBase = [...new Set([...(restrictBase ?? []), ...mainAgentExtra])]
    .filter((n) => !isHostDependent(n) || inventory.has(n))
  console.log(`\n主 agent 工具面 (${mainBase.length}): ${mainBase.join(', ')}`)
  if (mainAgentRemove.size > 0) console.log(`  已配置移除: ${[...mainAgentRemove].join(', ')}`)
  const delMain = (await ask('  移除基础工具（编号，逗号分隔，回车跳过）？', '')).trim()
  if (delMain !== '') {
    const picks = delMain.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= mainBase.length)
    const removing = picks.map((n) => mainBase[n - 1])
    const remaining = mainBase.filter((n) => !mainAgentRemove.has(n) && !removing.includes(n))
    if (remaining.length === 0) {
      console.log('  拒绝：这会清空主 agent 的全部工具')
    } else {
      for (const n of removing) mainAgentRemove.add(n)
      console.log(`  → 已标记移除: ${removing.join(', ')}`)
    }
  }
  if (mainAgentRemove.size > 0) {
    const removedList = [...mainAgentRemove]
    console.log(`  可恢复项 (${removedList.length}): ${removedList.map((n, i) => `[${i + 1}] ${n}`).join('  ')}`)
    const restore = (await ask('  恢复已移除工具（编号，逗号分隔，回车跳过）？', '')).trim()
    if (restore !== '') {
      for (const s of restore.split(',')) {
        const i = Number(s.trim())
        if (Number.isInteger(i) && i >= 1 && i <= removedList.length) mainAgentRemove.delete(removedList[i - 1])
      }
    }
  }

  // 6. skill assignment (only roles whose allow includes `skill` can use them)
  const skillCapable = [...roleTools.entries()].filter(([, tools]) => tools.has('skill')).map(([toolName]) => toolName)
  if (skills.length > 0 && skillCapable.length > 0) {
    console.log('\n技能分配（引导写入角色 persona；skill 目录对角色全量可见，这是 DSH 的软约束）：')
    for (const skill of skills) {
      const currentRoles = skillsMap.get(skill) ?? []
      const menu = skillCapable.map((r, i) => `[${i + 1}] ${r}`).join('  ')
      const pick = await ask(`  ${skill} 分配给哪些角色？ ${menu}  [0] 不分配  [回车] 保持(${currentRoles.join(', ') || '不分配'}) `)
      if (pick.trim() === '') continue
      const chosen = pick.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= skillCapable.length)
      if (chosen.length > 0) skillsMap.set(skill, chosen.map((n) => skillCapable[n - 1]))
      else skillsMap.delete(skill)
    }
  }

  // 6b. main-agent soft skill rows (main_agent_skills): the selected skills'
  // compact rows (name + description + SKILL.md path) are written into the
  // main-agent persona — the main agent has no skill tool / directory
  // injection, so it loads a skill's full rules on demand with its own read
  // tool when a task matches (same soft-guidance semantics as roles).
  if (skills.length > 0) {
    console.log('\n主 agent 技能（软引导：写入 persona 技能行，主 agent 用 read 按需加载正文）：')
    console.log(`  ${skills.map((s, i) => `[${i + 1}] ${s}`).join('  ')}`)
    const current = [...mainAgentSkills].filter((s) => skills.includes(s)).join(', ') || '(无)'
    const pick = (await ask(`  选择（编号逗号分隔，0 清空，回车保持${current}）：`)).trim()
    if (pick === '0') {
      mainAgentSkills.clear()
    } else if (pick !== '') {
      const chosen = pick.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= skills.length)
      if (chosen.length > 0) {
        mainAgentSkills.clear()
        for (const n of chosen) mainAgentSkills.add(skills[n - 1])
      }
    }
  }

  // 6c. optional hard inline subset (main_agent_skills_inline): the skills
  // picked here are inlined in full into the main-agent persona instead of a
  // soft row (fixed per-response persona cost) — for style skills like caveman
  // that must apply unconditionally.
  if (skills.length > 0) {
    console.log('\n其中哪些需全文内联硬生效（风格技能，如 caveman；编号逗号分隔，0 清空，回车保持）？')
    console.log(`  ${skills.map((s, i) => `[${i + 1}] ${s}`).join('  ')}`)
    const current = [...mainAgentSkillsInline].filter((s) => skills.includes(s)).join(', ') || '(无)'
    const pick = (await ask(`  选择（编号逗号分隔，0 清空，回车保持${current}）：`)).trim()
    if (pick === '0') {
      mainAgentSkillsInline.clear()
    } else if (pick !== '') {
      const chosen = pick.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= skills.length)
      if (chosen.length > 0) {
        mainAgentSkillsInline.clear()
        for (const n of chosen) mainAgentSkillsInline.add(skills[n - 1])
      }
    }
  }

  // 7. confirmation summary
  console.log('\n确认摘要：')
  for (const toolName of roleOrder) {
    const persona = rolePersonas.get(toolName)
    // 模型信息：内置角色取 4d 工作态；自定义角色播种自 existingConfig（新 建 角色
    // 无 Map 项 → ?? null = 跟随主 agent）。
    const model = roleModels.get(toolName) ?? null
    const provider = roleProviders.get(toolName) ?? null
    console.log(
      `  ${toolName}: ${roleTools.get(toolName)?.size ?? 0} 工具${persona ? ` | persona: ${firstLine(persona)}` : ''}` +
        `${model ? ` | 模型: ${provider ? provider + '/' : ''}${model}` : ''}`,
    )
  }
  console.log(`  主 agent 追加: ${[...mainAgentExtra].join(', ') || '(无)'}`)
  console.log(`  主 agent 移除: ${[...mainAgentRemove].join(', ') || '(无)'}`)
  console.log(`  主 agent 技能: ${[...mainAgentSkills].join(', ') || '(无)'}`)
  if (mainAgentSkillsInline.size > 0) console.log(`  主 agent 技能(内联): ${[...mainAgentSkillsInline].join(', ')}`)
  if (rolesRemove.size > 0) console.log(`  内置角色已删除: ${[...rolesRemove].join(', ')}（委派行/主 persona 引用/restrict allow 一并移除）`)
  if (mainAgentName !== null) console.log(`  主 agent 名称: ${mainAgentName}`)
  if (skillsMap.size > 0) {
    for (const [skill, roleList] of skillsMap) console.log(`  技能 ${skill} → ${roleList.join(', ')}`)
  }
  const confirmed = (await ask('\n确认安装并写入配置？[Y/n] ', 'Y')).toLowerCase()
  rl.close()
  if (confirmed === 'n') {
    console.log('已取消，未写入任何文件')
    return null
  }

  const roles = {}
  for (const toolName of roleOrder) {
    const tools = [...(roleTools.get(toolName) ?? [])]
    if (tools.length === 0 && ROLES.includes(toolName)) continue
    // 内置角色显示名（roles.<toolName>.name）从 existingConfig 继承：向导不提供改名步骤，
    // 但不许在保存时静默丢键（用户手编或 UI 面板配过的 name 要在向导重跑后保留）。
    // 专用模型同理：内置角色取 4d 工作态；自定义角色向导不提供模型步骤，model /
    // provider 从 existingConfig 透传保留（同款保留理由）。
    roles[toolName] = {
      name: ROLES.includes(toolName) ? (existingConfig?.roles?.[toolName]?.name ?? null) : null,
      model: ROLES.includes(toolName) ? (roleModels.get(toolName) ?? null) : (existingConfig?.roles?.[toolName]?.model ?? null),
      provider: ROLES.includes(toolName) ? (roleProviders.get(toolName) ?? null) : (existingConfig?.roles?.[toolName]?.provider ?? null),
      persona: rolePersonas.get(toolName) ?? null,
      tools,
    }
  }
  const skillsOut = {}
  for (const [skill, roleList] of skillsMap) if (roleList.length > 0) skillsOut[skill] = roleList
  return {
    roles,
    roles_remove: [...rolesRemove],
    main_agent_extra: [...mainAgentExtra],
    main_agent_remove: [...mainAgentRemove],
    main_agent_skills: [...mainAgentSkills],
    main_agent_skills_inline: [...mainAgentSkillsInline],
    main_agent_persona_extra: existingConfig?.main_agent_persona_extra ?? null,
    main_agent_name: mainAgentName,
    skills: skillsOut,
  }
}

/** Prompt-driven creation of one custom role; returns its toolName or null. */
export async function createCustomRole({ ask, toolPool, roleTools, rolePersonas, roleOrder }) {
  const toolName = (await ask('  新角色 toolName（小写字母/数字/下划线，done 取消）: ')).trim()
  if (toolName === '' || toolName === 'done') return null
  if (!/^[a-z][a-z0-9_]*$/.test(toolName)) {
    console.log('  toolName 需匹配 /^[a-z][a-z0-9_]*$/')
    return null
  }
  if (roleTools.has(toolName)) {
    console.log(`  角色 ${toolName} 已存在`)
    return null
  }
  console.log('  工具池（输入逗号分隔编号，all 全选，none 清空）：')
  // 零工具重问循环：tools 为空的自定义角色会在应用时被生成器拒绝（空
  // toolFilter.allow → 子 agent 零工具），所以这里选不出工具就重显工具池重问，
  // 直到至少选了一个；回车 / 'none' 视为清空重问。刻意不设跳出口——想放弃就回
  // toolName 步骤输 done（本函数开头已处理）或直接 Ctrl-C；非 TTY 下向导根本
  // 不会进入（cli 已挡），不存在 stdin 耗尽死循环的路径。
  const picked = new Set()
  while (picked.size === 0) {
    for (let i = 0; i < toolPool.length; i++) {
      if (i % 4 === 0) console.log('    ')
      process.stdout.write(`${i + 1}:${toolPool[i]}  `)
    }
    console.log()
    const raw = (await ask('  > ')).trim()
    if (raw === 'all') toolPool.forEach((t) => picked.add(t))
    else if (raw !== 'none' && raw !== '') {
      for (const n of raw.split(',')) {
        const i = Number(n.trim())
        if (Number.isInteger(i) && i >= 1 && i <= toolPool.length) picked.add(toolPool[i - 1])
      }
    }
    if (picked.size === 0) console.log('  至少选择一个工具（零工具自定义角色会在应用时被拒绝）')
  }
  const personaInput = (await ask('  persona 一句话（回车默认）: ')).trim()
  const persona = personaInput === '' ? null : `You are the ${toolName} agent. ${personaInput}`
  roleTools.set(toolName, picked)
  rolePersonas.set(toolName, persona)
  roleOrder.push(toolName)
  console.log(`  ✓ 角色 ${toolName} 已创建（${picked.size} 工具）`)
  return toolName
}
