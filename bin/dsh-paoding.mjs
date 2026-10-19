#!/usr/bin/env node
// npx dsh-paoding 的薄委托入口：本身零安装逻辑，只把安装动作转交 `dsh plugin add`。
// 为什么不在这里复刻挂载：唯一挂载通道在 dsh host 侧（pnpm 装包 + bundle patch），
// 复刻一份就是第二条会漂移的路径——旧版多通道（symlink/稳定载荷）的清理成本是前车之鉴。
// 幂等：pnpm 对已装同版本的包是 no-op，重复执行本入口安全。
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
// profile 名白名单与 tools/lib/cli.mjs 共用同一份常量（抽在 util 防两处漂移）。
import { PROFILE_NAME_RE } from '../tools/lib/util.mjs';

const REFUSE =
  '本入口是 dsh plugin 的快捷方式，完整功能见 dsh plugin --help / 侧栏底部「庖丁配置」入口';

const usage = `dsh-paoding 安装快捷方式（等价于 dsh plugin --profile <name> add dsh-paoding@<version>）

用法：npx dsh-paoding@latest [--profile <name>]
      npx dsh-paoding@latest doctor [--profile <name>] [--config <file>] [--fix] [--yes]
      npx dsh-paoding@latest uninstall [--purge] [--yes] [--config <file>]

子命令：
  doctor            本机安装体检（默认只读）：配置文件 / 预设轨道 / 托管声明行 /
                    孤儿工作区预设 / 预设漂移 / 版本标记，结尾给汇总；
                    有错误级发现时退出码 1。--fix 对其中可安全自动修的两类动手
                    （孤儿预设目录、孤儿/过期声明行；写盘前备份 .bak-1），其余
                    发现只给处理建议，输出逐项标注「已修 / 需手动」。
  uninstall         清理庖丁写进宿主目录的东西：cordis.patch.yml 托管声明块、
                    .agent-presets 下的 orchestrator* 预设目录、.generator-version
                    标记。默认保留配置文件及其备份（用户数据），--purge 才连配置
                    一起删；不碰插件包自身（包本体用 dsh plugin remove 卸载）。
                    非交互终端（非 TTY）下没带 --yes 只列计划不执行，退出码 2。

选项：
  --profile <name>  插件装入的 profile，默认 web（dsh web 的默认 profile）
  --config <file>   配置文件路径（doctor / uninstall 子命令使用）
  --purge           uninstall 连配置文件及其备份一起删（默认保留）
  --yes             跳过逐类确认直接执行（uninstall / doctor --fix）
  --fix             doctor 体检后自动修可安全处理的问题
  --help            显示本帮助
  --version         显示包版本

${REFUSE}`;

// 版本读自身包根 package.json 而非 latest：npx 拉到哪个版本就装哪个版本，两边才必然一致；
// 写 latest 会让 host 再解析一次 registry，可能装出另一个版本。
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const argv = process.argv.slice(2);

// doctor / uninstall 子命令：包不再携带独立 CLI，但 tools/ 随包发布
//（package.json files），逻辑本体在 tools/lib/cli.mjs——这里 dynamic import
// 转发（--profile / --config / --fix / --purge / --yes 等参数原样透传，由它
// 自己的 parseArgs 解析），退出码语义：成功 0，有 error 级发现或清理失败 1，
// 非 TTY 无 --yes 的防呆拒做 2。放在参数循环之前：子命令的参数不用本入口的
// profile 解析兜底。
if (argv.includes('doctor') || argv.includes('uninstall')) {
  try {
    const { main } = await import('../tools/lib/cli.mjs');
    process.exit((await main({ argv })) ?? 0);
  } catch (err) {
    console.error(`子命令运行失败：${err?.message ?? err}`);
    process.exit(1);
  }
}

let profile;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--help') { console.log(usage); process.exit(0); }
  if (arg === '--version') { console.log(version); process.exit(0); }
  if (arg === '--profile' || arg.startsWith('--profile=')) {
    profile = arg.includes('=') ? arg.slice('--profile='.length) : argv[++i];
    // 只收常规 profile 名（PROFILE_NAME_RE，与 tools/lib/cli.mjs 同一份常量）：
    // win32 经 shell 拼接命令行，在源头排除空格与元字符
    if (!profile || !PROFILE_NAME_RE.test(profile)) {
      console.error(`无效的 --profile 值：${profile ?? '(缺值)'}\n${REFUSE}`);
      process.exit(2);
    }
    continue;
  }
  console.error(`不认识的参数：${arg}\n${REFUSE}`);
  process.exit(2);
}

// cwd 用临时目录：安装动作不该在用户当前目录留任何副作用。
// win32 的 dsh 是 .cmd shim，必须借 shell 拉起（Node 直接 spawn .cmd 会 EINVAL）。
const child = spawn(process.platform === 'win32' ? 'dsh.cmd' : 'dsh',
  ['plugin', '--profile', profile ?? 'web', 'add', `dsh-paoding@${version}`], {
    stdio: 'inherit', // pnpm 下载输出直接进终端；下载时长不定，不设超时
    cwd: os.tmpdir(),
    shell: process.platform === 'win32',
  });

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('未找到 dsh 命令——本入口依赖已安装的 DSH host，请先安装 dsh 再用，或直接阅读文档安装说明。');
  } else {
    console.error(`dsh 启动失败：${err.message}`);
  }
  process.exit(1);
});

child.on('close', (code) => {
  if (code === 0) {
    console.log(`已通过插件通道安装到 profile ${profile ?? 'web'}。`);
    console.log('重启 DSH 后生效——preset 会在启动时自动生成，面板入口在左侧栏底部（设置行上方）的「庖丁配置」入口。');
  }
  process.exitCode = code ?? 1; // 子进程退出码原样透传，别吞掉 dsh/pnpm 的失败信号
});
