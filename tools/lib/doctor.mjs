/**
 * `dsh-paoding doctor` 的检查本体：只读体检，不动任何盘。与 health.mjs 的分工
 * ——healthCheck 管「这次保存/应用会怎样」（面向 preview / apply 响应与
 * --dry-run 报告的单次配置体检）；本模块管「这台机器装得正不正」（配置文件、
 * 预设安装轨道、托管声明行（home + profile 层双层：托管块损坏 / 整文件解析 /
 * 可疑坏行 / 行对账 / 层漂移）、孤儿工作区预设目录、版本标记、预设漂移六项环境
 * 对账），结果形状是人读导向的 { items: [{ status, label, detail }] }：
 *   status: 'ok' | 'warn' | 'error' | 'skip'（skip = 前置事实缺失，降级不炸——
 *   无 DSH_HOME / 无配置的干净机器上各项依此跳过）。
 *
 * 有意与 healthCheck 解耦、不复用其返回形状： doctor 的每项都有自己的前置探测
 * 与降级语义，硬塞进 level/code 模型只会两头别扭；仅「预设漂移」一项复用
 * healthCheck 的 preset_drift 判定（同一份 dry-run 对比，不另立标准）。
 *
 * 依赖 config（loadConfig）/ yaml（loadYaml）/ alloc（autoAssignments）/
 * state（collectState）/ lifecycle（workspacePresetOrphans，孤儿目录判据与
 * 清理侧同源）/
 * preset-system（轨道、托管块、标记）与 health（healthCheck）；被 cli 引用。
 * 零运行时依赖（node:fs / node:path / node:url）。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { loadConfig } from './config.mjs'
import { loadYaml } from './yaml.mjs'
import { autoAssignments } from './alloc.mjs'
import { collectState } from './state.mjs'
import { workspacePresetOrphans } from './lifecycle.mjs'
import {
  MANAGED_BEGIN,
  MANAGED_END,
  detectAgentRolesFlavor,
  detectHostVersionInfo,
  detectPresetSystem,
  findSuspectPresetRows,
  isDeclarativeTriple,
  isPtcWorkerHost,
  parseGeneratorMarker,
  presetRolesFlavorOf,
  readHomePatchRows,
  resolvePatchTargetLayer,
  validatePatchYaml,
} from './preset-system.mjs'
import { healthCheck } from './health.mjs'

const TRACK_LABELS = { declarative: '声明行轨 (declarative，DSH ≥ 0.1.7)', directory: '目录轨 (directory，DSH ≤ 0.1.6)' }
const trackLabel = (track) => TRACK_LABELS[track] ?? String(track ?? '未知')

/** 插件包版本（doctor 跑在插件包内，package.json 就在仓库根；读失败返回 null）。 */
function repoVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    return typeof pkg?.version === 'string' && pkg.version !== '' ? pkg.version : null
  } catch {
    return null
  }
}

