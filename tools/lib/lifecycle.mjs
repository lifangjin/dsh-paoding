/**
 * 生命周期清理共享层 —— `dsh-paoding uninstall` 与 `doctor --fix` 共用的落盘
 * 清理原语。两者清理的东西同源（cordis.patch.yml 托管块、.agent-presets 下的
 * orchestrator* 预设目录、.generator-version 标记），判别口径也与 doctor 只读
 * 体检同源（孤儿目录 = workspacePresetOrphans，孤儿声明行 = presetId 指向的
 * 目录已不存在），本模块把「怎么删」收敛在一处，两个命令只决定「删哪些」。
 *
 * 备份纪律：一次清理调用对 cordis.patch.yml 至多备份一份 .bak-1（首次写盘前
 * 拷贝，已有同名备份覆盖——只保「本次改动前」的原貌），同一次调用里的后续写
 * 不再覆盖这份首备。配置文件 dsh-paoding.config.yml 是用户数据，只有 uninstall
 * --purge 才动，删除前列在计划里。
 *
 * 依赖 preset-system（托管块手术与轨道原语）/ workspaces（slug 名册）/
 * config（loadConfig）；被 doctor / cli 引用。绝不触碰插件包自身目录——包
 * 本体的卸载通道只有 dsh plugin remove（bin 入口注释同款口径）。
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { loadConfig } from './config.mjs'
import { assignSlugs, presetIdOf } from './workspaces.mjs'
import {
  MANAGED_BEGIN,
  MANAGED_END,
  listOrchestratorPresetIds,
  presetRowId,
  readHomePatchRows,
  stripHomePatchRows,
} from './preset-system.mjs'

/** cordis.patch.yml 写前备份的后缀（只保一份，重复清理覆盖上一份）。 */
export const PATCH_BACKUP_SUFFIX = '.bak-1'

/** 生成器标记文件名：位置固定在 .agent-presets/orchestrator/ 里（api-core
 * ensurePresetInstalled 与 doctor 版本标记项同址），随基础预设目录同生同灭。 */
export const GENERATOR_MARKER_NAME = '.generator-version'

/** 生成器标记文件的完整路径（位置以 preset-system / api-core 的代码为准）。 */
export function generatorMarkerPath(dshHome) {
  return path.join(dshHome, '.agent-presets', 'orchestrator', GENERATOR_MARKER_NAME)
}

/**
 * 写前备份：把 file 原样拷成 `${file}${PATCH_BACKUP_SUFFIX}`（已存在则覆盖，
 * 只保最近一份）。file 不存在返回 null（没得备份，也不造空备份）；拷贝失败
 * 上抛——备份失败宁可中止清理，不做无备份的破坏性写。
 */
export function backupBeforeWrite(file) {
  if (!existsSync(file)) return null
  const backupPath = `${file}${PATCH_BACKUP_SUFFIX}`
  copyFileSync(file, backupPath)
  return backupPath
}

/**
 * cordis.patch.yml 里庖丁托管块的在场状态：{ present, corrupt }。present 按
 * 起始标记行判断（与 doctor 声明行托管块项同一读法）；有起始没结束 = 损坏，
 * 此时任何托管写盘都会被 preset-system 拒绝，清理方只能降级成「需手工」。
 * 文件缺失 / 读不了 → 全 false（无可清理）。
 */
export function managedBlockState(dshHome) {
  let text = null
  try {
    text = readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8')
  } catch {
    return { present: false, corrupt: false }
  }
  const marks = new Set(String(text).split(/\r?\n/).map((l) => l.trim()))
  const present = marks.has(MANAGED_BEGIN)
  return { present, corrupt: present && !marks.has(MANAGED_END) }
}

/**
 * 配置文件对账读法（doctor 配置文件项同一判据）：缺失返回 { config: null,
 * exists: false, usable: false }；存在但解析失败 → { exists: true, usable:
 * false }（此时宁可当孤儿全量处理也不敢对账的目录一律不动，见
 * workspacePresetOrphans 的调用方约束）；存在且可解析 → config 原样。
 */
