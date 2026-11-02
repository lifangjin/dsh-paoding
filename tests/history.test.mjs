import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  HISTORY_KEEP,
  assertRevisionFresh,
  configHistoryEntryPath,
  currentConfigRevision,
  listConfigHistory,
  migrateLegacyBackups,
  snapshotConfig,
} from '../tools/lib/history.mjs'

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-hist-'))

test('版本链：编号递增、meta 完整、清单新→旧、currentConfigRevision 派生', () => {
  const dir = tmp()
  const config = path.join(dir, 'dsh-paoding.config.yml')
  assert.equal(currentConfigRevision(config), 0, '无历史 = 0')
  // 配置文件不存在（首次保存语义）：快照 no-op
  assert.equal(snapshotConfig(config, 'panel-apply'), null)
  assert.ok(!existsSync(`${config}.history`))

  writeFileSync(config, 'A\n', 'utf8')
  const s1 = snapshotConfig(config, 'panel-apply', 'first')
  assert.equal(s1.revision, 1)
  writeFileSync(config, 'B\n', 'utf8')
  const s2 = snapshotConfig(config, 'panel-import')
  assert.equal(s2.revision, 2, '编号严格递增')
  assert.equal(currentConfigRevision(config), 2)
  assert.equal(readFileSync(configHistoryEntryPath(config, 1), 'utf8'), 'A\n', 'v1 = 快照时刻的当前内容')
  assert.equal(readFileSync(configHistoryEntryPath(config, 2), 'utf8'), 'B\n')

  const list = listConfigHistory(config)
  assert.deepEqual(list.map((e) => e.revision), [2, 1], '新→旧')
  assert.equal(list[0].origin, 'panel-import')
  assert.equal(list[1].origin, 'panel-apply')
  assert.equal(list[1].note, 'first')
  assert.ok(typeof list[0].at === 'string' && list[0].at.endsWith('Z'))
  assert.ok(Number.isInteger(list[0].size))
  assert.equal(configHistoryEntryPath(config, 99), null, '不存在编号 → null')
})

test('旧 .bak 迁移：bak-3/2/1（旧→新）→ v1/v2/v3，幂等且不动旧文件', () => {
  const dir = tmp()
  const config = path.join(dir, 'dsh-paoding.config.yml')
  writeFileSync(config, 'cur\n', 'utf8')
  writeFileSync(`${config}.bak-3`, 'old\n', 'utf8')
  writeFileSync(`${config}.bak-1`, 'new\n', 'utf8') // 只造 1、3 两层
  assert.deepEqual(migrateLegacyBackups(config), { migrated: 2 })
  assert.equal(readFileSync(configHistoryEntryPath(config, 1), 'utf8'), 'old\n', 'bak-3（最旧）→ v1')
  assert.equal(readFileSync(configHistoryEntryPath(config, 2), 'utf8'), 'new\n', 'bak-1（最新）→ 顺延 v2')
  assert.equal(currentConfigRevision(config), 2)
  assert.equal(listConfigHistory(config)[0].origin, 'legacy-backup')
  assert.equal(existsSync(`${config}.bak-1`), true, '旧文件保留不动')
  assert.deepEqual(migrateLegacyBackups(config), { migrated: 0 }, '幂等：再迁零份')

  // snapshotConfig 首次调用顺带迁移：链非空后迁移跳过，编号顺延
  const s = snapshotConfig(config, 'panel-apply')
  assert.equal(s.revision, 3)
  assert.equal(readFileSync(configHistoryEntryPath(config, 3), 'utf8'), 'cur\n')
})

test('CAS：baseRevision 与磁盘不一致 → 409 config_stale（附 currentRevision）；缺省不比较', () => {
  const dir = tmp()
  const config = path.join(dir, 'dsh-paoding.config.yml')
  writeFileSync(config, 'A\n', 'utf8')
  snapshotConfig(config, 'panel-apply')
  // 缺省 / null：老客户端零行为变化
  assert.doesNotThrow(() => assertRevisionFresh(config, undefined))
  assert.doesNotThrow(() => assertRevisionFresh(config, null))
  assert.doesNotThrow(() => assertRevisionFresh(config, 1), '一致 → 放行')
  // 非法值：按过期处理（统一 409 config_stale + hint，不另造错误分支）
  for (const bad of ['1', -1, 1.5]) {
    assert.throws(
      () => assertRevisionFresh(config, bad),
      (err) => err.statusCode === 409 && err.code === 'config_stale' && err.data.hint !== undefined,
      `${bad} 应拒绝`,
    )
  }
  // 过期：409 + code + currentRevision（响应体纯增量字段，外层 catch 透传）
  writeFileSync(config, 'B\n', 'utf8')
  snapshotConfig(config, 'panel-apply')
  assert.throws(
    () => assertRevisionFresh(config, 1),
    (err) => err.statusCode === 409 && err.code === 'config_stale' && err.data.currentRevision === 2,
    '不一致 → 409 config_stale + currentRevision',
  )
})

