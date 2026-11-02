/**
 * 配置版本链（借自 dsh-superagent 的「写前编号快照 + revision CAS」）：
 * 面板 / API / CLI 每一次写配置前，先把当前配置按递增编号快照进
 * `<configFile>.history/`——
 *
 *   v000012.yml      快照内容（字节级拷贝，回滚即整文件回写）
 *   v000012.json     元数据 { revision, origin, at, size, note }（人可读）
 *
 * 与旧版 3 槽轮换备份（<config>.bak-1/2/3）的关系：并行共存、单向迁移——
 * 目录首次启用时把现存的 .bak-3/2/1（旧→新）导入为 v1/v2/v3（origin 标
 * legacy-backup），旧文件保留不动（回滚与旧面板仍可读）；此后面板写盘只走
 * 版本链，不再轮换 .bak。保留策略 HISTORY_KEEP 份，超限删最旧（yml+meta
 * 成对删）。
 *
 * revision 语义：目录内最大编号即「当前 revision」（derive，无指针文件——
 * 自愈，不存在失步面）；无历史 = 0。GET state 附带它，写路由带 baseRevision
 * 做乐观并发（CAS）：不一致 → 409 config_stale（见 errors.mjs），提示「配置
 * 已被其他入口修改，请重载」。baseRevision 缺省（老客户端 / curl）不比较，
 * 完全向后兼容。
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { userError } from './errors.mjs'

export const HISTORY_KEEP = 30

/** 版本链目录（与配置文件同目录）。 */
export function historyDirFor(configFile) {
  return `${configFile}.history`
}

function revisionFiles(configFile, revision) {
  const dir = historyDirFor(configFile)
  return {
    yml: path.join(dir, `v${String(revision).padStart(6, '0')}.yml`),
    meta: path.join(dir, `v${String(revision).padStart(6, '0')}.json`),
  }
}

/** 目录内全部快照编号（升序；目录缺失 / 不可读 → 空数组，绝不让读路径 5xx）。 */
function listRevisions(configFile) {
  const dir = historyDirFor(configFile)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .map((name) => /^v(\d{6})\.yml$/.exec(name))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b)
  } catch {
    return []
  }
}

/**
 * 当前配置 revision（= 目录最大编号；无历史 0）。直接读磁盘不做任何缓存——
 * CAS 比对必须反映写盘瞬间的真实状态。异常（目录不可读）按 0 处理：宁可放行
 * 一次写（丢一次并发拦截）也不挡写路径。
 */
export function currentConfigRevision(configFile) {
  const revs = listRevisions(configFile)
  return revs.length > 0 ? revs[revs.length - 1] : 0
}

/** 旧 .bak-N 的绝对路径（N ∈ 1..3；bak-1 最新）。 */
export function legacyBackupPath(configFile, n) {
  return `${configFile}.bak-${n}`
}

/**
 * 一次性迁移：历史目录为空且配置文件旁存在旧 .bak 时，按 旧→新 导入为
 * v1..v3（bak-3→v1、bak-2→v2、bak-1→v3；缺失的层跳过、编号顺延）。旧文件
 * 保留。目录非空（已启用）直接返回，幂等。
 */
export function migrateLegacyBackups(configFile) {
  if (listRevisions(configFile).length > 0) return { migrated: 0 }
  if (!existsSync(String(configFile)) && ![1, 2, 3].some((n) => existsSync(legacyBackupPath(configFile, n)))) {
    return { migrated: 0 }
  }
  const dir = historyDirFor(configFile)
  mkdirSync(dir, { recursive: true })
  let next = 1
  let migrated = 0
  for (const n of [3, 2, 1]) {
    const src = legacyBackupPath(configFile, n)
    if (!existsSync(src)) continue
    const { yml, meta } = revisionFiles(configFile, next)
    copyFileSync(src, yml)
    const st = statSync(yml)
    writeFileSync(
      meta,
      `${JSON.stringify({ revision: next, origin: 'legacy-backup', at: new Date(st.mtimeMs).toISOString(), size: st.size }, null, 2)}\n`,
    )
    next += 1
    migrated += 1
  }
  return { migrated }
}

