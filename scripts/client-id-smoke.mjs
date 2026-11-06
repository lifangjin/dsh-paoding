#!/usr/bin/env node
/**
 * client-id-smoke.mjs — client bundle 注册 id 对宿主 URL 形状的冒烟守门。
 *
 * 背景（dsh-maoying#5 同类风险）：client bundle 从 document.currentScript.src
 * 推导 __ModuleLoader__.load 的注册 id，而宿主代际会改这个 URL 的形状——
 *   - 0.2.1-rc.5 及之前：/plugins/<名>/client.js（?rev= 或 &rev= 拼尾）
 *   - 0.2.2-rc.1 起：集合式 /plugins/??<名>/client.js&rev=<hash>（「??」是宿主
 *     chunkUrl() 的集合分隔约定，一个 URL 服务同包多资源；多插件时逗号拼接，
 *     ?? 包住整个 id 列表，如 /plugins/??a/client.js,b/client.js&rev=…）。
 * maoying 的捕获正则 [^/]+ 把 ?? 捕进包名，id 变 ??dsh-maoying，首载后置校验
 * 失败整包不可用。本插件 0.3.3 起改用封闭候选集字面量 indexOf（见
 * 00-prologue.js 头注释），对形状免疫——但「免疫」是论证，不是防线：本脚本
 * 把论证变成机器可验的契约，宿主下次再改 URL 形状时当场红。
 *
 * 三步校验（零依赖、不启浏览器）：
 *   ① 语法可编译：整份产物 new Function 包裹，解析失败即红；
 *   ② URL 形状矩阵：stub window.__ModuleLoader__ / document.currentScript，
 *      按 8 种 URL 形状 × 2 个挂载名（bundle 层 dsh-paoding / 用户层
 *      paoding-config-ui）+ 无 src 回退，逐例求值产物顶层、截获 load({id,
 *      factory})，断言 id 与挂载名一致、factory 是函数；
 *   ③ 阴性对照不在本文件（见 tests/client-smoke.test.mjs：把真实产物的 id
 *      行换成 maoying#5 式捕获正则，断言本冒烟必须抓红）。
 *
 * 用法：
 *   node scripts/client-id-smoke.mjs            # 独立跑，校验 lib/client.js
 *   （scripts/build-client.mjs 构建 / --check 时对拼接结果前置自动调用）
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const defaultOut = join(repoRoot, "plugins", "paoding-config-ui", "lib", "client.js");

/** 两个合法挂载名：封闭集合（bundle 层 patch / 用户层 patch，见 prologue 头注释）。 */
const MOUNTS = ["paoding-config-ui", "dsh-paoding"];
/** 无 src（currentScript 缺席）时的回退 id：主包名。 */
const FALLBACK_ID = "dsh-paoding";
/** combo 形状里的陪跑插件名：只占位，不该被本插件的解析逻辑选中。 */
const BYSTANDER = "dsh-better-sidebar";

/** URL 形状矩阵。url(mount) 返回完整 src；null 表示 currentScript 缺席。 */
const SRC_SHAPES = [
  { label: "无 src（currentScript 缺席，回退主包名）", url: () => null, mounts: ["dsh-paoding"] },
  { label: "裸路径无查询串", url: (m) => `https://host.example/plugins/${m}/client.js` },
  { label: "旧单（0.2.1-rc.5-，?rev=）", url: (m) => `https://host.example/plugins/${m}/client.js?rev=7de05c053dbf` },
  { label: "旧 combo 首位（&rev=，多插件逗号拼）", url: (m) => `https://host.example/plugins/${m}/client.js,${BYSTANDER}/client.js&rev=7de05c053dbf` },
  { label: "旧 combo 尾位", url: (m) => `https://host.example/plugins/${BYSTANDER}/client.js,${m}/client.js&rev=7de05c053dbf` },
  { label: "0.2.2-rc.1+ 集合式 ?? 单", url: (m) => `https://host.example/plugins/??${m}/client.js&rev=7de05c053dbf` },
  { label: "0.2.2-rc.1+ 集合式 ?? combo 首位", url: (m) => `https://host.example/plugins/??${m}/client.js,${BYSTANDER}/client.js&rev=7de05c053dbf` },
  { label: "0.2.2-rc.1+ 集合式 ?? combo 尾位", url: (m) => `https://host.example/plugins/??${BYSTANDER}/client.js,${m}/client.js&rev=7de05c053dbf` },
];

/**
 * 对一份 client bundle 源码跑全部冒烟断言。
 * @param {string} source 产物全文（lib/client.js）
 * @returns {string[]} 失败清单；空数组 = 全过
 */
export function runClientIdSmoke(source) {
  const failures = [];

  // ① 语法可编译
  let compiled;
  try {
    compiled = new Function("window", "document", source);
  } catch (err) {
    return [`lib/client.js 语法不可编译：${err.message}`];
  }

  // ② URL 形状矩阵：逐例求值顶层（factory 只定义不执行），截获 load 参数。
  const evalOnce = (label, src, expectId) => {
    let definition = null;
    const windowStub = {
      __ModuleLoader__: {
        load(def) {
          definition = def;
        },
      },
    };
    const documentStub = {
      currentScript: src === null ? null : { src },
      // 顶层不求值 factory，不触 DOM；给真值 querySelector 以防未来顶层
      // 代码演进用到（maoying 冒烟同款护栏）。
      querySelector: () => ({}),
    };
    try {
      compiled(windowStub, documentStub);
    } catch (err) {
      failures.push(`顶层求值失败（${label}）：${err.message}`);
      return;
    }
    if (!definition || typeof definition !== "object") {
      failures.push(`未截获 __ModuleLoader__.load（${label}）——顶层必须恰好调用一次 load`);
      return;
    }
    if (typeof definition.factory !== "function") {
      failures.push(`load({ factory }) 缺 factory 或非函数（${label}）`);
    }
    if (definition.id !== expectId) {
      failures.push(`注册 id 应为 ${expectId}（${label}），实得「${definition.id}」`
        + `——宿主 URL 形状又变了？参照 dsh-maoying#5 检查 00-prologue.js 的 id 解析`);
    }
  };

  for (const shape of SRC_SHAPES) {
    for (const mount of shape.mounts ?? MOUNTS) {
      const src = shape.url(mount);
      const expectId = src === null ? FALLBACK_ID : mount;
      evalOnce(`${shape.label} × 挂载 ${mount}`, src, expectId);
    }
  }

  return failures;
}

// 直接运行：校验磁盘上的 lib/client.js，独立于构建脚本使用。
if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] ?? "").href) {
  let source;
  try {
    source = readFileSync(defaultOut, "utf8");
  } catch (err) {
    process.stderr.write(`错误：读不到 ${defaultOut}（${err.message}）。先跑 node scripts/build-client.mjs 生成产物。\n`);
    process.exit(1);
  }
  const failures = runClientIdSmoke(source);
  if (failures.length) {
    process.stderr.write("client-id 冒烟未过：\n  - " + failures.join("\n  - ") + "\n");
    process.exit(1);
  }
  process.stdout.write("client-id 冒烟通过：编译 ✓ / URL 形状矩阵全对（8 形状 × 2 挂载名 + 无 src 回退）✓\n");
}
