/**
 * 面板一键升级执行器 —— 按 profile 分流的原地换版本（Web 面板「升级」按钮
 * 专用；CLI 不走这里）。
 *
 * 唯一官方安装通道是 DSH 插件通道：包由 pnpm 装进 profile
 * （$DSH_HOME/profiles/<name>/node_modules/dsh-paoding）。升级子进程按
 * profile 分流：
 *   - 常规 profile：spawn `dsh plugin --profile <profile> update dsh-paoding`，
 *     让 dsh 的插件转发器对该包做 pnpm update + bundle reconcile；
 *   - desktop profile：dsh CLI 在启动器里硬拒 desktop profile（报
 *     `profile "desktop" is managed exclusively by the Electron application`，
 *     只有桌面 Electron App 内部 CLI 豁免），转发器这条路必炸——改为在
 *     profile 目录里直跑 `pnpm add dsh-paoding@<目标版本>`：本包已在 profile
 *     package.json 的 dsh.profile.bundles 清单里，无需 bundle reconcile；用
 *     精确版本而非 update，避开 pnpm 新鲜度防护 / 镜像 packument 滞后造成的
 *     静默空转。pnpm 本身按候选链解析（裸 pnpm → corepack pnpm → PNPM_HOME
 *     常见落位，仅 ENOENT 换下一路）——corepack 管的机器没跑过 corepack
 *     enable 时 PATH 里没有裸 pnpm，0.3.8~0.4.0 直 spawn 裸名即报
 *     `spawn pnpm ENOENT`（0.4.1 修）。
 *
 * 本模块只负责「拿目标版本 → 探测自身 profile → 跑子进程」这一段编排；
 * profile 名从本文件运行时真实路径反推（registry 安装形态必然位于
 * <...>/profiles/<name>/node_modules/ 之下），开发 link: 直连形态的真实路径
 * 在仓库里、匹配不到，如实报「无法就地升级」。
 *
 * 零依赖纯 Node（>=18）：目标版本复用 version.mjs 的 fetchLatestFromRegistry
 * / fetchLatestFromMirror（官方源失败再走 npmmirror 镜像——点「升级」的用户
 * 网络本来就在出状况，多一路快路能实打实救回一次升级），子进程、时钟全部
 * 可注入便于单测。升级后不做磁盘后验
 * ——本进程代码不随升级变化，无从对账；成功与否以升级子进程退出码为准，
 * 新版本在重启 DSH 后生效（preset 由新包的启动自愈钩子自动重生成）。
 *
 * 失败路径全部诚实暴露（不静默）：拿不到版本、开发形态、profile 未初始化、
 * 超时、退出码非 0，都原样带回 error + 子进程输出尾部，调用方（面板路由）
 * 转成 500 醒目展示——升级是用户主动点的高级操作，失败被吞掉比失败本身更糟。
 */
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { currentVersion, compareVersions, fetchLatestFromMirror, fetchLatestFromRegistry } from './version.mjs'

// 子进程输出上限：合并 stdout+stderr 后只保留最后 ~8KB（安装进度刷屏无排障
// 价值，报错结论都在尾部）；累积过程中超过 1MB 就先截一版，防止异常刷爆内存。
const OUTPUT_TAIL_BYTES = 8 * 1024
const OUTPUT_HARD_CAP_BYTES = 1024 * 1024

// 模块级互斥：同一进程同时只允许一个升级在跑（pnpm 双开操作同一 profile 必炸）。
// 进行中再调立即返回失败，不排队——升级是分钟级操作，排队只会让面板转圈更久。
let upgradeInFlight = false

function tailOutput(text) {
  const s = String(text ?? '')
  return s.length > OUTPUT_TAIL_BYTES ? s.slice(-OUTPUT_TAIL_BYTES) : s
}

/**
 * 缺省子进程执行器（可被 spawnImpl 注入替换，测试用）：spawn 任意命令，合并
 * 收集 stdout+stderr，timeoutMs 到点 kill 并按超时收敛。永不 reject，统一收敛
 * 为 { code, output, error? }（error 仅 spawn 本身失败（如 ENOENT）时存在）。
 * timeoutLabel 只用于超时文案标明哪条通道超时（dsh 转发器 / pnpm 直装），
 * 不参与子进程本身。
 */
function defaultSpawn(command, args, options, timeoutMs, timeoutLabel) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options)
    let output = ''
    const onChunk = (chunk) => {
      output += chunk.toString()
      if (output.length > OUTPUT_HARD_CAP_BYTES) output = output.slice(-OUTPUT_TAIL_BYTES)
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM') // close 事件仍会触发，收尾统一在 close 里判定
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: null, output: tailOutput(output), error: String(err?.message ?? err), errorCode: err?.code ?? null })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(timedOut
        ? { code, output: tailOutput(output), error: `${timeoutLabel} 升级超时（${Math.round(timeoutMs / 1000)}s）` }
        : { code, output: tailOutput(output) })
    })
  })
}

