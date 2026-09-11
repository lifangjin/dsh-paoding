#!/usr/bin/env node
/**
 * npx 一键安装入口（package.json bin.dsh-paoding）。经 .bin 符号链接运行时
 * import.meta.url 与 argv[1] 比对会失效，故不复用 tools/install.mjs 的直接运行
 * 守卫，而是直接调 lib/cli.mjs 的 main() 并注入 bin 默认值：快速安装 = 非交互
 * （--auto）+ 挂载配置 UI（--config-ui）；用户显式旗标（--wizard / --no-ui /
 * --suggest 等）优先。
 */
import { main } from '../tools/lib/cli.mjs'

const exitCode = await main({ bin: true, argv: process.argv.slice(2) })
process.exit(exitCode)