export function loadConfigForReconcile(configFile, yamlMod) {
  if (!existsSync(configFile)) return { config: null, exists: false, usable: false }
  try {
    return { config: loadConfig(configFile, yamlMod), exists: true, usable: true }
  } catch {
    return { config: null, exists: true, usable: false }
  }
}

/**
 * 孤儿工作区预设目录对账（doctor「工作区预设目录」项同源判据，从 doctor 移植
 * 到这里供清理侧复用）：配置 workspaces 键组统一过 assignSlugs（与生成层同源，
 * slug 稳定）得到「配置在册」的 presetId 集合；目录有、名册无 → 孤儿。基础
 * orchestrator 永不算孤儿（启动自愈会重装它）。注意调用方约束：configFile
 * 存在但不可解析时不要调用（doctor 该项直接降级 skip，清理侧同样必须跳过，
 * 详见 loadConfigForReconcile）。
 */
export function workspacePresetOrphans(dshHome, config) {
  const dirs = listOrchestratorPresetIds(dshHome).filter((id) => id !== 'orchestrator')
  if (dirs.length === 0) return { dirs, orphans: [] }
  const wsPaths = Object.keys(config?.workspaces ?? {})
  const inRegister = new Set([...assignSlugs(wsPaths).values()].map(presetIdOf))
  return { dirs, orphans: dirs.filter((id) => !inRegister.has(id)) }
}

/**
 * 孤儿声明行（doctor「声明行托管块」项同一判据）：托管块里 presetId 指向的
 * .agent-presets 目录已不存在的行。含本机历史遗留的旧 insert（如指向早已
 * 不存在的 paoding-config-ui 的声明行）——判据只认「目录没了」，不认行名。
 * presetId 解析不出的行不在此列（doctor 不点名它，清理侧也不动它，交给用户）。
 * 托管块损坏时返回空数组（损坏块只能整块手工处理，行级手术做不了）。
 */
export function orphanManagedRows(dshHome) {
  const rows = readHomePatchRows(dshHome)
  return rows.filter((row) => row.presetId && !existsSync(path.join(dshHome, '.agent-presets', row.presetId)))
}

/**
 * 清理执行器（uninstall 与 doctor --fix 共用，别在外面另拼删盘逻辑）：
 *   - stripBlock: true → 整块摘除托管块（uninstall；含起止标记与块前空行分隔）
 *   - pruneRowIds: 撤指定 rowId 的声明行段（doctor --fix 的孤儿行清理）
 *   - removeDirIds: 删指定 orchestrator* 预设目录（rmSync 逐个，单目录失败不
 *     拖垮其余）；声明行轨上被删目录的声明行同步撤下（目录与行同生同灭，与
 *     generateAndInstall 的孤儿回收口径一致）
 *   - 删完目录后 .generator-version 若仍在（理论上随基础目录已走，防御性兜底）
 *     一并删除并在结果里注明
 * 备份纪律见模块头：对 cordis.patch.yml 的首次写前备份 .bak-1，之后不再覆盖。
 * 返回结构化结果（字段见实现），全程不 throw——单步失败折进对应字段，由调用
 * 方决定退出码与文案。
 */