/**
 * 从本模块运行时真实路径反推所属 profile 名。registry / git 依赖等插件通道
 * 安装形态必然落在 <...>/profiles/<name>/node_modules/dsh-paoding/ 之下；开发
 * link: 直连时真实路径是仓库目录，匹配不到返回 null（调用方据此拒绝就地升级
 * 并指路手动命令）。realpath 必须走（macOS /tmp 等符号链接会遮住真实层级）；
 * 分隔符两种都收，兼容 win32 路径。
 * @returns {Promise<string|null>}
 */
export async function detectProfileName() {
  try {
    const real = await realpath(fileURLToPath(import.meta.url))
    const m = /[/\\]profiles[/\\]([^/\\]+)[/\\]node_modules[/\\]/.exec(String(real))
    return m ? m[1] : null
  } catch {
    return null
  }
}

/**
 * desktop profile 目录：$DSH_HOME（空串视为未设）否则 ~/.dsh，再拼
 * profiles/desktop，与 dsh 启动器的 profile 落位规则一致。desktop 分支的
 * pnpm 子进程以此为 cwd——pnpm 的操作对象就是这份 profile，脱离目录跑不
 * 到点子上。
 * @returns {string}
 */
function desktopProfileDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'profiles', 'desktop')
}

/**
 * 执行一键升级。
 * @param {{profile?: string, fetchImpl?: Function, spawnImpl?: Function,
 *           timeoutMs?: number, now?: Function|number}} opts
 *   - profile 可选：显式指定目标 profile（跳过路径反推，测试 / 手动强制用）；
 *     缺省经 detectProfileName() 从运行时真实路径反推。
 *   - fetchImpl / spawnImpl / now 可注入（单测用）；缺省用 globalThis.fetch、
 *     node:child_process 的 spawn、Date.now()。
 *   - timeoutMs：升级子进程超时（含 pnpm 下载安装），默认 120s。
 *   - spawnImpl 契约：(command, args, options, timeoutMs, timeoutLabel) →
 *     Promise resolving { code, output, error?, errorCode? }（同 defaultSpawn
 *     的收敛形状；errorCode 为子进程 spawn 失败的 err.code，如 'ENOENT'，
 *     desktop 分支据此走 pnpm 候选链回落；timeoutLabel 仅缺省实现用于超时
 *     文案，注入桩可忽略）。
 * @returns {Promise<object>} 恒不抛错，收敛为：
 *   - { ok: true, upToDate: true, current }                    本地已不落后 registry
 *   - { ok: true, version, profile, output, elapsedMs }        升级成功（退出码 0）
 *   - { ok: false, error, output?, elapsedMs? }                各类失败（原因见 error）
 */
export async function runUpgrade({ profile, fetchImpl, spawnImpl, timeoutMs = 120000, now } = {}) {
  if (upgradeInFlight) return { ok: false, error: '升级正在进行中' }
  upgradeInFlight = true
  try {
    return await doRunUpgrade({ profile, fetchImpl, spawnImpl, timeoutMs, now })
  } catch (err) {
    // 防御性兜底：上面的编排路径本应自捕一切，这里保证互斥锁绝不因意外泄漏
    //（泄漏 = 本进程永远不能再升级）。
    return { ok: false, error: '升级执行异常: ' + String(err?.message ?? err) }
  } finally {
    upgradeInFlight = false
  }
}