/**
 * 写前快照（所有配置写盘路径的统一入口）：当前配置存在 → 拷贝为 v<max+1>、
 * 写 meta、按 HISTORY_KEEP 淘汰；不存在（首次保存，没有「之前」可言）→ 返回
 * null 不写任何文件。首次调用顺带做旧 .bak 迁移。origin 记写入口（面板
 * apply / import / 工作区 / 回滚 / 首装自愈 / CLI），note 一句话说明。
 * 返回 { revision }（本次快照编号）。
 */
export function snapshotConfig(configFile, origin, note = null) {
  if (!existsSync(String(configFile))) return null
  migrateLegacyBackups(configFile)
  const revs = listRevisions(configFile)
  const revision = (revs.length > 0 ? revs[revs.length - 1] : 0) + 1
  const dir = historyDirFor(configFile)
  mkdirSync(dir, { recursive: true })
  const { yml, meta } = revisionFiles(configFile, revision)
  copyFileSync(String(configFile), yml)
  const st = statSync(yml)
  writeFileSync(
    meta,
    `${JSON.stringify({ revision, origin, at: new Date().toISOString(), size: st.size, ...(note !== null ? { note } : {}) }, null, 2)}\n`,
  )
  // 淘汰超限旧快照（yml+meta 成对；rmSync force：不存在也无妨）
  const overflow = revs.length + 1 - HISTORY_KEEP
  for (let i = 0; i < overflow; i++) {
    const victim = revisionFiles(configFile, revs[i])
    rmSync(victim.yml, { force: true })
    rmSync(victim.meta, { force: true })
  }
  return { revision }
}

/**
 * 快照清单（新→旧）：{ revision, file, origin, at, size }[]；meta 缺失 / 坏
 * JSON 的条目降级（origin: 'unknown'）而不是让整页 5xx。limit 截断（面板只带
 * 近期若干条）。
 */
export function listConfigHistory(configFile, { limit = null } = {}) {
  const dir = historyDirFor(configFile)
  const out = []
  for (const revision of listRevisions(configFile).reverse()) {
    const { yml, meta } = revisionFiles(configFile, revision)
    let m = null
    try {
      m = JSON.parse(readFileSync(meta, 'utf8'))
    } catch {
      m = null
    }
    let size = null
    try {
      size = statSync(yml).size
    } catch {
      size = null
    }
    out.push({
      revision,
      file: path.basename(yml),
      origin: typeof m?.origin === 'string' ? m.origin : 'unknown',
      at: typeof m?.at === 'string' ? m.at : null,
      size,
      ...(typeof m?.note === 'string' && m.note !== '' ? { note: m.note } : {}),
    })
    if (limit !== null && out.length >= limit) break
  }
  return out
}

/** 取某编号快照的绝对路径（不存在 → null）。 */
export function configHistoryEntryPath(configFile, revision) {
  if (!Number.isInteger(revision) || revision < 1) return null
  const { yml } = revisionFiles(configFile, revision)
  return existsSync(yml) ? yml : null
}

/**
 * 乐观并发护栏（CAS）：调用方带 baseRevision（GET state 时的 revision）时，
 * 与磁盘当前值不一致 → 409 config_stale（响应附 currentRevision，客户端提示
 * 重载）；缺省 / 非数字 → 不比较（老客户端兼容，零行为变化）。
 */
export function assertRevisionFresh(configFile, baseRevision) {
  if (baseRevision === undefined || baseRevision === null) return
  if (!Number.isInteger(baseRevision) || baseRevision < 0) {
    throw userError('config_stale', {}, { hint: 'baseRevision 非法（须为非负整数）' })
  }
  const current = currentConfigRevision(configFile)
  if (baseRevision !== current) {
    throw userError('config_stale', {}, { currentRevision: current })
  }
}