function managedMarkerLines(text) {
  return new Set(
    String(text ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
  )
}

/**
 * 跑全套 doctor 检查。参数（全可缺省，干净机器上逐项降级）：
 *   - dshHome / configFile：DSH 家目录与配置文件路径。
 *   - profile：传给 collectState 的 patch 层（--profile，默认全缺省）。
 *   - state：调用方已采集的原始 state（测试注入用）；缺省时内部 collectState。
 *   - generatorVersion：标记对账基准；缺省读包内 package.json（测试可注入）。
 * 返回 { items, hasErrors }；本函数自身绝不 throw——单项探测失败折成条目。
 */
export async function runDoctor({ dshHome, configFile, profile = null, state = null, generatorVersion = null } = {}) {
  const items = []
  const add = (status, label, detail) => items.push({ status, label, detail })
  const version = generatorVersion ?? repoVersion()

  // 0) state：漂移与轨道两项的公共前置。拿不到时这两项降级，其余照查。
  let stateError = null
  if (state === null) {
    try {
      state = await collectState({ dshHome, configFile, profile, cwd: process.cwd() })
    } catch (err) {
      state = null
      stateError = err?.message ?? String(err)
    }
  }

  // ── 1. 配置文件存在性 / 可解析性 ──────────────────────────────────────────
  let config = null
  let configUsable = false
  if (!existsSync(configFile)) {
    add('skip', '配置文件', `${configFile} 不存在（全新安装语义：首装自动化会写入基础模板，不处理）`)
  } else {
    try {
      config = loadConfig(configFile, loadYaml(dshHome))
      configUsable = true
      add('ok', '配置文件', `${configFile} 存在且可解析`)
    } catch (err) {
      add('error', '配置文件', `${configFile} 无法解析：${err?.message ?? err}——请先修复（面板加载 / 生成都会被拒）`)
    }
  }

  // ── 2. 预设安装轨道 vs 宿主版本 ───────────────────────────────────────────
  const track = state?.presetSystem ?? (await detectPresetSystem({ dshHome }).catch(() => null))
  const hostInfo = detectHostVersionInfo()
  const hostTriple = hostInfo?.triple ?? null
  const hostPrerelease = hostInfo?.prerelease ?? null
  if (state === null && stateError !== null) {
    add('skip', '预设安装轨道', `检测管线不可用（${stateError}），跳过轨道核对`)
  } else if (hostTriple === null) {
    add('warn', '预设安装轨道', `当前判定 ${trackLabel(track)}，但宿主版本探测不到（PATH 上没有可用的 dsh），无法交叉验证`)
  } else {
    const expected = isDeclarativeTriple(hostTriple) ? 'declarative' : 'directory'
    const versionText = `${hostTriple[0]}.${hostTriple[1]}.${hostTriple[2]}`
    if (expected === track) {
      add('ok', '预设安装轨道', `宿主 ${versionText} ↔ ${trackLabel(track)}，一致`)
    } else {
      add('warn', '预设安装轨道', `宿主 ${versionText} 应走 ${TRACK_LABELS[expected]}，当前判定 ${trackLabel(track)}（下次 DSH 启动自愈会自动迁移）`)
    }
  }

  // ── 3. 声明行托管块（home + 目标 profile 层 patch 双层对账）───────────────
  // 层判定与写盘侧同一条链（resolvePatchTargetLayer：config 可用时按
  // patch_layer / profile 键，否则按环境自动——compat 壳 → profile 层）。
  // 每层四查：托管块损坏（error，既有口径）→ 整文件 YAML 解析（error：compat
  // 壳压平的坏行会让宿主在任何插件代码运行前死掉，dsh-maoying#1）→ 可疑坏行
  // （warn，只点名行号不删）→ 行对账（目录轨残留 / 孤儿行，既有口径）。最后
  // 层漂移：托管块只落在非目标层 → warn（下次自愈 / 保存会写目标层并撤遗留）。
  const layerTarget = resolvePatchTargetLayer(dshHome, { config })
  const layerEntries = [
    { layer: 'home', profileName: null, patchFile: path.join(dshHome, 'cordis.patch.yml') },
    { layer: 'profile', profileName: layerTarget.profileName, patchFile: layerTarget.patchPath },
  ]
  const seenPatchFiles = new Set()
  let blockLayerSeen = null
  for (const entry of layerEntries) {
    if (seenPatchFiles.has(entry.patchFile)) continue // 目标 profile 恰为 'web' 时与 home 同文件，不双报
    seenPatchFiles.add(entry.patchFile)
    let patchText = null
    try {
      patchText = readFileSync(entry.patchFile, 'utf8')
    } catch (err) {
      // home 层缺失维持既有 skip 口径（干净机器各项依此跳过）；profile 层缺失
      // 是常态（非 compat 壳 / 从未迁移过），静默。
      if (entry.layer === 'home' && err?.code === 'ENOENT') {
        add('skip', '声明行托管块', 'cordis.patch.yml 不存在（尚无声明行；目录轨宿主也不需要）')
      } else if (err?.code !== 'ENOENT') {
        add('skip', '声明行托管块', `${entry.patchFile} 读取失败（${err?.message ?? err}），跳过该层`)
      }
      continue
    }
    const layerName = entry.layer === 'home' ? '' : `（profile 层 ${entry.patchFile}）`
    const markers = managedMarkerLines(patchText)
    const hasBegin = markers.has(MANAGED_BEGIN)
    const hasEnd = markers.has(MANAGED_END)
    if (hasBegin) blockLayerSeen = blockLayerSeen ?? entry.layer
    if (hasBegin && !hasEnd) {
      add('error', '声明行托管块', `${layerName}托管块损坏（只有起始标记没有结束标记）：补回结束标记或删除整块，否则面板保存 / 自愈都会拒绝写盘`)
    }
    // 整文件 YAML 解析（宿主 yaml 包口径，与写盘校验 validatePatchYaml 同源；
    // yaml 包缺失退内置子集解析器——lenient，只兜 gross 损坏挡不住坏缩进）。
    const parseVerdict = validatePatchYaml(dshHome, patchText)
    if (!parseVerdict.ok) {
      add(
        'error',
        'patch 文件解析',
        `${entry.patchFile} 无法解析：${parseVerdict.message}——宿主启动会直接失败。请删除坏行或从 .bak-1 备份恢复` +
          '（Android compat 壳重写 patch 压平坏行的特征参见 dsh-maoying#1）',
      )
    }
    // 可疑坏行（maoying 坏行形状）：warn 点名行号，只诊断不删——删行可能踩
    // 用户手写内容，修复交给人或清理侧的行级手术。
    const suspects = findSuspectPresetRows(patchText)
    if (suspects.length > 0) {
      const lineNos = suspects.map((s) => s.lineNo).join('、')
      add(
        'warn',
        '声明行可疑行',
        `${entry.patchFile} 第 ${lineNos} 行检出可疑声明行（如 "- id: ${suspects[0].id}"——id 含空白或非 ASCII，` +
          '形如 compat 壳把显示名压平进 id 位产生的坏行，宿主 YAML 解析会失败，参见 dsh-maoying#1）' +
          '——请删除坏行或从 .bak-1 备份恢复后重试',
      )
    }
    // 行对账（损坏块时 readHomePatchRows 自捕返空数组——损坏已单独报，这里
    // 只在块结构完好时做逐行对账，避免损坏块上报出误导性的「无声明行」）。
    if (!hasBegin || hasEnd) {
      let rows = []
      try {
        rows = readHomePatchRows(dshHome, { layer: entry.layer, profileName: entry.profileName ?? 'web' })
      } catch {
        rows = []
      }
      if (rows.length === 0) {
        add('ok', '声明行托管块', hasBegin ? `${layerName}托管块存在但无声明行` : `${entry.layer === 'home' ? '' : `${entry.patchFile} `}无托管块（目录轨宿主无需声明行）`)
      } else {
        const orphans = rows.filter((row) => row.presetId && !existsSync(path.join(dshHome, '.agent-presets', row.presetId)))
        if (track === 'directory') {
          add('warn', '声明行托管块', `${layerName}检出 ${rows.length} 条声明行，但宿主是目录轨（≤ 0.1.6）——残留声明行会让 profile 启动失败，重启 DSH 触发自愈撤下`)
        } else if (orphans.length > 0) {
          add('warn', '声明行托管块', `${layerName}孤儿声明行（指向已删目录）：${orphans.map((o) => o.rowId).join('、')}——重启 DSH 自愈会撤下，或重新应用一次同步`)
        } else {
          add('ok', '声明行托管块', `${layerName}${rows.length} 条声明行均指向存在的预设目录`)
        }
      }
    }
  }
  if (blockLayerSeen !== null && blockLayerSeen !== layerTarget.layer) {
    add(
      'warn',
      'patch 层漂移',
      `声明行托管块在 ${blockLayerSeen} 层，当前判定目标层是 ${layerTarget.layer}（${layerTarget.patchPath}）` +
        '——下次自愈 / 保存会写目标层并撤下这层的遗留块（compat 壳迁移行为，参见 dsh-maoying#1）',
    )
  }

  // ── 4. 孤儿工作区预设目录（.agent-presets/orchestrator-*）─────────────────
  if (!configUsable && existsSync(configFile)) {
    add('skip', '工作区预设目录', '配置文件无法解析，无法对账（先修配置）')
  } else {
    const { dirs, orphans } = workspacePresetOrphans(dshHome, config)
    if (dirs.length === 0) {
      add('ok', '工作区预设目录', '无 orchestrator-<slug> 目录（未配置过工作区）')
    } else if (!configUsable) {
      add('warn', '工作区预设目录', `无配置文件可对账，以下目录全部视为孤儿：${dirs.join('、')}——重新应用可恢复，不用可手动删除`)
    } else if (orphans.length === 0) {
      add('ok', '工作区预设目录', `${dirs.length} 个工作区预设目录均在配置名册内`)
    } else {
      add('warn', '工作区预设目录', `孤儿目录（配置 workspaces 已无对应条目）：${orphans.join('、')}——下次「保存并应用」会自动回收，不用可手动删除`)
    }
    // 形态漂移（基础预设标记对账覆盖不到的暗角）：工作区产物的角色行形态与宿主
    // 所需不符时，挂该预设的新建会话会被宿主拒绝（0.2.1 守卫拒内联 persona /
    // toolFilter；反方向降级同理）。启动自愈会自动换代，这里只报事实。宿主版本
    // 探测不到不猜（与第 5 节 worker/角色行口径一致）。
    if (hostTriple !== null && configUsable && dirs.length > 0) {
      const wantedRoles = presetRolesFlavorOf(hostTriple, hostPrerelease)
      const stale = []
      for (const id of dirs) {
        if (orphans.includes(id)) continue
        try {
          const flavor = detectAgentRolesFlavor(readFileSync(path.join(dshHome, '.agent-presets', id, 'agent.cordis.yml'), 'utf8'))
          if (flavor !== null && flavor !== wantedRoles) stale.push(id)
        } catch { /* 产物读不到：缺失/损坏归孤儿与漂移检查之外的异常，不在此判 */ }
      }
      if (stale.length > 0) {
        add(
          'warn',
          '工作区预设目录',
          `角色行形态与宿主所需 ${wantedRoles} 不符：${stale.join('、')}` +
            (wantedRoles === 'agent-preset'
              ? '（DSH 0.2.1+ 拒绝内联 persona/toolFilter，挂这些预设的新建会话会报错）'
              : '') +
            '——重启 DSH 触发自愈自动换代，或对各工作区重新「保存并应用」',
        )
      }
    }
  }

  // ── 5. 版本标记对账（.generator-version：版本 + 轨道 + worker/角色形态）──────
  const presetDir = path.join(dshHome, '.agent-presets', 'orchestrator')
  if (!existsSync(presetDir)) {
    add('skip', '版本标记', '基础预设未安装（无 orchestrator 目录）：首装自动化或「保存并应用」会生成')
  } else {
    let marker = null
    try {
      marker = parseGeneratorMarker(readFileSync(path.join(presetDir, '.generator-version'), 'utf8'))
    } catch {
      marker = null
    }
    if (marker === null) {
      add('warn', '版本标记', '.generator-version 缺失或不可解析——下次 DSH 启动自愈会补一次生成（无伤大雅，多跑一遍而已）')
    } else {
      const parts = []
      if (version !== null && marker.version !== version) {
        parts.push(`标记版本 ${marker.version} ≠ 当前生成器 v${version}（下次启动自动按新版重生成）`)
      }
      if (marker.track !== null && track !== null && marker.track !== track) {
        parts.push(`标记轨道 ${TRACK_LABELS[marker.track] ?? marker.track} 与当前 ${trackLabel(track)} 不符（下次启动自动迁移）`)
      }
      // worker / 角色行形态只与探测得到的宿主版本比（探测不到不猜，保守不报）。
      if (marker.worker !== null && hostTriple !== null) {
        const workerNow = isPtcWorkerHost(hostTriple) ? 'ptc' : 'worker-thread'
        if (marker.worker !== workerNow) {
          parts.push(`标记 worker 形态 ${marker.worker} 与宿主所需 ${workerNow} 不符（下次启动整盘重生成）`)
        }
      }
      if (marker.roles !== null && hostTriple !== null) {
        const rolesNow = presetRolesFlavorOf(hostTriple, hostPrerelease)
        if (marker.roles !== rolesNow) {
          parts.push(
            rolesNow === 'agent-preset'
              ? `标记角色行形态 ${marker.roles} 与宿主所需 agent-preset 不符（DSH 0.2.1+ 拒绝内联 persona/toolFilter，下次启动整盘重生成）`
              : `标记角色行形态 ${marker.roles} 与宿主所需 inline 不符（下次启动整盘重生成）`,
          )
        }
      }
      if (parts.length === 0) {
        add('ok', '版本标记', `标记 ${marker.version}（${marker.track ?? '轨道未知'}）与当前生成器一致`)
      } else {
        add('warn', '版本标记', parts.join('；'))
      }
    }
  }

  // ── 6. 预设与配置漂移（复用 healthCheck 的 preset_drift，同一把尺子）────────
  if (state === null) {
    add('skip', '预设漂移', `检测管线不可用（${stateError ?? 'state 缺失'}），跳过该项`)
  } else {
    try {
      const assignments = autoAssignments({
        existing: state.existing,
        suggested: state.suggested,
        staticBase: state.staticBase,
      })
      const { items: healthItems } = healthCheck({ state, assignments })
      let sawDrift = false
      for (const h of healthItems) {
        if (h.code === 'preset_drift') {
          sawDrift = true
          add('warn', '预设漂移', h.message)
        } else if (h.level === 'error') {
          add('error', '配置体检', h.message)
        }
      }
      if (!sawDrift && !healthItems.some((h) => h.level === 'error')) {
        add('ok', '预设漂移', '已安装预设与当前配置的再生成结果一致')
      }
    } catch (err) {
      add('skip', '预设漂移', `体检执行失败，已跳过：${err?.message ?? err}`)
    }
  }

  return { items, hasErrors: items.some((i) => i.status === 'error') }
}