export function cleanupPaodingArtifacts(dshHome, { stripBlock = false, pruneRowIds = [], removeDirIds = [] } = {}) {
  const result = {
    backupPath: null,
    blockPresent: false,
    blockCorrupt: false,
    blockRemoved: false,
    prunedRowIds: [],
    markerRemoved: false,
    removedDirs: [],
    dirFailures: [],
  }

  const block = managedBlockState(dshHome)
  result.blockPresent = block.present
  result.blockCorrupt = block.corrupt

  let backupDone = false
  const backupOnce = () => {
    if (backupDone) return
    backupDone = true
    result.backupPath = backupBeforeWrite(path.join(dshHome, 'cordis.patch.yml'))
  }

  // 1) 托管块手术（损坏块不碰：preset-system 会拒绝写盘，降级给调用方报需手工）
  if (block.present && !block.corrupt) {
    const rowsOnDisk = readHomePatchRows(dshHome).map((r) => r.rowId)
    if (stripBlock) {
      backupOnce()
      result.blockRemoved = stripHomePatchRows(dshHome, null)
    } else if (pruneRowIds.length > 0) {
      const present = pruneRowIds.filter((id) => rowsOnDisk.includes(id))
      if (present.length > 0) {
        backupOnce()
        // stripHomePatchRows 返回 true = 指定段确已撤下；块里本来就没有的 id
        // 不算撤（present 已过滤），不虚报。
        if (stripHomePatchRows(dshHome, present)) result.prunedRowIds = present
      }
    }
  }

  // 2) 预设目录删除 + 声明行同步（目录先删，行后撤——与孤儿回收同序）
  if (removeDirIds.length > 0) {
    for (const id of removeDirIds) {
      const dir = path.join(dshHome, '.agent-presets', id)
      try {
        rmSync(dir, { recursive: true, force: true })
        result.removedDirs.push(id)
      } catch (err) {
        result.dirFailures.push({ id, error: err?.message ?? String(err) })
      }
    }
    const removedIds = new Set(result.removedDirs)
    const danglingRowIds = readHomePatchRows(dshHome)
      .filter((r) => r.presetId && removedIds.has(r.presetId))
      .map((r) => r.rowId)
    if (danglingRowIds.length > 0 && !result.blockCorrupt) {
      backupOnce()
      stripHomePatchRows(dshHome, danglingRowIds)
    }
  }

  // 3) 版本标记兜底：正常随基础 orchestrator 目录一起删；防御目录删除整体失败
  //（dirFailures）或外部摆了非常规布局时补一手，保证「卸载后无标记残留」。
  const markerPath = generatorMarkerPath(dshHome)
  if (existsSync(markerPath)) {
    try {
      rmSync(markerPath, { force: true })
      result.markerRemoved = true
    } catch { /* 删不掉就留着：dirFailures / 保留提示里已能解释现场 */ }
  }

  return result
}

/**
 * 卸载计划（只读侦察，不落盘）：给确认提示、非 TTY 防呆打印与「无事可做」
 * 判定共用。不加载配置文件内容（卸载不依赖配置语义），只看存在性。
 */
export function planUninstall({ dshHome, configFile } = {}) {
  const block = managedBlockState(dshHome)
  const markerPath = generatorMarkerPath(dshHome)
  return {
    dshHome,
    configFile,
    patchFile: path.join(dshHome, 'cordis.patch.yml'),
    blockPresent: block.present,
    blockCorrupt: block.corrupt,
    blockRowCount: readHomePatchRows(dshHome).length,
    presetDirs: listOrchestratorPresetIds(dshHome),
    markerPath,
    markerExists: existsSync(markerPath),
    configExists: existsSync(configFile),
    configBackups: listConfigBackupFiles(configFile),
  }
}

/**
 * 配置文件的备份兄弟文件（`dsh-paoding.config.yml.bak*`，用户或历史工具手工
 * 留的）：--purge 时连这些一起删；默认保留时提示里点名数量。
 */
export function listConfigBackupFiles(configFile) {
  const dir = path.dirname(configFile)
  const base = path.basename(configFile)
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((name) => name.startsWith(`${base}.bak`))
    .sort()
    .map((name) => path.join(dir, name))
}

/** --purge 的配置删除：配置文件 + 全部 .bak* 备份逐个删，返回实际删掉的路径。 */
export function removeConfigAndBackups(configFile) {
  const removed = []
  for (const file of [configFile, ...listConfigBackupFiles(configFile)]) {
    try {
      rmSync(file, { force: true })
      removed.push(file)
    } catch { /* 删不掉就留着，由调用方在收尾提示里交代 */ }
  }
  return removed
}

/** .agent-presets 下与庖丁无关的残留目录名（如用户自制 preset），卸载后提示「未动」。 */
export function foreignPresetDirsRemaining(dshHome) {
  let names = []
  try {
    names = readdirSync(path.join(dshHome, '.agent-presets'))
  } catch {
    return []
  }
  return names.filter((name) => !/^orchestrator(-[a-z0-9-]+)?$/.test(name)).sort()
}