test('保留策略：超 HISTORY_KEEP 淘汰最旧（yml+meta 成对删），链长恒 ≤ 上限', () => {
  const dir = tmp()
  const config = path.join(dir, 'dsh-paoding.config.yml')
  for (let i = 0; i < HISTORY_KEEP + 3; i++) {
    writeFileSync(config, `v${i}\n`, 'utf8')
    snapshotConfig(config, 'panel-apply')
  }
  const list = listConfigHistory(config)
  assert.equal(list.length, HISTORY_KEEP, `链长恒 ≤ ${HISTORY_KEEP}`)
  assert.equal(list[list.length - 1].revision, 4, '最旧被淘汰，链首 = 第 4 份（前 3 份已出链）')
  const files = readdirSync(`${config}.history`)
  assert.equal(files.filter((f) => f.endsWith('.yml')).length, HISTORY_KEEP)
  assert.equal(files.filter((f) => f.endsWith('.json')).length, HISTORY_KEEP, 'meta 与 yml 成对')
})

test('坏 meta 降级：origin=unknown 而非让清单 5xx', () => {
  const dir = tmp()
  const config = path.join(dir, 'dsh-paoding.config.yml')
  writeFileSync(config, 'A\n', 'utf8')
  snapshotConfig(config, 'panel-apply')
  writeFileSync(path.join(`${config}.history`, 'v000001.json'), '{broken', 'utf8')
  const list = listConfigHistory(config)
  assert.equal(list[0].origin, 'unknown')
  assert.equal(list[0].at, null)
})

test('编号回滚（restoreConfigSnapshot revision 形态）：先快照当前再整文件回写', async () => {
  const dir = tmp()
  const config = path.join(dir, 'dsh-paoding.config.yml')
  process.env.DSH_PAODING_CONFIG = config
  process.env.DSH_HOME = dir
  const savedPaodingCwd = process.env.DSH_PAODING_CWD
  process.env.DSH_PAODING_CWD = dir
  try {
    writeFileSync(config, 'profile: web\nmain_agent_display_name: A\n', 'utf8')
    snapshotConfig(config, 'panel-apply')
    writeFileSync(config, 'profile: web\nmain_agent_display_name: B\n', 'utf8')
    snapshotConfig(config, 'panel-apply')
    const { restoreConfigSnapshot } = await import('../plugins/paoding-config-ui/api-core.mjs')
    const r = await restoreConfigSnapshot({ revision: 1, baseRevision: 2 })
    assert.equal(r.ok, true)
    assert.equal(r.restored, 'v1')
    assert.equal(r.revision, 3, '回滚本身快照进链（origin=restore）')
    assert.match(readFileSync(config, 'utf8'), /display_name: A/, '配置回到 v1 内容')
    assert.equal(listConfigHistory(config)[0].origin, 'restore')
    assert.match(readFileSync(configHistoryEntryPath(config, 3), 'utf8'), /display_name: B/, '回滚前当前（B）已进链')
    // CAS 过期：拿旧 revision 比对 → 409
    await assert.rejects(
      () => restoreConfigSnapshot({ revision: 1, baseRevision: 2 }),
      (err) => err.statusCode === 409 && err.code === 'config_stale' && err.data.currentRevision === 3,
    )
    // 不存在的编号 → 404
    await assert.rejects(() => restoreConfigSnapshot({ revision: 99 }), (err) => err.statusCode === 404)
  } finally {
    if (savedPaodingCwd === undefined) delete process.env.DSH_PAODING_CWD
    else process.env.DSH_PAODING_CWD = savedPaodingCwd
    delete process.env.DSH_PAODING_CONFIG
    delete process.env.DSH_HOME
  }
})
