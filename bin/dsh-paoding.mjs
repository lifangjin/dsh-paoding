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
  '本入口是 dsh plugin 的快捷方式，完整功能见 dsh plugin --help / 设置 → 庖丁配置';

const usage = `dsh-paoding 安装快捷方式（等价于 dsh plugin --profile <name> add dsh-paoding@<version>）

用法：npx dsh-paoding@latest [--profile <name>]

选项：
  --profile <name>  插件装入的 profile，默认 web（dsh web 的默认 profile）
  --help            显示本帮助
  --version         显示包版本

${REFUSE}`;

// 版本读自身包根 package.json 而非 latest：npx 拉到哪个版本就装哪个版本，两边才必然一致；
// 写 latest 会让 host 再解析一次 registry，可能装出另一个版本。
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const argv = process.argv.slice(2);
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
    console.log('重启 DSH 后生效——preset 会在启动时自动生成，面板入口在 Web 左侧栏「新会话」下方。');
  }
  process.exitCode = code ?? 1; // 子进程退出码原样透传，别吞掉 dsh/pnpm 的失败信号
});
