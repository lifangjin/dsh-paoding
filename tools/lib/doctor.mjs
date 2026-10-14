/**
 * `dsh-paoding doctor` 的检查本体：只读体检，不动任何盘。与 health.mjs 的分工
 * ——healthCheck 管「这次保存/应用会怎样」（面向 preview / apply 响应与
 * --dry-run 报告的单次配置体检）；本模块管「这台机器装得正不正」（配置文件、
 * 预设安装轨道、托管声明行、孤儿工作区预设目录、版本标记、预设漂移六项环境
 * 对账），结果形状是人读导向的 { items: [{ status, label, detail }] }：
 *   status: 'ok' | 'warn' | 'error' | 'skip'（skip = 前置事实缺失，降级不炸——
 *   无 DSH_HOME / 无配置的干净机器上各项依此跳过）。
 *
 * 有意与 healthCheck 解耦、不复用其返回形状： doctor 的每项都有自己的前置探测
 * 与降级语义，硬塞进 level/code 模型只会两头别扭；仅「预设漂移」一项复用
 * healthCheck 的 preset_drift 判定（同一份 dry-run 对比，不另立标准）。
 *
 * 依赖 config（loadConfig）/ yaml（loadYaml）/ alloc（autoAssignments）/
 * state（collectState）/ workspaces（assignSlugs / presetIdOf）/
 * preset-system（轨道、托管块、标记）与 health（healthCheck）；被 cli 引用。
 * 零运行时依赖（node:fs / node:path / node:url）。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { loadConfig } from './config.mjs'
import { loadYaml } from './yaml.mjs'
import { autoAssignments } from './alloc.mjs'
import { collectState } from './state.mjs'
import { assignSlugs, presetIdOf } from './workspaces.mjs'
import {
  MANAGED_BEGIN,
  MANAGED_END,
  detectHostVersionTriple,
  detectPresetSystem,
  isDeclarativeTriple,
  isPtcWorkerHost,
  listOrchestratorPresetIds,
  parseGeneratorMarker,
  readHomePatchRows,
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

/** 孤儿工作区预设目录对账：配置 workspaces 键组统一过 assignSlugs（与生成层
 * 同源，slug 稳定），得到「配置在册」的 presetId 集合；目录有、名册无 → 孤儿。 */
function workspacePresetOrphans(dshHome, config) {
  const dirs = listOrchestratorPresetIds(dshHome).filter((id) => id !== 'orchestrator')
  if (dirs.length === 0) return { dirs, orphans: [] }
  const wsPaths = Object.keys(config?.workspaces ?? {})
  const inRegister = new Set([...assignSlugs(wsPaths).values()].map(presetIdOf))
  return { dirs, orphans: dirs.filter((id) => !inRegister.has(id)) }
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
  const hostTriple = detectHostVersionTriple()
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

  // ── 3. 声明行托管块（~/.dsh/cordis.patch.yml）────────────────────────────
  // readHomePatchRows 对损坏块自捕返 []，读不出「损坏」——这里直接扫标记行补一道：
  // 有 BEGIN 没 END = 托管块损坏，所有托管写盘都会被拒绝。
  let patchText = null
  try {
    patchText = readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') add('skip', '声明行托管块', 'cordis.patch.yml 不存在（尚无声明行；目录轨宿主也不需要）')
    else add('skip', '声明行托管块', `cordis.patch.yml 读取失败（${err?.message ?? err}），跳过该项`)
  }
  if (patchText !== null) {
    const markers = managedMarkerLines(patchText)
    const hasBegin = markers.has(MANAGED_BEGIN)
    const hasEnd = markers.has(MANAGED_END)
    if (hasBegin && !hasEnd) {
      add('error', '声明行托管块', '托管块损坏（只有起始标记没有结束标记）：补回结束标记或删除整块，否则面板保存 / 自愈都会拒绝写盘')
    } else {
      let rows = []
      try {
        rows = readHomePatchRows(dshHome)
      } catch {
        rows = []
      }
      if (rows.length === 0) {
        add('ok', '声明行托管块', hasBegin ? '托管块存在但无声明行' : 'cordis.patch.yml 无托管块（目录轨宿主无需声明行）')
      } else {
        const orphans = rows.filter((row) => row.presetId && !existsSync(path.join(dshHome, '.agent-presets', row.presetId)))
        if (track === 'directory') {
          add('warn', '声明行托管块', `检出 ${rows.length} 条声明行，但宿主是目录轨（≤ 0.1.6）——残留声明行会让 profile 启动失败，重启 DSH 触发自愈撤下`)
        } else if (orphans.length > 0) {
          add('warn', '声明行托管块', `孤儿声明行（指向已删目录）：${orphans.map((o) => o.rowId).join('、')}——重启 DSH 自愈会撤下，或重新应用一次同步`)
        } else {
          add('ok', '声明行托管块', `${rows.length} 条声明行均指向存在的预设目录`)
        }
      }
    }
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
  }

  // ── 5. 版本标记对账（.generator-version：版本 + 轨道 + worker 形态）────────
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
      // worker 形态只与探测得到的宿主版本比（探测不到不猜，保守不报）。
      if (marker.worker !== null && hostTriple !== null) {
        const workerNow = isPtcWorkerHost(hostTriple) ? 'ptc' : 'worker-thread'
        if (marker.worker !== workerNow) {
          parts.push(`标记 worker 形态 ${marker.worker} 与宿主所需 ${workerNow} 不符（下次启动整盘重生成）`)
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
