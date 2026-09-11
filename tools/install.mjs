#!/usr/bin/env node
/**
 * dsh-paoding installer — CLI 入口 + 公共 API 聚合薄层。
 *
 * 原单文件（2767 行）的功能实现已按模块拆分到 tools/lib/*.mjs（util / yaml /
 * config / host / skills / spans / compose / alloc / wizard / state / cli 模块
 * 树）；本文件仅保留：
 *   - 公共导出面（与旧单文件完全一致，供 plugins/paoding-config-ui 消费）：
 *     DEFAULT_MAIN_AGENT_PERSONA_EXTRA / collectState / generateAndInstall；
 *   - 直接运行守卫（CLI entry：import 本模块不触发安装，仅直接执行时经
 *     lib/cli.mjs 的 main() 运行）。
 */
import { pathToFileURL } from 'node:url'
import { main } from './lib/cli.mjs'

export { DEFAULT_MAIN_AGENT_PERSONA_EXTRA } from './lib/util.mjs'
export { collectState, generateAndInstall } from './lib/state.mjs'

// CLI entry: only run main() when invoked directly (importing this module for
// the visual config UI must not trigger an install).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const exitCode = await main()
  process.exit(exitCode)
}