async function doRunUpgrade({ profile, fetchImpl, spawnImpl, timeoutMs, now }) {
  const startedAt = typeof now === 'function' ? now() : typeof now === 'number' ? now : Date.now()
  const elapsedMs = () =>
    Math.max(0, (typeof now === 'function' ? now() : typeof now === 'number' ? now : Date.now()) - startedAt)

  // ① 版本预检：拿不到 latest 就不做半截升级（宁可不动现有安装）。官方源
  //    失败再试 npmmirror 镜像。超时给 10s：面板静默检测用 3s 够了，这里是
  //    用户显式点了「升级」、本来就要等，多花几秒换一次成功率是划算的；
  //    仍超时就如实报失败。
  const { version: current } = await currentVersion()
  const reg = await fetchLatestFromRegistry({ fetchImpl, timeoutMs: 10000 })
  const manifest = reg.ok ? reg : await fetchLatestFromMirror({ fetchImpl, timeoutMs: 10000 })
  if (!manifest.ok) {
    return { ok: false, error: `无法确定最新版本：官方源 ${reg.error}；镜像 ${manifest.error}` }
  }
  const target = manifest.latest // 形如 v0.2.3
  if (compareVersions(target, current) <= 0) return { ok: true, upToDate: true, current }
  const targetVersion = target.replace(/^v/, '')

  // ② profile 探测：开发 link: 直连形态无法就地升级，如实拒绝并指路手动命令。
  const resolved = typeof profile === 'string' && profile !== '' ? profile : await detectProfileName()
  if (!resolved) {
    return {
      ok: false,
      error: '开发 link 形态无法就地升级，请手动执行 dsh plugin add dsh-paoding@latest 切换到 registry 版本',
    }
  }

  // ③ spawn 升级子进程，按 profile 分流（守卫背景见头注）：
  //    - desktop：dsh CLI 硬拒 desktop profile（Electron 专属管理），直跑
  //      pnpm add 精确版本。cwd 必须是 profile 目录（pnpm 的操作对象就是它）；
  //      目录没有 package.json 说明 profile 未初始化，诚实失败、不硬跑。
  //    - 其余 profile：照走 dsh 插件转发器（update = pnpm update + bundle
  //      reconcile），cwd 用系统临时目录——子进程不该在仓库或 $DSH_HOME 里跑；
  //      DSH_HOME 经环境继承，由子进程的 dsh 自行解析。
  //    win32 的 dsh / pnpm 都是 .cmd shim，必须借 shell 拉起（Node 直接 spawn
  //    .cmd 会 EINVAL，见 CVE-2024-27980 加固），与 bin/dsh-paoding.mjs 同一
  //    方案；参数保持数组形式，转义交给 Node。
  const isDesktop = resolved.toLowerCase() === 'desktop'
  const desktopDir = isDesktop ? desktopProfileDir() : null
  if (isDesktop && !existsSync(path.join(desktopDir, 'package.json'))) {
    return { ok: false, error: `desktop profile 目录不存在或未初始化: ${desktopDir}` }
  }
  const useShell = process.platform === 'win32'
  const args = isDesktop
    ? ['add', `dsh-paoding@${targetVersion}`]
    : ['plugin', '--profile', resolved, 'update', 'dsh-paoding']
  const run = typeof spawnImpl === 'function' ? spawnImpl : defaultSpawn
  const spawnOptions = {
    cwd: isDesktop ? desktopDir : os.tmpdir(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShell,
  }

  // pnpm/dsh 候选链：spawn ENOENT（命令在 PATH 里不存在）才换下一路，
  // EACCES / 超时 / 退出码非 0 都是真实运行结果，如实返回不换通道。
  //   - 裸 pnpm：npm i -g pnpm / homebrew 等常规安装直接命中；
  //   - corepack pnpm：corepack 随 node 发行，node 在 PATH 就兜得住，
  //     未 enable 也能即装即用（corepack pnpm add ...）；
  //   - PNPM_HOME 常见落位（darwin ~/Library/pnpm、linux ~/.local/share/pnpm）
  //     的绝对路径：pnpm 独立安装脚本形态，spawn 绝对路径不依赖 PATH；
  //     existsSync 预筛，不存在不浪费一次 spawn。
  // 常规 profile 的 dsh 单候选同走这套循环，ENOENT 也收敛成可读文案。
  const suffix = useShell ? '.cmd' : ''
  const candidates = isDesktop
    ? [
        { command: `pnpm${suffix}`, argsPrefix: [], label: 'pnpm' },
        { command: `corepack${suffix}`, argsPrefix: ['pnpm'], label: 'corepack pnpm' },
      ]
    : [{ command: `dsh${suffix}`, argsPrefix: [], label: 'dsh' }]
  if (isDesktop) {
    const homes = [path.join(os.homedir(), 'Library', 'pnpm'), path.join(os.homedir(), '.local', 'share', 'pnpm')]
    for (const home of homes) {
      const bin = path.join(home, `pnpm${suffix}`)
      if (existsSync(bin)) candidates.push({ command: bin, argsPrefix: [], label: bin })
    }
  }

  let proc = null
  for (const cand of candidates) {
    proc = await run(cand.command, [...cand.argsPrefix, ...args], spawnOptions, timeoutMs,
      isDesktop ? 'pnpm add' : 'dsh plugin update')
    if (proc?.errorCode !== 'ENOENT') break
  }
  const output = tailOutput(proc?.output)

  // 全候选 ENOENT：给可操作的出路，不裸抛 spawn xxx ENOENT。
  if (proc?.errorCode === 'ENOENT') {
    const tried = candidates.map((c) => c.label).join(' / ')
    return {
      ok: false,
      error: isDesktop
        ? `未找到可用的 pnpm（已试 ${tried}）。可先在终端执行 corepack enable 并重启 DSH 后重试；或手动升级：cd ${desktopDir} && corepack pnpm add dsh-paoding@${targetVersion}`
        : `未找到 dsh 命令（PATH 异常？已试 ${tried}），请检查 dsh 安装后重试`,
      output,
      elapsedMs: elapsedMs(),
    }
  }

  // ④ 无磁盘后验（旧 npx 时代读 $DSH_HOME/dsh-paoding 对账的方案已随该目录
  //    一并废弃）：本进程代码不随升级变化，无从对账；成功与否以退出码为准，
  //    新版本重启 DSH 后生效（preset 由新版启动钩子自动重生成）。
  if (proc?.error) return { ok: false, error: proc.error, output, elapsedMs: elapsedMs() }
  if (proc?.code !== 0) {
    // 报错文案点明实际通道：desktop 是 pnpm 直装，其余是 dsh 插件转发器。
    return {
      ok: false,
      error: isDesktop ? `pnpm add 退出码 ${proc?.code}` : `dsh plugin update 退出码 ${proc?.code}`,
      output,
      elapsedMs: elapsedMs(),
    }
  }
  return { ok: true, version: targetVersion, profile: resolved, output, elapsedMs: elapsedMs() }
}
