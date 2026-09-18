#!/usr/bin/env node
// build-client.mjs — 把 plugins/paoding-config-ui/src/client/ 下的源头片段
// 按文件名顺序拼接（直接 concat，不插入任何分隔符）生成 lib/client.js。
//
// 用法：
//   node scripts/build-client.mjs           # 拼接并写出 lib/client.js（幂等）
//   node scripts/build-client.mjs --check   # 只比对，不一致时 exit 1（CI / prepublish 护栏）
//
// 纪律：片段是纯字节区段，本脚本不做任何转换；产物必须与片段依次相连逐字节
// 相等。文件名用两位序号前缀（00-90）保证拼接顺序稳定。

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const pluginDir = join(repoRoot, "plugins", "paoding-config-ui");
const srcDir = join(pluginDir, "src", "client");
const outFile = join(pluginDir, "lib", "client.js");

const checkOnly = process.argv.slice(2).some((a) => a === "--check" || a === "-c");

function fail(msg) {
  process.stderr.write("错误：" + msg + "\n");
  process.exit(1);
}

// 布局自检：脚本被挪走或从别的仓库误跑时，给出能定位问题的提示。
if (!existsSync(join(repoRoot, "package.json"))) {
  fail("找不到仓库根（" + repoRoot + " 下没有 package.json）。请在 dsh-paoding 仓库内、以 scripts/build-client.mjs 的原位置运行。");
}
if (!existsSync(srcDir)) {
  fail("源头目录不存在：" + srcDir + "\nclient bundle 的片段应在 plugins/paoding-config-ui/src/client/ 下，请先确认目录名与位置。");
}

// 只收 .js 片段，按文件名（UTF-16 码元序，两位序号前缀下等价于字典序）排序。
let parts;
try {
  parts = readdirSync(srcDir).filter((n) => n.endsWith(".js")).sort();
} catch (err) {
  fail("读取源头目录失败：" + srcDir + "（" + err.message + "）");
}
if (parts.length === 0) {
  fail("源头目录是空的（没有 .js 片段）：" + srcDir + "\n至少应有 00-prologue.js 与 90-epilogue.js。");
}

let expectedBytes = 0;
const buffers = [];
for (const name of parts) {
  const p = join(srcDir, name);
  if (!statSync(p).isFile()) fail("片段不是普通文件：" + p);
  const buf = readFileSync(p);
  buffers.push(buf);
  expectedBytes += buf.length;
}

// 对账：拼出的产物字节数必须等于片段字节数之和（concat 不增不减）。
const joined = Buffer.concat(buffers);
if (joined.length !== expectedBytes) {
  fail("对账失败：片段字节合计 " + expectedBytes + " ≠ 拼接结果 " + joined.length + "，拼接逻辑被改动了？");
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let line = 1;
  let col = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      // 折算成 1 起始的行号与行内偏移，方便人工去查。
      for (let j = 0; j < i; j++) if (a[j] === 0x0a) line++;
      let ls = i;
      while (ls > 0 && a[ls - 1] !== 0x0a) ls--;
      let le = i;
      while (le < a.length && a[le] !== 0x0a) le++;
      return {
        byte: i + 1,
        line,
        col: i - ls + 1,
        expect: a.slice(ls, le).toString("utf8").slice(0, 120),
        got: b.slice(ls, Math.min(le, b.length)).toString("utf8").slice(0, 120),
      };
    }
  }
  return null;
}

if (checkOnly) {
  if (!existsSync(outFile)) {
    fail("找不到产物 " + outFile + "\n先跑一次 node scripts/build-client.mjs 生成，再 --check。");
  }
  const current = readFileSync(outFile);
  if (current.equals(joined)) {
    process.stdout.write("OK：lib/client.js 与 " + parts.length + " 个源头片段一致（" + joined.length + " 字节）。\n");
    process.exit(0);
  }
  const d = firstDiff(joined, current);
  process.stderr.write("--check 失败：lib/client.js 与源头片段不一致（片段合计 " + joined.length + " 字节，现存产物 " + current.length + " 字节）。\n");
  if (d) {
    process.stderr.write("首个差异在第 " + d.line + " 行第 " + d.col + " 列（第 " + d.byte + " 字节）：\n"
      + "  片段应为：" + JSON.stringify(d.expect) + "\n"
      + "  产物实为：" + JSON.stringify(d.got) + "\n");
  } else {
    process.stderr.write("前缀完全相同，只是总长度不同（多半是有人直接手编了产物，或片段增删后忘了重拼）。\n");
  }
  process.stderr.write("请重新运行 node scripts/build-client.mjs 重新生成，不要手改 lib/client.js。\n");
  process.exit(1);
}

// 幂等写出：内容没变就不写盘（不改 mtime，重复跑输出恒定）。
if (existsSync(outFile) && readFileSync(outFile).equals(joined)) {
  process.stdout.write("已是最新，跳过写入：lib/client.js（" + parts.length + " 个片段，" + joined.length + " 字节）。\n");
  process.exit(0);
}
writeFileSync(outFile, joined);
process.stdout.write("已生成 lib/client.js（" + parts.length + " 个片段，" + joined.length + " 字节，按 " + parts[0] + " … " + parts[parts.length - 1] + " 顺序拼接）。\n");
