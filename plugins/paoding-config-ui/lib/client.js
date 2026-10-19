/**
 * paoding-config-ui — DSH Web client bundle (手写，零构建)
 *
 * 加载机制（借鉴 dsh-better-sidebar，DSH 0.1.1-rc.1 实测通过；注册 id
 * 自 0.3.2 起改为从图行 URL 动态解析）：
 *  - dsh-client-modules 节点半扫描挂载包 package.json 的 dsh.client 声明 +
 *    exports["./client"]，把本文件编入 window.__DSH_BOOT__ 并以
 *    /plugins/<挂载包名>/client.js 服务（图行 id = 挂载包名）。
 *  - 浏览器内核为 manifest 中每个插件创建 loader 条目并激活，故本文件
 *    必然被拉取执行；__ModuleLoader__.load 的 id 必须等于图行 id（挂载
 *    包名），否则首次加载的后置校验（factories.has(图行 id)）必失败 →
 *    import 报错 → 二次加载重复执行本文件 → 撞 "duplicate factory
 *    registration" 守卫。挂载名有二：本机 install.sh --config-ui 为
 *    子包 paoding-config-ui（用户层 patch），发布 `dsh plugin add
 *    dsh-paoding` 为主包 dsh-paoding（bundle 层 patch）。
 *  - id 解析（0.3.3）：宿主把多个插件的 client.js 逗号拼成一个合并
 *    bundle script 请求（/plugins/a/client.js,b/client.js&rev=…），
 *    "/plugins/" 全串只出现一次且后跟带 scope 的首行，任何
 *    /plugins/<名>/client.js 正则都必失配（0.3.2 的解析因此回退错名，
 *    后置校验必失败）；且合并 bundle 下所有插件共享同一 URL，无法
 *    泛化定位"哪段是我"。挂载名是封闭二选一集合，且宿主保证本行
 *    URL <挂载名>/client.js 必在 script src 里（否则本代码不会被执行），
 *    故直接在 currentScript.src 里找候选名，未命中回退主包名。
 *  - factory 内 require() 只解析平台 seed 模块（react / cordis /
 *    ui-slots / ui-primitives 与已物化模块）；本 bundle 依赖 react 与
 *    @deepseek-ai/dsh-client-ui-primitives。
 *  - 图标跨版本兜底：DSH ≤0.1.6 图标导出名带尺寸后缀（IconCheckOutline16），
 *    0.1.7-rc.1 起改粗细命名 + size prop，factory 内把旧名别名到 Regular 版。
 *  - 挂载点：左侧栏底部动作位入口（sidebar.footer.action 键控槽，与插件
 *    广场 cordis 徽章同槽，设置行上方）+ 会话中栏全页 overlay
 *    （data-dsh-paoding-view / html[data-dsh-paoding-active]）；
 *    与 mnemon / taskboard / ssh 全页面板互斥（dsh-panel-activate 事件 +
 *    html active 属性观察），点侧栏会话行等上下文自动关闭。
 *  - UI：按 DSH 设置壳原生观感重绘（dsh-better-sidebar 的 SideCardSection
 *    配方）——分组容器卡 + 设计令牌（--dsw-alias-*，运行时注入，浅/深色
 *    主题经 body[data-ds-dark-theme] 自动跟随）。样式正文独立在 lib/base.css，
 *    由 Node 半经 GET /api/paoding/client.css 下发，本文件只在首次物化时
 *    幂等注入 <link data-plugin-css="paoding-config-ui/base">（热重载不重复；
 *    bundle 内不含 CSS 正文，改样式无需重编 bundle）；组件用 ui-primitives
 *    （Button / Pill / 图标）+ 原生 checkbox / textarea（原生语义与焦点）。
 *    数据走同源 /api/paoding/*（Node 半注册，带浏览器信任围栏）。
 */
var __dshSrc = (document.currentScript && document.currentScript.src) || "";
window.__ModuleLoader__.load({
  id: __dshSrc.indexOf("paoding-config-ui/client.js") !== -1 ? "paoding-config-ui" : "dsh-paoding",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;
    var useState = React.useState, useEffect = React.useEffect, useCallback = React.useCallback, useRef = React.useRef;
    var P = require("@deepseek-ai/dsh-client-ui-primitives");

    // 图标跨版本兜底：DSH ≤0.1.6 的 ui-primitives 图标导出名带尺寸后缀
    // （IconCheckOutline16 / IconChevronDownOutline14，IconProps { size,
    // className }）；0.1.7-rc.1 起改粗细命名（…OutlineRegular / …Medium，
    // size 变 prop、默认 16），12 个旧名全部消失。同一份 bundle 要在两代
    // 宿主上都能跑：旧名缺、新名在，才把旧名别名到对应 Regular 版——新
    // 组件接受 size prop，ic() 的 size 传参照常生效，旧 14px 名 → Regular
    // + size 14 视觉等价（同为 1px 描边）。旧宿主上有原生实现就用原生，
    // Button / Pill 等两代都有的导出一律不动。
    P = Object.assign({}, P); // 复制一份导出面再补别名：不往共享模块对象上写属性（避免污染宿主里其他 ui-primitives 消费者）；P 是 factory 作用域的 var，重赋值后所有后续片段看到的就是这份副本
    (function () {
      var ICON_ALIAS = {
        IconCheckOutline16: "IconCheckOutlineRegular",
        IconChevronDownOutline14: "IconChevronDownOutlineRegular",
        IconCordisPluginOutline14: "IconCordisPluginOutlineRegular",
        IconDataOutline16: "IconDataOutlineRegular",
        IconEditOutline16: "IconEditOutlineRegular",
        IconLoadingOutline16: "IconLoadingOutlineRegular",
        IconPlusOutline16: "IconPlusOutlineRegular",
        IconRefreshOutline16: "IconRefreshOutlineRegular",
        IconSkillOutline16: "IconSkillOutlineRegular",
        IconTrashOutline16: "IconTrashOutlineRegular",
        IconUserOutline16: "IconUserOutlineRegular",
        IconWarningOutline16: "IconWarningOutlineRegular",
      };
      Object.keys(ICON_ALIAS).forEach(function (oldName) {
        var newName = ICON_ALIAS[oldName];
        if (P[oldName] === undefined && P[newName] !== undefined) P[oldName] = P[newName];
      });
    })();

    // ── i18n（zh / en 双语）───────────────────────────────────────────────
    //
    // 机制：
    //  - 字典 PAODING_I18N_DICT 是「纯数据字面量」——对象里只有字符串值，无
    //    函数、无外部变量引用，便于 tests/i18n.test.mjs 用 node:vm 直接执行本
    //    片段提取字典，做 zh/en key 对账、占位符校验与「文案 key 必须在字典」
    //    的静态扫描。key 按片段/功能分命名空间：dom.*（渲染助手）/ api.* /
    //    ver.*（版本更新卡）/ models.* / tpl.*（场景模板）/ ws.*（工作区）/
    //    panel.*（配置面板正文）/ role.*（角色卡与委派行标题）/ warn.*（体检
    //    告警卡）/ nav.*（侧栏入口与页头壳）/ menu.*（页头「更多」菜单与升级）/
    //    slim.*（工具面瘦身统计）/ diff.*（预览「本次变更」结构化差分）/
    //    common.*（跨片段复用的短词）。
    //  - t(key, params)：按当前语言取文案，params 做 {name} 插值（split/join
    //    而非 replace，避免替换串里的 $ 模式被二次解释）。缺 key 原样返回 key
    //    本身——线上宁可露出 key 也不静默吞掉，测试侧保证不会发生。
    //  - 语言解析（zh 信号优先）：localStorage "paoding-lang" 显式优先 →
    //    navigator.language/languages 与宿主页面 <html lang> 任一带 zh 前缀
    //    → zh → 时区属中文地区 → zh → en 前缀命中 → en → 兜底 zh。Electron
    //    外壳会把 navigator 语言钉成应用 locale（常 en-US，不跟操作系统），
    //    en 信号不可信而时区可信，故 zh 信号整体压过 en；服务端消息仅中文，
    //    误判 zh（真英文用户点一次 English 即记住）代价远小于误判 en 混排。
    //  - 切语言：setLang(lang) 写 localStorage + 同步广播 onLangChange；
    //    监听方各自刷新（86 PageShell 整页重渲染、82 委派行重建标题），面板
    //    数据重拉复用既有 registerReload 通道，不另造机制。
    //  - 取舍：服务端下发的文案（API error message、体检 items 的 message、
    //    升级 note/message）本轮保持原文展示（服务端仅中文），字典只补本地化
    //    的标题/框架文案；warn.title.<code> 按 code 给行级标题，服务端 message
    //    原文作正文。

    var PAODING_LANG_KEY = "paoding-lang";

    // 语言探测：localStorage 显式值优先；其余按 navigator.language 首缀猜 zh，
    // 兜底 en。全程 try/catch——非浏览器/受限环境（vm 测试、老内核）不炸，逐层回落。
    function paodingDetectLang() {
      // zh 信号优先于 en 信号（不是平级链）：Electron 外壳会把 navigator
      // 语言钉成应用 locale（常为 en-US，跟打包不跟操作系统），en 命中在
      // 本环境不可信；而本插件服务端消息仅中文，误判 zh 的代价（真英文
      // 用户点一次 English，localStorage 记住）远小于误判 en（中文用户看
      // 中英混排面板）。故顺序：显式选择 → 任一 zh 信号 → en 信号 → zh。
      // ① 手动选择（localStorage）显式最优先
      try {
        var saved = window.localStorage.getItem(PAODING_LANG_KEY);
        if (saved === "zh" || saved === "en") return saved;
      } catch (err) { /* localStorage 不可用：继续探测 */ }
      var navLangs = [];
      try {
        if (typeof navigator !== "undefined") {
          if (navigator.language) navLangs.push(String(navigator.language));
          if (navigator.languages && navigator.languages.length) {
            for (var i = 0; i < navigator.languages.length; i++) navLangs.push(String(navigator.languages[i]));
          }
        }
      } catch (err) { /* navigator 不可用：navLangs 留空 */ }
      var docLang = "";
      try {
        docLang = String((document.documentElement && document.documentElement.lang) || "");
      } catch (err) { /* 无 document：留空 */ }
      // ② navigator / 宿主页面 <html lang> 任一带 zh 前缀 → zh
      for (var j = 0; j < navLangs.length; j++) {
        if (navLangs[j].toLowerCase().indexOf("zh") === 0) return "zh";
      }
      if (docLang.toLowerCase().indexOf("zh") === 0) return "zh";
      // ③ 时区属中文地区 → zh：Electron webview 里 navigator 常整体被钉成
      //    en-US，时区是跟着操作系统走的最后真身（Asia/Shanghai 等）。
      try {
        var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        if (/Asia\/(Shanghai|Hong_Kong|Macau|Taipei|Urumqi|Chongqing)$/.test(tz)) return "zh";
      } catch (err) { /* 无 Intl：继续 */ }
      // ④ en 信号（浏览器环境常规英文用户在此命中；Electron 假 en-US 已被
      //    ③ 时区先一步接走——中文时区的 Electron 用户不会再走到这里）
      for (var k = 0; k < navLangs.length; k++) {
        if (navLangs[k].toLowerCase().indexOf("en") === 0) return "en";
      }
      if (docLang.toLowerCase().indexOf("en") === 0) return "en";
      // ⑤ 无任何信号 → zh（服务端消息仅中文，en 面板必混排）
      return "zh";
    }

    var paodingLang = paodingDetectLang();

    // 当前语言（组件渲染期读；setLang 后经广播触发重渲染再读到新值）。
    function pdLang() { return paodingLang; }

    // 取文案 + {name} 插值。缺 key 原样返回 key（显式暴露，防静默错文案）。
    function t(key, params) {
      var entry = PAODING_I18N_DICT[key];
      var s = entry ? (entry[paodingLang] != null ? entry[paodingLang] : entry.zh) : key;
      if (params) {
        Object.keys(params).forEach(function (name) {
          s = s.split("{" + name + "}").join(String(params[name]));
        });
      }
      return s;
    }

    // key 是否在字典（动态拼 key 时防「缺 key 露 key 串」的守卫，如 warn.title.<code>）。
    function tHas(key) {
      return Object.prototype.hasOwnProperty.call(PAODING_I18N_DICT, key);
    }

    // 语言变更广播：setLang 同步通知；返回反注册函数（组件卸载时退订）。
    var paodingLangListeners = [];
    function onLangChange(fn) {
      paodingLangListeners.push(fn);
      return function () {
        var i = paodingLangListeners.indexOf(fn);
        if (i !== -1) paodingLangListeners.splice(i, 1);
      };
    }

    // 切语言：只认 zh/en（其余一律归 zh，与探测兜底口径一致）；写盘失败只降级
    // 为「本次会话生效」（隐私模式等场景不炸）。
    function setLang(lang) {
      var next = lang === "en" ? "en" : "zh";
      if (next === paodingLang) return;
      paodingLang = next;
      try { window.localStorage.setItem(PAODING_LANG_KEY, next); } catch (err) { /* 写不进就只换内存态 */ }
      paodingLangListeners.slice().forEach(function (fn) {
        try { fn(); } catch (err) { /* 单个监听失败不阻断其余刷新 */ }
      });
    }

    // ── 字典（纯数据字面量：无函数、无外部引用，测试按整个片段 vm 执行提取）──
    var PAODING_I18N_DICT = {
      // common.*：跨片段复用的短词
      "common.confirm": { zh: "确认", en: "Confirm" },
      "common.cancel": { zh: "取消", en: "Cancel" },
      "common.close": { zh: "关闭", en: "Close" },
      "common.closeToast": { zh: "关闭提示", en: "Dismiss notification" },
      "common.confirmDelete": { zh: "确认删除", en: "Delete" },
      "common.restoreDefault": { zh: "恢复默认", en: "Restore default" },
      "common.listSep": { zh: "；", en: "; " },
      "common.period": { zh: "。", en: "." },
      "common.projectBadge": { zh: "项目", en: "Project" },

      // dom.*：20 片段渲染助手的定稿文案
      "dom.runtimeFallback": { zh: "运行时识别不可用，已回退文件扫描（{err}）", en: "Runtime detection unavailable — fell back to file scanning ({err})" },
      "dom.bgContinuableHint": { zh: "可续会话跨轮保留子代理上下文：产出不满可用 send_message 就地续修；无自动清理，落盘与 token 成本随轮次累积，建议仅多轮打磨类角色开启。", en: "Continuable sessions keep the child conversation across turns: when a result falls short, the main agent can refine it in place via send_message. Nothing is cleaned up automatically — disk and token costs accumulate per turn, so enable it only for iterate-and-polish roles." },
      "dom.bgPersistenceWarn": { zh: "未检测到会话持久化后端（sessionPersistence）。可续模式在委派时会直接报错 PERSISTENCE_UNAVAILABLE：需在 ~/.dsh/cordis.patch.yml 挂 @deepseek-ai/dsh-session-persistence-jsonl（host 层、机器级改动，详见 docs/orchestration.md）。", en: "No session persistence backend (sessionPersistence) detected. Delegating to a continuable role fails outright with PERSISTENCE_UNAVAILABLE: mount @deepseek-ai/dsh-session-persistence-jsonl in ~/.dsh/cordis.patch.yml (a host-level, machine-wide change — see docs/orchestration.md)." },
      "dom.forkModelHint": { zh: "继承对话的子代理随主 agent 的当前模型启动，上方专用模型不会生效；应用时会忽略该项模型配置。", en: "A forked child starts with the main agent's current model — the dedicated model above has no effect and is ignored on apply." },

      // api.*：30 片段请求助手的可读错误
      "api.notJson": { zh: "HTTP {status}（响应不是 JSON）", en: "HTTP {status} (response was not JSON)" },
      "api.timeout": { zh: "请求超时（{s}s 无响应）", en: "Request timed out (no response for {s}s)" },

      // ver.*：40 片段页头版本更新卡
      "ver.checkFailed": { zh: "版本检测失败", en: "Version check failed" },
      "ver.checking": { zh: "检测中…", en: "Checking…" },
      "ver.retry": { zh: "重试", en: "Retry" },
      "ver.newAvailable": { zh: "新版本 {v} 可用 · ", en: "New version {v} available · " },
      "ver.viewUpdate": { zh: "查看更新", en: "View release" },
      "ver.upgrade": { zh: "升级", en: "Upgrade" },
      "ver.upgrading": { zh: "升级中…", en: "Upgrading…" },
      "ver.downloadHint": { zh: "下载安装中，最长约 2 分钟", en: "Downloading and installing — may take up to 2 minutes" },

      // models.*：50 片段模型选项与 70/72 的目录降级文案
      "models.followRouting": { zh: "（跟随主 agent 路由）", en: "follows main agent routing" },
      "models.current": { zh: "当前配置：{provider} · {model}", en: "Current config: {provider} · {model}" },
      "models.currentNoModel": { zh: "当前配置：{provider} ·（无模型，后端忽略）", en: "Current config: {provider} · (no model — ignored by the backend)" },
      "models.followMain": { zh: "跟随主 agent 当前模型", en: "Follow the main agent's current model" },
      "models.option": { zh: "{model}（{provider}）", en: "{model} ({provider})" },
      "models.listBadResponse": { zh: "模型目录响应格式异常", en: "Unexpected model catalog response format" },

      // tpl.*：55 片段场景模板（档位名 + 场景说明；55 的 label/desc 字段存的就是这里的 key）
      "tpl.lite.label": { zh: "轻量档", en: "Lite" },
      "tpl.lite.desc": { zh: "只留实现角色（implement），主 agent 不额外带工具。适合纯写代码。", en: "Keeps only the implement role; the main agent carries no extra tools. For pure coding sessions." },
      "tpl.research.label": { zh: "调研档", en: "Research" },
      "tpl.research.desc": { zh: "只留检索角色（search_external + 深搜），去掉设计与实现。", en: "Keeps only the research roles (search_external + deep search); drops design and implement." },
      "tpl.full.label": { zh: "全开档", en: "Full" },
      "tpl.full.desc": { zh: "四个内置角色全留，主 agent 额外工具勾上检测到的全部库存。", en: "Keeps all four built-in roles; the main agent's extra tools cover the full detected inventory." },

      // ws.*：60 片段工作区助手 + 72 的标签条 / 添加工作区弹窗
      "ws.tag.project": { zh: "项目", en: "Project" },
      "ws.tag.pending": { zh: "待应用", en: "Pending" },
      "ws.tag.global": { zh: "全局", en: "Global" },
      "ws.sessionCount": { zh: "{n} 会话", en: "{n} sessions" },
      "ws.tip.sessions": { zh: " · {n} 会话", en: " · {n} sessions" },
      "ws.tip.project": { zh: " · 项目配置（预设 {id}）", en: " · project config (preset {id})" },
      "ws.tip.pending": { zh: " · 已保存项目配置、预设未生成（点「保存并应用」生效）", en: " · project config saved, preset not generated yet (click Save & Apply to apply it)" },
      "ws.tip.global": { zh: " · 跟随全局配置", en: " · follows the global config" },
      "ws.globalTab": { zh: "全局默认", en: "Global default" },
      "ws.globalTabTip": { zh: "全局默认：写入共享的 orchestrator 预设", en: "Global default: writes the shared orchestrator preset" },
      "ws.more": { zh: "更多", en: "More" },
      "ws.moreTip": { zh: "其余 {n} 个工作区", en: "{n} more workspaces" },
      "ws.addTab": { zh: "添加工作区", en: "Add workspace" },
      "ws.addTabTip": { zh: "注册新的工作区目录", en: "Register a new workspace directory" },
      "ws.tablistLabel": { zh: "配置对象", en: "Config target" },
      "ws.menuLabel": { zh: "更多工作区", en: "More workspaces" },
      "ws.barHint": { zh: "「全局默认」写入共享的 orchestrator 预设；选中某个工作区后，预览 / 应用会生成该工作区专属预设（orchestrator-<目录名>），两者互不影响。", en: "\"Global default\" writes the shared orchestrator preset; with a workspace selected, preview/apply generates that workspace's own preset (orchestrator-<directory name>). The two never interfere." },
      "ws.addTitle": { zh: "添加工作区", en: "Add workspace" },
      "ws.pathLabel": { zh: "工作区目录绝对路径", en: "Absolute path of the workspace directory" },
      "ws.pathPlaceholder": { zh: "输入工作区目录绝对路径，如 /Users/me/code/project-a", en: "Enter an absolute directory path, e.g. /Users/me/code/project-a" },
      "ws.pathHint": { zh: "目录需已存在；已注册的目录重复提交幂等返回。", en: "The directory must already exist; re-submitting a registered path is an idempotent no-op." },
      "ws.addConfirm": { zh: "确认添加", en: "Add" },
      "ws.adding": { zh: "添加中…", en: "Adding…" },
      "ws.addedToast": { zh: "已注册工作区：{path}；配置后点「保存并应用」生成专属预设", en: "Workspace registered: {path}. Configure it, then hit Save & Apply to generate its preset" },
      "ws.existsToast": { zh: "工作区已在列表里：{path}；配置后点「保存并应用」生成专属预设", en: "Workspace already listed: {path}. Configure it, then hit Save & Apply to generate its preset" },
      "ws.listBadResponse": { zh: "工作区列表响应格式异常", en: "Unexpected workspace list response format" },
      "ws.listFailHint": { zh: "宿主工作区列表拉取失败，仅显示配置文件中的工作区；重启 DSH 后通常可恢复", en: "Failed to fetch the host workspace list — showing only workspaces from the config file; usually recovers after restarting DSH" },
      "ws.listFailDetail": { zh: "（{msg}）", en: " ({msg})" },
      "ws.notInList": { zh: "工作区 {path} 不在列表里，未切换 tab", en: "Workspace {path} is not in the list — tab not switched" },
      "ws.skillsFail": { zh: "该工作区技能列表拉取失败，技能网格已回退用户级技能", en: "Failed to fetch this workspace's skill list — the skill grid fell back to user-level skills" },

      // panel.*：70/72 配置面板正文（表单标签 / 占位符 / 提示 / toast / 按钮）
      "panel.loading": { zh: "加载检测状态…", en: "Loading detection state…" },
      "panel.scopeGlobal": { zh: "仅用户级技能", en: "User-level skills only" },
      "panel.scopeWs": { zh: "用户级 + 该工作区项目级技能", en: "User-level + this workspace's project-level skills" },
      "panel.applyBtn": { zh: "保存并应用", en: "Save & Apply" },
      "panel.applying": { zh: "处理中…", en: "Working…" },
      "panel.previewBtn": { zh: "预览生成", en: "Generate preview" },
      "panel.previewing": { zh: "生成中…", en: "Generating…" },
      "panel.rescanBtn": { zh: "重新检测", en: "Rescan" },
      "panel.scanning": { zh: "检测中…", en: "Scanning…" },
      "panel.rolesToolsHeading": { zh: "角色与工具", en: "Roles & tools" },
      "panel.tplHeading": { zh: "场景模板", en: "Scenario templates" },
      "panel.removedHeading": { zh: "已删除的内置角色", en: "Removed built-in roles" },
      "panel.restoreHint": { zh: "恢复后卡片回到上方内置列表；工具面取内置默认（不沿用删前自定义配置）。", en: "Restored cards return to the built-in list above; the toolset is rebuilt from the built-in default (pre-deletion customizations are not kept)." },
      "panel.roleAddBtn": { zh: "新建自定义 agent 角色", en: "New custom role" },
      "panel.skillsHeading": { zh: "技能分配（软约束：写入对应 agent 的 persona 引导）", en: "Skill assignment (soft constraint: written into each agent's persona guidance)" },
      "panel.skillsMain": { zh: "技能分配（read 按需：勾选 = persona 写入技能行，主 agent 用 read 加载正文）", en: "Skill assignment (read on demand: checking writes a skill line into the persona; the main agent loads the body with read)" },
      "panel.skillsInline": { zh: "内联全文（硬生效，每轮固定 persona 开销，适合 caveman 等风格技能）", en: "Inline full text (hard effect, fixed persona cost every turn — for style skills like caveman)" },
      "panel.baseToolsMain": { zh: "基础工具（取消勾选即从主 agent 移除——写入 main_agent_remove）", en: "Base tools (unchecking removes them from the main agent — written to main_agent_remove)" },
      "panel.mcpToolsMain": { zh: "MCP 工具（可加入主 agent）", en: "MCP tools (can join the main agent)" },
      "panel.pluginToolsMain": { zh: "插件工具（可加入主 agent）", en: "Plugin tools (can join the main agent)" },
      "panel.baseTools": { zh: "基础工具", en: "Base tools" },
      "panel.mcpTools": { zh: "MCP 工具", en: "MCP tools" },
      "panel.pluginTools": { zh: "插件工具", en: "Plugin tools" },
      "panel.noMcp": { zh: "未检测到 MCP 工具", en: "No MCP tools detected" },
      "panel.noPlugin": { zh: "未检测到插件工具", en: "No plugin tools detected" },
      "panel.noSkills": { zh: "未检测到技能目录", en: "No skill directories detected" },
      "panel.none": { zh: "无", en: "None" },
      "panel.tagReadOnDemand": { zh: "read按需", en: "read on demand" },
      "panel.tagInline": { zh: "内联全文", en: "Inline" },
      "panel.previewOk": { zh: "✅ 生成成功（未写盘）", en: "✅ Generated (nothing written to disk)" },
      "panel.previewPreset": { zh: " · 预设 {id}", en: " · preset {id}" },
      // 「编排模式 (Orchestrator)」是后端默认 preset 显示名的「值」，不是界面标签——
      // 占位符展示的就是生效值本身，不本地化（英文文档也沿用中文名）。
      "panel.mainNameLabel": { zh: "主 agent 显示名（仅 preset 显示名）", en: "Main agent display name (preset display name only)" },
      "panel.mainNameHint": { zh: "仅替换预设显示名，persona 身份行（You are the …）不动；留空 = 默认「编排模式 (Orchestrator)」（工作区预设用派生名）。改动需重启 GUI / 新会话生效。", en: "Replaces only the preset display name — the persona identity line (You are the …) is untouched; leave empty for the default \"编排模式 (Orchestrator)\" (workspace presets use a derived name). Takes effect after a GUI restart or in new sessions." },
      "panel.mainNameNewline": { zh: "主 agent 显示名（仅 preset 显示名）不能包含换行（\\r / \\n），未保存", en: "Main agent display name (preset display name only) cannot contain line breaks (\\r / \\n) — not saved" },
      "panel.mainNameBlank": { zh: "主 agent 显示名（仅 preset 显示名）不能为纯空白（清空字段或点「恢复默认」= 默认显示名），未保存", en: "Main agent display name (preset display name only) cannot be whitespace-only (clear the field or click Restore default for the default name) — not saved" },
      "panel.mainNameTooLong": { zh: "主 agent 显示名（仅 preset 显示名）过长：trim 后最多 60 字符，未保存", en: "Main agent display name (preset display name only) is too long: at most 60 characters after trim — not saved" },
      "panel.personaToggle": { zh: "persona（可选，覆盖默认角色说明）", en: "Persona (optional, overrides the default role description)" },
      "panel.personaPlaceholder": { zh: "输入该角色的 persona 说明…", en: "Enter this role's persona description…" },
      "panel.personaHint": { zh: "技能引导会自动追加到 persona 末尾；自定义角色必填此说明。", en: "Skill guidance is appended to the end of the persona automatically; custom roles must fill this in." },
      "panel.extraToggle": { zh: "人设追加（主 agent 提示词尾部，可编辑）", en: "Persona addendum (tail of the main agent prompt, editable)" },
      "panel.extraPlaceholder": { zh: "留空并保存 = 不追加任何内容（默认 codegraph 规则将被移除）…", en: "Leave empty and save to append nothing (the default codegraph rules will be removed)…" },
      "panel.extraActionHint": { zh: "保存并应用时按此追加到主 agent persona 末尾（顺序：SRC 本体 → 技能行 → 此处）。改动需重启 GUI / 新会话生效。", en: "Appended to the end of the main agent persona on Save & Apply (order: SRC body → skill lines → this). Takes effect after a GUI restart or in new sessions." },
      "panel.extraClearHint": { zh: "清空保存 = 移除默认 codegraph 规则（配置键 main_agent_persona_extra 记为 ''）。", en: "Save while empty to remove the default codegraph rules (config key main_agent_persona_extra is stored as \'\')." },
      "panel.roleNameLabelCustom": { zh: "角色显示名（事件流委派行标题；不动 toolName / persona）", en: "Role display name (title of the delegation row in the event stream; does not touch toolName / persona)" },
      "panel.roleNameLabelBuiltin": { zh: "角色显示名（persona 身份句主语 + 事件流委派行标题；不动工具名/调用名）", en: "Role display name (subject of the persona identity line + delegation row title; does not touch tool names / call names)" },
      "panel.roleNameHintCustom": { zh: "留空 = 事件流显示 toolName（{name}）；保存并应用后生效（仅 GUI 展示，不影响生成产物与调用名）。", en: "Leave empty to show the toolName ({name}) in the event stream; takes effect on Save & Apply (GUI display only — no effect on generated artifacts or call names)." },
      "panel.roleNameHintBuiltin": { zh: "留空 = 默认身份（如 \"You are the {subject} agent.\"）；已为该角色自定义 persona 时仅作事件流标题。", en: "Leave empty for the default identity (e.g. \"You are the {subject} agent.\"); serves only as the event-stream title when this role has a custom persona." },
      "panel.roleNameNewline": { zh: "角色 \"{name}\" 显示名不能包含换行（\\r / \\n），未保存", en: "Display name of role \"{name}\" cannot contain line breaks (\\r / \\n) — not saved" },
      "panel.roleNameTooLong": { zh: "角色 \"{name}\" 显示名过长：trim 后最多 60 字符，未保存", en: "Display name of role \"{name}\" is too long: at most 60 characters after trim — not saved" },
      "panel.roleModelLabel": { zh: "专用模型（可选；留空 = 跟随主 agent 当前模型）", en: "Dedicated model (optional; leave empty to follow the main agent's current model)" },
      "panel.roleModelNewline": { zh: "角色 \"{name}\" {field}不能包含换行（\\r / \\n），未保存", en: "{field} of role \"{name}\" cannot contain line breaks (\\r / \\n) — not saved" },
      "panel.roleModelTooLong": { zh: "角色 \"{name}\" {field}过长：trim 后最多 120 字符，未保存", en: "{field} of role \"{name}\" is too long: at most 120 characters after trim — not saved" },
      "panel.modelField": { zh: "专用模型", en: "Dedicated model" },
      "panel.providerIgnored": { zh: "角色 \"{name}\"：provider 仅在同时配置模型时生效（后端将忽略），已保存", en: "Role \"{name}\": provider takes effect only when a model is also set (ignored by the backend) — saved" },
      "panel.providerPlaceholder": { zh: "provider（留空=跟随主 agent）", en: "provider (empty = follow main agent)" },
      "panel.modelFallbackHint": { zh: "模型目录不可用（{err}），已回退手输。写入该角色委派块的 agentOptions；含冷恢复在内，子 agent 固定用该模型。provider 需与模型成对（如 deepseek-official）。", en: "Model catalog unavailable ({err}) — fell back to manual input. Written into the agentOptions of this role's delegation block; the child agent pins this model, cold restore included. provider must pair with a model (e.g. deepseek-official)." },
      "panel.unknownError": { zh: "未知错误", en: "unknown error" },
      "panel.modelSelectHint": { zh: "选项来自 DSH 已注册的模型路由；留空 = 跟随主 agent，主 agent 换模型时未固定的角色跟着变。", en: "Options come from the model routes registered in DSH; leave empty to follow the main agent — roles without a pinned model follow along when the main agent switches models." },
      "panel.bgModeLabel": { zh: "会话模式", en: "Session mode" },
      "panel.bgOneshot": { zh: "一次性（one-shot）", en: "One-shot" },
      "panel.bgContinuable": { zh: "可续（continuable）", en: "Continuable" },
      "panel.startModeLabel": { zh: "启动方式", en: "Start mode" },
      "panel.smFresh": { zh: "全新（fresh）", en: "Fresh" },
      "panel.smFork": { zh: "继承对话（fork）", en: "Inherit conversation (fork)" },
      "panel.forkStartHint": { zh: "继承对话的子代理以主 agent 已完成的对话轮次为初始内容启动（一次性快照，之后两边各自推进）；工具面仍以本角色配置为准。", en: "A forked child starts from the main agent's already-completed turns (a one-time snapshot; from then on both sides move on independently); the toolset still follows this role's own configuration." },
      "panel.roleAddTitle": { zh: "新建自定义 agent 角色", en: "New custom role" },
      "panel.roleAddToolNameLabel": { zh: "角色 toolName（主 agent 的委派调用名）", en: "Role toolName (the main agent's delegation call name)" },
      "panel.roleAddNamePlaceholder": { zh: "输入英文小写角色名，如 reviewer", en: "Enter a lowercase role name, e.g. reviewer" },
      "panel.dispNameLabel": { zh: "显示名（可选）", en: "Display name (optional)" },
      "panel.dispNamePlaceholder": { zh: "如 代码评审，留空 = 用 toolName", en: "e.g. Code review — leave empty to use the toolName" },
      "panel.roleAddHint": { zh: "角色名须为 2-32 位小写字母/数字/下划线/连字符，小写字母开头；内置名不可新建。显示名可选，不能换行，trim 后最多 60 字符，留空用 toolName 当标题。新角色工具面默认放开全部检测到的工具，可在卡片里再收窄。会话模式缺省一次性（one-shot），选「可续」后仍可在角色卡里改。启动方式缺省全新（fresh），选「继承对话」后仍可在角色卡里改。", en: "Role names are 2-32 chars of lowercase letters/digits/underscores/hyphens, starting with a letter; built-in names cannot be recreated. Display name is optional: no line breaks, at most 60 chars after trim; leave empty to use the toolName as the title. A new role's toolset opens up every detected tool by default — narrow it down in the role card later. Session mode defaults to one-shot and can still be changed in the role card after picking Continuable. Start mode defaults to fresh and can still be changed in the role card after picking Inherit conversation." },
      "panel.roleAddConfirm": { zh: "确认新建", en: "Create" },
      "panel.roleRenameTitle": { zh: "重命名自定义角色", en: "Rename custom role" },
      "panel.roleRenameLabel": { zh: "新 toolName（主 agent 的委派调用名）", en: "New toolName (the main agent's delegation call name)" },
      "panel.roleRenameHint": { zh: "2-32 位小写字母/数字/下划线/连字符，小写字母开头；不可改成内置名或已存在的名字。skills 里的引用自动迁移；改名后需重启 / 新会话生效。", en: "2-32 chars of lowercase letters/digits/underscores/hyphens, starting with a letter; cannot be a built-in or an existing name. References in skills are migrated automatically; takes effect after a restart / in new sessions." },
      "panel.roleRenameConfirm": { zh: "确认重命名", en: "Rename" },
      "panel.roleNameInvalid": { zh: "角色名须为 2-32 位小写字母/数字/下划线/连字符", en: "Role name must be 2-32 chars of lowercase letters/digits/underscores/hyphens" },
      "panel.roleNameBuiltin": { zh: "内置角色不可新建（\"{name}\"如已删除，请在下方「已删除的内置角色」区恢复）", en: "\"{name}\" is a built-in role and cannot be recreated (if deleted, restore it from the Removed built-in roles section below)" },
      "panel.roleExists": { zh: "角色 \"{name}\" 已存在", en: "Role \"{name}\" already exists" },
      "panel.dispNameNewline": { zh: "显示名不能包含换行（\\r / \\n）", en: "Display name cannot contain line breaks (\\r / \\n)" },
      "panel.dispNameTooLong": { zh: "显示名过长：trim 后最多 60 字符", en: "Display name is too long: at most 60 characters after trim" },
      "panel.roleAddedToast": { zh: "已新建角色 \"{name}\"，记得「保存并应用」", en: "Created role \"{name}\" — remember to Save & Apply" },
      "panel.roleRenameBuiltin": { zh: "不可改成内置角色名 \"{name}\"", en: "Cannot rename to the built-in role name \"{name}\"" },
      "panel.roleRenamedToast": { zh: "已重命名 \"{old}\" → \"{new}\"，记得「保存并应用」", en: "Renamed \"{old}\" → \"{new}\" — remember to Save & Apply" },
      "panel.delCustomRoleTitle": { zh: "删除自定义角色", en: "Delete custom role" },
      "panel.delCustomRoleBody": { zh: "删除自定义角色 \"{name}\"？", en: "Delete custom role \"{name}\"?" },
      "panel.delBuiltinRoleTitle": { zh: "删除内置角色", en: "Delete built-in role" },
      "panel.delBuiltinRoleBody": { zh: "删除内置角色 \"{name}\"？\n该角色的委派工具、工具面、persona 与主 agent 的委派指引将一并移除；\n可在下方「已删除的内置角色」区一键恢复。", en: "Delete built-in role \"{name}\"?\nIts delegation tool, toolset, persona and the main agent's delegation guidance are removed with it;\nyou can restore it anytime from the Removed built-in roles section below." },
      "panel.applyTitle": { zh: "保存并应用", en: "Save & Apply" },
      "panel.applyBodyWs": { zh: "确认应用当前配置？将为该工作区生成专属预设（orchestrator-<slug>）并保存到 dsh-paoding.config.yml 的 workspaces 段，全局 orchestrator 预设不受影响。", en: "Apply the current configuration? This generates a dedicated preset for this workspace (orchestrator-<slug>) and saves it to the workspaces section of dsh-paoding.config.yml — the global orchestrator preset is untouched." },
      "panel.applyBodyGlobal": { zh: "确认应用当前配置？将写入 preset 并覆盖 ~/.dsh/.agent-presets/orchestrator，且保存到 dsh-paoding.config.yml。", en: "Apply the current configuration? This writes the preset, overwriting ~/.dsh/.agent-presets/orchestrator, and saves it to dsh-paoding.config.yml." },
      "panel.applyConfirm": { zh: "确认应用", en: "Apply" },
      "panel.warnTail": { zh: "有 {n} 条检查提示，见下方。", en: "{n} check messages below." },
      "panel.appliedWs": { zh: "已生成预设 {id}：{summary}新建会话时在预设选择器选它。", en: "Generated preset {id}: {summary} Pick it in the preset selector when starting a new session." },
      "panel.appliedGlobal": { zh: "已安装：{summary}", en: "Installed: {summary}" },
      "panel.staleReapply": { zh: " ⚠️ patch 较新，重新应用后生效。", en: " ⚠️ The patch is newer — apply again to take effect." },
      "panel.staleRestart": { zh: " ⚠️ patch 较新，重启后生效。", en: " ⚠️ The patch is newer — restart to take effect." },
      "panel.effectiveRestart": { zh: " 重启 DSH 或新建会话后生效。", en: " Takes effect after restarting DSH or in a new session." },
      "panel.rescanned": { zh: "已重新检测：{n} 个 MCP / 插件工具 · {m} 个技能", en: "Rescan complete: {n} MCP/plugin tools · {m} skills" },
      "panel.tplAppliedToast": { zh: "已切换到「{label}」，保存并应用后生效", en: "Switched to \"{label}\" — takes effect after Save & Apply" },

      // role.*：角色卡通用词 + 82 片段委派行标题缺省映射（值 = 字典 key）
      "role.mainAgent": { zh: "主 agent", en: "Main agent" },
      "role.badgeFixed": { zh: "固定", en: "Fixed" },
      "role.badgeCustom": { zh: "自定义", en: "Custom" },
      "role.badgeBuiltin": { zh: "内置", en: "Built-in" },
      "role.toolCount": { zh: "{n} 个工具", en: "{n} tools" },
      "role.renameTitle": { zh: "重命名角色 \"{name}\"（toolName = 委派调用名）", en: "Rename role \"{name}\" (toolName = delegation call name)" },
      "role.delCustomTitle": { zh: "删除角色 \"{name}\"", en: "Delete role \"{name}\"" },
      "role.delBuiltinTitle": { zh: "删除内置角色 \"{name}\"（可在下方恢复）", en: "Delete built-in role \"{name}\" (restorable below)" },
      "role.restoreTitle": { zh: "恢复内置角色 \"{name}\"（工具面重建为内置默认 allow）", en: "Restore built-in role \"{name}\" (toolset rebuilt from the built-in default allow)" },
      "role.restorePill": { zh: "恢复 {name}", en: "Restore {name}" },
      "role.title.search_external": { zh: "外部检索", en: "External research" },
      "role.title.design": { zh: "设计", en: "Design" },
      "role.title.implement": { zh: "实现", en: "Implement" },
      "role.title.search_internal_deep": { zh: "深搜", en: "Deep search" },

      // warn.*：70 片段体检告警卡。heading 是卡片标题；title.<code> 是按服务端
      // code 给的行级本地化标题（进悬浮提示）。取舍：服务端 message 原文作正文
      // 展示，本轮不译（服务端仅中文）——只把「这是什么类别的检查」本地化。
      "warn.heading.apply": { zh: "应用检查提示", en: "Apply checks" },
      "warn.heading.preview": { zh: "预览检查提示", en: "Preview checks" },
      "warn.itemTitle": { zh: "检查项：{code}", en: "Check: {code}" },
      "warn.title.unmounted_tool": { zh: "已配置但未挂载的工具", en: "Configured but unmounted tool" },
      "warn.title.zero_tool_role": { zh: "零工具角色", en: "Role with no tools" },
      "warn.title.unknown_model": { zh: "未知的专用模型", en: "Unknown dedicated model" },
      "warn.title.preset_drift": { zh: "预设与配置漂移", en: "Preset drift" },
      "warn.title.generation": { zh: "生成期告警", en: "Generation warning" },
      "warn.title.generation_error": { zh: "生成预演失败", en: "Generation dry-run failed" },

      // nav.*：80 侧栏入口 + 86 页头壳（庖丁为品牌名，英文文档沿用 Paoding Config 译名）
      "nav.entryTitle": { zh: "庖丁配置", en: "Paoding Config" },
      "nav.openToWs": { zh: "打开庖丁配置并切到该工作区", en: "Open Paoding Config for this workspace" },
      "nav.closeAria": { zh: "关闭庖丁配置", en: "Close Paoding Config" },
      "nav.closeTip": { zh: "关闭（Esc）", en: "Close (Esc)" },

      // menu.*：86 页头「更多」菜单 / 导入导出 / 升级流程（服务端 r.message 原文
      // 优先展示，本地化串只作缺省兜底——同 warn 的取舍）。
      "menu.subtitle": { zh: "为主 agent 与子 agent 编排工具、技能与角色，预览并应用生成的 agent.cordis.yml。", en: "Orchestrate tools, skills and roles for the main agent and its sub-agents; preview and apply the generated agent.cordis.yml." },
      "menu.moreBtn": { zh: "更多", en: "More" },
      "menu.moreBtnTip": { zh: "配置文件导出 / 导入", en: "Export / import the config file" },
      "menu.menuLabel": { zh: "配置文件操作", en: "Config file actions" },
      "menu.exportItem": { zh: "导出配置", en: "Export config" },
      "menu.exporting": { zh: "导出中…", en: "Exporting…" },
      "menu.exported": { zh: "已导出配置文件 {name}", en: "Exported config file {name}" },
      "menu.exportFail": { zh: "导出失败：{msg}", en: "Export failed: {msg}" },
      "menu.importItem": { zh: "导入配置", en: "Import config" },
      "menu.importing": { zh: "导入中…", en: "Importing…" },
      "menu.importTitle": { zh: "导入配置", en: "Import config" },
      "menu.importBody": { zh: "将用文件「{name}」整体覆盖当前配置文件：\n角色、工具、技能分配与 workspaces（工作区）段全部以文件内容为准，现有配置被替换，此操作不可撤销。", en: "The file \"{name}\" will overwrite the whole config file:\nroles, tools, skill assignment and the workspaces section are all replaced with the file's content. The existing configuration is replaced — this cannot be undone." },
      "menu.importConfirm": { zh: "覆盖导入", en: "Overwrite & import" },
      "menu.imported": { zh: "配置已导入并覆盖原文件，视图已按新配置刷新", en: "Config imported and the original file overwritten — the view has been refreshed" },
      "menu.importFail": { zh: "导入失败：{msg}", en: "Import failed: {msg}" },
      "menu.readFail": { zh: "文件读取失败", en: "Failed to read file" },
      "menu.readFailPrefix": { zh: "读取文件失败：{msg}", en: "Failed to read the file: {msg}" },
      "menu.wsNotRegistered": { zh: "宿主工作区「{title}」还没在庖丁注册，已打开全局默认", en: "Host workspace \"{title}\" is not registered in Paoding yet — opened the global default" },
      "menu.listFail": { zh: "工作区列表拉取失败，已打开全局默认", en: "Failed to fetch the workspace list — opened the global default" },
      "menu.upgradeTitle": { zh: "升级 dsh-paoding", en: "Upgrade dsh-paoding" },
      "menu.upgradeConfirm": { zh: "升级", en: "Upgrade" },
      "menu.upgradeDevBody": { zh: "当前为开发 link 直连形态：无法就地升级，请手动执行 dsh plugin add dsh-paoding@latest 切换到 registry 版本。仍要继续尝试吗？", en: "This is a dev link checkout: it cannot be upgraded in place. Run dsh plugin add dsh-paoding@latest manually to switch to the registry version. Continue anyway?" },
      "menu.upgradeBody": { zh: "确定升级到 {v}？升级将通过插件通道原地换版本，完成后需重启 DSH 生效。", en: "Upgrade to {v}? The upgrade swaps the version in place through the plugin channel; restart DSH afterwards to apply it." },
      "menu.upgradeBodyHot": { zh: "确定升级到 {v}？升级将通过插件通道原地换版本，完成后刷新页面即生效（编排预设自动按新版重生成）。", en: "Upgrade to {v}? The upgrade swaps the version in place through the plugin channel; refresh the page afterwards — orchestration presets regenerate automatically." },
      "menu.upToDate": { zh: "已是最新版本", en: "Already up to date" },
      "menu.upgraded": { zh: "✅ 已升级到 {v}，重启 DSH 后新版本生效（preset 会自动按新版重生成）", en: "✅ Upgraded to {v} — restart DSH to apply the new version (the preset regenerates itself against it)" },
      "menu.upgradedHot": { zh: "✅ 已升级到 {v}，刷新页面即生效（preset 会自动按新版重生成）", en: "✅ Upgraded to {v} — refresh the page to apply (the preset regenerates itself against it)" },
      "menu.errTail": { zh: "：{tail}", en: ": {tail}" },
      "menu.langTip": { zh: "切换界面语言", en: "Switch UI language" },

      // ── 工具筛选（角色卡工具网格超过 8 项时，网格上方的行内筛选框）─────────
      "panel.toolFilter": { zh: "筛选工具…", en: "Filter tools…" },

      // ── 工具面瘦身统计（state.slim / preview.slim 的一行统计）──────────────
      "slim.line": { zh: "主 agent 工具面 {main}/{total} 个（瘦身 {pct}%）", en: "Main agent tool surface: {main}/{total} tools (down {pct}%)" },
      // 预览弹窗里的第二口径小注：preview.slim 按本次提交（未保存）配置计算，
      // 与页头按已保存配置的一行区分开。
      "slim.pendingNote": { zh: "（按当前未保存配置）", en: " (per the current unsaved config)" },

      // ── 委派效果卡（GET stats 的只读紧凑表，页头瘦身行之下）───────────────
      "del.cardTitle": { zh: "委派效果", en: "Delegation stats" },
      "del.colRole": { zh: "角色", en: "Role" },
      "del.colCalls": { zh: "调用", en: "Calls" },
      "del.colAvg": { zh: "均耗时", en: "Avg" },
      "del.colFailed": { zh: "失败", en: "Failed" },
      "del.colLastUsed": { zh: "最近使用", en: "Last used" },
      "del.totalRoles": { zh: "共 {n} 个角色", en: "{n} roles in total" },
      "del.empty": { zh: "暂无委派记录", en: "No delegation records yet" },

      // ── 预览「本次变更」区块（preview.diff 结构化差分的渲染文案）───────────
      // 服务端 diff 是纯结构零文案（tools/lib/config.mjs diffAssignments），
      // 全部措辞在这里收口；mainAgent.modelChanged 恒 false，不设键不渲染。
      "diff.heading": { zh: "本次变更", en: "Changes this time" },
      "diff.unchanged": { zh: "与上次保存的配置一致", en: "Identical to the last saved config." },
      "diff.mainToolsAdded": { zh: "主 agent 新带 {n} 个工具：{list}", en: "Main agent now carries {n} more tools: {list}" },
      "diff.mainToolsRemoved": { zh: "主 agent 移除 {n} 个工具：{list}", en: "Main agent drops {n} tools: {list}" },
      "diff.mainPersona": { zh: "主 agent 人设追加有变化", en: "Main agent persona addendum changed" },
      "diff.mainSkills": { zh: "主 agent 技能分配有变化", en: "Main agent skill assignment changed" },
      "diff.roleAdded": { zh: "新增角色「{name}」", en: "Role \"{name}\" added" },
      "diff.roleRemoved": { zh: "移除角色「{name}」", en: "Role \"{name}\" removed" },
      "diff.roleChanged": { zh: "角色「{name}」变更：{details}", en: "Role \"{name}\" changed: {details}" },
      "diff.roleTools": { zh: "工具 +{added} -{removed}", en: "tools +{added} -{removed}" },
      "diff.rolePersona": { zh: "persona 变化", en: "persona changed" },
      "diff.roleModel": { zh: "专用模型变化", en: "dedicated model changed" },
      "diff.roleStartMode": { zh: "启动方式变化", en: "start mode changed" },
      "diff.roleBgMode": { zh: "后台续跑变化", en: "background session mode changed" },
      "diff.rolesRemoveAdded": { zh: "移除内置角色 {n} 个：{list}", en: "Removed {n} built-in roles: {list}" },
      "diff.rolesRemoveRemoved": { zh: "恢复内置角色 {n} 个：{list}", en: "Restored {n} built-in roles: {list}" },
      // main_agent_extra 通道明细（主 agent 合并视图之外的通道拆分，一并列出）
      "diff.mainExtraAdded": { zh: "主 agent 附加工具新增 {n} 个：{list}", en: "Main agent extra tools added ({n}): {list}" },
      "diff.mainExtraRemoved": { zh: "主 agent 附加工具移除 {n} 个：{list}", en: "Main agent extra tools removed ({n}): {list}" },

      // ── 恢复备份（页头「更多」菜单 → 备份列表弹层 → 二次确认 → POST restore）
      "menu.restoreItem": { zh: "恢复备份…", en: "Restore backup…" },
      "menu.backupTitle": { zh: "恢复备份", en: "Restore backup" },
      "menu.backupLoading": { zh: "加载备份列表…", en: "Loading backups…" },
      "menu.backupEmpty": { zh: "暂无备份", en: "No backups yet" },
      "menu.backupBadResponse": { zh: "备份列表响应格式异常", en: "Unexpected backup list response" },
      "menu.backupListFail": { zh: "备份列表拉取失败：{msg}", en: "Failed to load backups: {msg}" },
      "menu.restoreTitle": { zh: "确认恢复此备份", en: "Restore this backup" },
      "menu.restoreBody": { zh: "将用备份「{name}」覆盖当前配置，覆盖前当前配置会先自动备份。", en: "Backup \"{name}\" will overwrite the current config; the current config is backed up automatically first." },
      "menu.restoreConfirm": { zh: "覆盖恢复", en: "Overwrite & restore" },
      "menu.restored": { zh: "已恢复备份 {name}，恢复前的配置已自动存为 bak-1", en: "Restored backup {name} — the previous config was saved as bak-1 automatically" },
      "menu.restoreFail": { zh: "恢复失败：{msg}", en: "Restore failed: {msg}" },
    };
    // ── 样式注入（幂等）─────────────────────────────────────────────────
    //
    // 样式正文在 lib/base.css，由 Node 半经 GET /api/paoding/client.css 下发
    //（同源请求，落在 /api/paoding 前缀路由的浏览器信任围栏内）；此处只在
    // 首次物化时注入一个 <link>。幂等：同名 data 属性的 link 已存在即跳过；
    // API 不可达时面板降级为无样式（不阻塞功能）。

    function mountCss() {
      if (document.querySelector('link[data-plugin-css="paoding-config-ui/base"]')) return;
      var link = document.createElement("link");
      link.setAttribute("rel", "stylesheet");
      link.setAttribute("data-plugin", "paoding-config-ui");
      link.setAttribute("data-plugin-css", "paoding-config-ui/base");
      link.setAttribute("href", "/api/paoding/client.css");
      if (document.head) {
        document.head.appendChild(link);
      } else if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mountCss);
      } else {
        document.documentElement.appendChild(link);
      }
    }
    if (typeof document !== "undefined") mountCss();

    // ── 渲染小助手（零构建，无 JSX）──────────────────────────────────────

    // 图标兜底：任一图标缺失时降级为 null，绝不崩溃面板。
    function ic(Icon, size) {
      return Icon ? h(Icon, { size: size }) : null;
    }

    // 降级 / 报错提示行。role 可选：缺省时沿用旧口径（error 行 alert 强提醒，
    // warn 行不带 role 走低调展示）；调用方显式传 "status" 则礼貌播报一次，
    // 供「拉取失败但仍可用」这类降级提示用（不抢屏，读屏不打断）。
    function statusRow(cls, iconNode, text, role) {
      return h("div", { className: cls, role: role || (cls === "omd-statusError" ? "alert" : undefined) },
        iconNode ? h("span", { className: "omd-statusIcon" }, iconNode) : null,
        h("span", { className: "omd-statusText" }, text));
    }

    // projBadge（可选）：项目级技能角标文案（如「项目」），仅技能项在
    // 工作区视角下、该技能来自工作区项目根时传入；其余网格不传不渲染。
    // data-pd-tool：工具显示名打点——供 applyToolFilter 做筛选匹配（q 透传
    // getAttribute，React 不感知），与 title 悬浮提示内容一致。
    function toolItem(tool, tag, checked, disabled, onChange, key, projBadge) {
      return h("label", { key: key, className: "omd-toolItem", title: tool, "data-pd-tool": tool },
        h("input", {
          type: "checkbox",
          className: "omd-check",
          checked: !!checked,
          disabled: !!disabled,
          readOnly: !!disabled,
          onChange: onChange,
        }),
        h("span", { className: "omd-toolName" }, tool),
        tag ? h("span", { className: "omd-toolTag" + (tag === "mcp" || tag === "plugin" ? " omd-toolTagHost" : "") }, tag) : null,
        projBadge ? h("span", { className: "omd-skillProj" }, projBadge) : null);
    }

    // ── 工具网格筛选（超过 8 项的分组在网格上方给一个行内筛选框）────────────
    // 触发阈值：分组超过 8 项才出现筛选框（短网格不必多一个输入框）。
    var TOOL_FILTER_MIN = 8;

    // 工具网格（可选筛选框 + 网格本体）：items 超过阈值时在外面包一层
    // .omd-toolFilterWrap（输入框 + 网格），否则原样返回网格节点。不引入任何
    // 状态管道——筛选 oninput 直接改 DOM 显隐（见 applyToolFilter），整卡重
    // 渲染会吃掉输入框焦点，这个交互必须绕开 React。
    // renderItem：单工具 → 节点（toolItem 调用点原样搬进来）；emptyNode：
    // 空列表占位（原「暂无 …」节点），空组照旧渲染、无筛选框。空占位作直接
    // 子节点传入（不进数组），与改造前调用点的 children 形状一致，不触发
    // React 的数组 key 警告。
    function toolGridOf(tools, renderItem, emptyNode) {
      var grid;
      if (tools.length) {
        grid = h.apply(null, ["div", { className: "omd-toolGrid" }].concat(tools.map(renderItem)));
      } else {
        grid = h("div", { className: "omd-toolGrid" }, emptyNode || null);
      }
      if (tools.length <= TOOL_FILTER_MIN) return grid;
      return h("div", { className: "omd-toolFilterWrap" },
        h("input", {
          type: "text",
          className: "omd-toolFilter",
          placeholder: t("panel.toolFilter"),
          spellCheck: false,
          onInput: function (e) { applyToolFilter(e.target); },
        }),
        grid);
    }

    // 筛选 oninput：从输入框向上取包裹层，按 data-pd-tool（工具显示名）做
    // 大小写不敏感子串匹配，逐项切 display——纯 DOM 操作不触发重渲染，输入框
    // 焦点不丢；清空输入恢复全部显示。
    function applyToolFilter(input) {
      var wrap = input && input.parentNode;
      if (!wrap || !wrap.querySelectorAll) return;
      var q = String(input.value || "").toLowerCase();
      var items = wrap.querySelectorAll("label[data-pd-tool]");
      for (var i = 0; i < items.length; i++) {
        var name = items[i].getAttribute("data-pd-tool") || "";
        items[i].style.display = q !== "" && name.toLowerCase().indexOf(q) === -1 ? "none" : "";
      }
    }

    // ── 工具面瘦身统计（state.slim / preview.slim → 一行文案）───────────────
    // 瘦身百分比：pct = total>0 ? round((1-main/total)*100) : 0（total=0 防除零）。
    function slimPctOf(slim) {
      var total = slim && typeof slim.total === "number" ? slim.total : 0;
      var main = slim && typeof slim.main === "number" ? slim.main : 0;
      return total > 0 ? Math.round((1 - main / total) * 100) : 0;
    }

    // 一行统计文案（页头与预览弹窗共用同一拼法，防漂移）。
    function slimLineText(slim) {
      return t("slim.line", {
        main: slim && typeof slim.main === "number" ? slim.main : 0,
        total: slim && typeof slim.total === "number" ? slim.total : 0,
        pct: slimPctOf(slim),
      });
    }

    // ── 委派效果卡（GET stats → 页头瘦身行之下的只读紧凑表）────────────────
    // 数据由 86 PageShell 首屏渲染完后懒加载（不阻塞开面板）；服务缺失 / 拉取
    // 失败 / 响应异常时整卡不渲染（delegationCardOf 返回 null），不打扰。

    // 均耗时人话格式：1 分内「1.2s」（两位数以上取整秒），1 小时内「3m05s」，
    // 更长「2h07m」。非正数一律 0s。
    function delegDurationText(ms) {
      if (!(ms > 0)) return "0s";
      var s = ms / 1000;
      if (s < 60) return (s >= 10 ? String(Math.round(s)) : s.toFixed(1)) + "s";
      var m = Math.floor(s / 60);
      if (m < 60) return m + "m" + String(Math.round(s % 60)).padStart(2, "0") + "s";
      return Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0") + "m";
    }

    // 最近使用时间：当年「MM-DD HH:mm」，跨年「YYYY-MM-DD」——纯数字中性格式，
    // 不进字典也不吃 i18n。
    function delegWhenText(ms) {
      var d = new Date(ms);
      if (isNaN(d.getTime())) return "—";
      var two = function (n) { return String(n).padStart(2, "0"); };
      var now = new Date();
      if (d.getFullYear() !== now.getFullYear()) {
        return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
      }
      return two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes());
    }

    // 卡片渲染：stats 缺失 / ok!==true / roles 非数组 → null（整卡零占位）。
    // delegatedSessions=0 渲染标题 + 一行空文案；有数据渲染紧凑表（表头 +
    // 最多 8 行，超出给「共 N 个角色」尾行），失败数 >0 标红提醒。
    function delegationCardOf(stats) {
      if (!stats || stats.ok !== true || !Array.isArray(stats.roles)) return null;
      var head = h("div", { className: "pd-delegTitle" }, t("del.cardTitle"));
      if (!stats.delegatedSessions) {
        return h("div", { className: "pd-delegCard" }, head,
          h("div", { className: "pd-delegEmpty" }, t("del.empty")));
      }
      var cols = [
        ["pd-delegRole", t("del.colRole")],
        ["pd-delegNum", t("del.colCalls")],
        ["pd-delegNum", t("del.colAvg")],
        ["pd-delegNum", t("del.colFailed")],
        ["pd-delegWhen", t("del.colLastUsed")],
      ];
      var headerRow = h("div", { className: "pd-delegRow pd-delegHeaderRow" }, cols.map(function (c, i) {
        return h("span", { key: "h" + i, className: c[0] }, c[1]);
      }));
      var shown = stats.roles.slice(0, 8);
      var rows = shown.map(function (r) {
        return h("div", { className: "pd-delegRow", key: r.role },
          h("span", { className: "pd-delegRole", title: r.role }, r.role),
          h("span", { className: "pd-delegNum" }, String(r.calls)),
          h("span", { className: "pd-delegNum" }, delegDurationText(r.avgMs)),
          h("span", { className: "pd-delegNum" + (r.failures > 0 ? " pd-delegFail" : "") }, String(r.failures)),
          h("span", { className: "pd-delegWhen" }, delegWhenText(r.lastUsedAt)));
      });
      var tail = stats.roles.length > shown.length
        ? h("div", { className: "pd-delegMore" }, t("del.totalRoles", { n: stats.roles.length }))
        : null;
      return h("div", { className: "pd-delegCard" }, head,
        h.apply(null, ["div", { className: "pd-delegTable" }, headerRow].concat(rows)), tail);
    }

    var DEFAULT_ROLES = ["search_external", "design", "implement"];
    // 内置角色默认 persona 首行「身份主语」（仅用于 UI 占位与提示文案；实际生效值
    // 由后端 SRC 模板 persona 首行决定）。「显示名」= 替换该主语（其余不动）。
    var ROLE_DEFAULT_SUBJECT = {
      search_external: "external-research",
      design: "design",
      implement: "implementation",
    };

    // 角色可选 string 字段透传归一（name / model / provider 三处共用，供
    // buildAssignments 使用）：string 且非 '' 才保留，null / 缺省 / '' 一律
    // null（= 未配置）。字段拼写与后端契约一致。
    function roleStringRef(baseRoles, n, key) {
      var r = (baseRoles || {})[n];
      return r && typeof r[key] === "string" && r[key] !== "" ? r[key] : null;
    }

    // 内置角色显示名透传归一（= roleStringRef 之于 name）：null = 默认身份。
    function roleNameOf(baseRoles, n) {
      return roleStringRef(baseRoles, n, "name");
    }

    // ── 会话模式（roles.<toolName>.background_mode）─────────────────────────
    // 定稿键名 'one-shot' | 'continuable'，缺省 one-shot。与后端序列化形状
    // 一致：config 层 normalizeBackgroundMode 恒收成这两个字面量（缺省/非法
    // 回落 'one-shot'，落盘恒写出），assignments 与回填照搬同款取值。
    var ROLE_BG_CONTINUABLE = "continuable";
    var ROLE_BG_ONESHOT = "one-shot";

    // 角色条目 background_mode 透传归一：恰好等于 'continuable' 才认，其余
    //（缺省 / null / 手编误值）一律 'one-shot'（与 normalizeBackgroundMode 同口径）。
    function roleBgModeOf(baseRoles, n) {
      var r = (baseRoles || {})[n];
      return r && r.background_mode === ROLE_BG_CONTINUABLE ? ROLE_BG_CONTINUABLE : ROLE_BG_ONESHOT;
    }

    // 一组角色里是否有人配成可续（供面板顶警告横幅判定，与 roleBgModeOf 同口径）。
    function hasContinuableRole(roles) {
      var keys = Object.keys(roles || {});
      for (var i = 0; i < keys.length; i++) {
        if (roles[keys[i]] && roles[keys[i]].background_mode === ROLE_BG_CONTINUABLE) return true;
      }
      return false;
    }

    // 「可续」选中时的行内成本提示（定稿文案）。i18n：常量会在模块加载期固化
    // 成单语字符串，切语言后就错了——包装成函数，渲染期才经 t() 取当前语言。
    function roleBgContinuableHint() { return t("dom.bgContinuableHint"); }

    // persistence 后端缺失时的警告（定稿文案；只警示不拦截，预览 / 应用照常）。
    function roleBgPersistenceWarn() { return t("dom.bgPersistenceWarn"); }

    // ── 启动方式（roles.<toolName>.start_mode）─────────────────────────────
    // 定稿键名 'fresh' | 'fork'，缺省 fresh。与后端序列化形状一致：config 层
    // normalizeStartMode 恒收成这两个字面量（缺省/非法回落 'fresh'，落盘恒写出），
    // assignments 与回填照搬同款取值。注意与 roles.<toolName>.provider（LLM 路由）
    // 无关 —— 本键只决定委派块的块级 provider 行（spawn / fork）。
    var ROLE_SM_FORK = "fork";
    var ROLE_SM_FRESH = "fresh";

    // 角色条目 start_mode 透传归一：恰好等于 'fork' 才认，其余（缺省 / null /
    // 手编误值）一律 'fresh'（与 normalizeStartMode 同口径）。
    function roleStartModeOf(baseRoles, n) {
      var r = (baseRoles || {})[n];
      return r && r.start_mode === ROLE_SM_FORK ? ROLE_SM_FORK : ROLE_SM_FRESH;
    }

    // 「继承对话（fork）」选中且该角色配了专用模型时的行内提示（定稿文案）：
    // fork 子代理继承主 agent 的提供方与模型，专用模型不生效。同为渲染期取文案。
    function roleForkModelHint() { return t("dom.forkModelHint"); }


    // mcp__ 前缀判定（归「MCP 工具」组的依据，供角色工具网格分组与
    // customCoreToolsOf 使用；只做展示分组，不影响识别/分配）。非 mcp__ 名字
    // 再按是否在检测清单 inventory 里分进「基础工具」/「插件工具」两组。
    function hostTool(name) {
      return name.indexOf("mcp__") === 0;
    }

    // 自定义角色「基础工具」核心候选：自定义角色没有 SRC 基础面（blocks 里没
    // 有它的块），从主 agent 核心 allow（state.restrictBase）派生——去掉四个
    // 委派名（DEFAULT_ROLES 三内置角色 + 静态的 search_internal_deep，委派
    // 工具不走工具网格）与 mcp__ 工具（归「MCP 工具」组），剩下的就是可通过
    // UI 勾给自定义角色的核心工具面；检测清单里的插件工具（mnemon_* 等）不
    // 在此列，由「插件工具」组单独提供。
    function customCoreToolsOf(data) {
      var delegations = DEFAULT_ROLES.concat(DELEGATE_STATIC_TOOLS);
      return ((data && data.restrictBase) || []).filter(function (t) {
        return delegations.indexOf(t) === -1 && !hostTool(t);
      });
    }

    // 运行时识别不可用时的回退提示：持续状态（不是一次性事件），只在
    // runtimeOk === false 且带原因时渲染一行小字，贴在标签行上方；字段缺失或
    // 正常时返回 null 零占位。错误原文可能很长，只留前 200 字符（排障够用，
    // 不撑爆版面），仅超长才补省略号。
    function runtimeNoteOf(d) {
      if (!d || d.runtimeOk !== false || !d.runtimeError) return null;
      var err = String(d.runtimeError);
      if (err.length > 200) err = err.slice(0, 200) + "…";
      return h("div", { className: "omd-runtimeNote" },
        t("dom.runtimeFallback", { err: err }));
    }

    // 版本号展示归一：tag 缺前缀 v 时补上（服务端原样透传 GitHub tag_name，
    // 通常自带 v，本地版本号则来自 package.json 不带 v，显示口径统一为 vX.Y.Z）。
    function versionTagOf(tag) {
      var s = String(tag || "");
      return /^v/i.test(s) ? s : "v" + s;
    }

    // 版本提示（渲染在页头标题旁，由 PageShell 持有）：常态版本号不进正文；
    // updateAvailable 时这里渲染醒目提示卡：releaseUrl 新标签页打开 release 页、
    // 「升级」按钮走 onUpgrade（一键插件通道自升级，通道按 profile 由服务端
    // 分流），并保留当前版本号。
    // latest 为 null 一律不显示新版部分；检测失败（error 非空）改渲染弱化失败行
    // （⚠ 版本检测失败 · 重试，完整原因在 title 悬浮提示），不再整行静默。
    // opts（可省）：busy/busyOp 复用面板级互斥（任何操作进行中都禁用升级，
    // 升级进行中也反过来禁用其他按钮），onUpgrade 为点击回调。
    // ── 服务端 API 助手（PageShell 与 ConfigPanel 共用）──────────────────────
    // GET（无 body）/ POST（有 body）对 /api/paoding/*，非 2xx 抛 Error。
    // 服务端失败响应可能带排障附件（如 upgrade 的子进程输出尾部），Error 只有
    // message 装不下它——挂到 error.output 上，调用方 catch 侧自行取舍（见
    // PageShell doUpgrade 的尾部并入）。
    // 总超时（models 等慢路由同限）：请求挂死时按超时报错，不让按钮永久转圈。
    var PAODING_API_TIMEOUT_MS = 60000;

    function paodingApi(path, body) {
      var opts = body === undefined ? {} : {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      };
      // AbortController 超时；老环境没有该构造器就降级为无超时（功能不变）。
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = null;
      if (ctrl) {
        opts.signal = ctrl.signal;
        timer = setTimeout(function () { ctrl.abort(); }, PAODING_API_TIMEOUT_MS);
      }
      return fetch("/api/paoding/" + path, opts).then(function (r) {
        // 先取全文再 JSON.parse：非 JSON 响应（代理错误页 / 空体）不再抛
        // SyntaxError，回落 HTTP <status> 的可读错误。
        return r.text().then(function (raw) {
          var d = null;
          try { d = raw ? JSON.parse(raw) : null; } catch (err) { d = null; }
          if (!r.ok) {
            var err = new Error((d && d.error) || ("HTTP " + r.status));
            if (d && typeof d.output === "string" && d.output) err.output = d.output;
            // 结构化体检结果（preview/apply 的 422 会把 warnings 一并带回，如
            // 零工具角色的可读说明）：message 装不下多条，挂 error.warnings，
            // 调用方 catch 侧渲染成检查提示卡（见 ConfigPanel 的 warnState）。
            if (d && Array.isArray(d.warnings)) err.warnings = d.warnings;
            throw err;
          }
          if (!d) throw new Error(t("api.notJson", { status: r.status }));
          return d;
        });
      }).catch(function (err) {
        if (ctrl && err && err.name === "AbortError") throw new Error(t("api.timeout", { s: PAODING_API_TIMEOUT_MS / 1000 }));
        throw err;
      }).finally(function () {
        if (timer !== null) clearTimeout(timer);
      });
    }

    // ── Toast 反馈控制器（模块级单例，PageShell 的 ToastHost 订阅渲染）──────
    // 三档：ok（成功，4s 自动消失）/ warn（校验提示，6s）/ err（错误，粘性——
    // 不自动消失，手动 × 关；错误文本可能很长（子进程输出尾部等），限高滚动。
    // 栈上限 4 条，超出丢最旧。id 自增；定时器只挂自动消失档。
    function createToastCtrl() {
      var seq = 0;
      var items = [];
      var listeners = [];
      function notify() { listeners.slice().forEach(function (fn) { fn(); }); }
      function dismiss(id) {
        items = items.filter(function (it) { return it.id !== id; });
        notify();
      }
      function push(kind, text) {
        var it = { id: ++seq, kind: kind, text: String(text || "") };
        items = items.concat([it]);
        if (items.length > 4) items = items.slice(items.length - 4);
        if (kind !== "err") {
          it.timer = setTimeout(function () { dismiss(it.id); }, kind === "warn" ? 6000 : 4000);
        }
        notify();
        return it.id;
      }
      return {
        ok: function (t) { return push("ok", t); },
        warn: function (t) { return push("warn", t); },
        err: function (t) { return push("err", t); },
        dismiss: dismiss,
        subscribe: function (fn) {
          listeners.push(fn);
          return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
        },
        snapshot: function () { return items.slice(); },
      };
    }
    var toast = createToastCtrl();

    // 页头版本更新卡：常态版本号常驻标题旁（pd-versionTag），检测到新版本时
    // 在标题右侧并排一张紧凑警示卡（🆙 新版本链接 + 升级按钮）。由 PageShell
    // 渲染并持有升级动作，面板正文不再重复版本信息；当前版本号就在旁边的
    // pd-versionTag 上，卡内不再赘述「（当前 vX）」。note / error 为升级
    // 反馈行（成功提示 / 失败原因，含子进程输出尾部），也收在卡内。
    // 检测失败（v.error 非空且无新版信息）不再全静默：弱化小字「版本检测
    // 失败 · 重试」——否则「没新版」与「没测出来」无从区分（真实事故：用户
    // 端 0.3.2 对 0.3.5 迟迟看不到升级卡，只能靠作者远程猜）。检测成功且确
    // 无新版仍静默（常态不打扰）。完整失败原因（三路源各自错误 + 代理提示）
    // 收在 title 悬浮提示里，不占版面。
    function versionRowOf(v, opts) {
      if (!v || typeof v.current !== "string" || !v.current) return null;
      if (!(v.updateAvailable && v.latest)) {
        if (typeof v.error !== "string" || !v.error) return null;
        var retryBusy = !!(opts && opts.retryBusy);
        return h("span", { className: "omd-versionRow omd-versionFail", title: v.error },
          h("span", { className: "omd-versionIcon" }, "⚠"),
          h("span", { className: "omd-versionText" }, t("ver.checkFailed")),
          typeof (opts && opts.onRetry) === "function"
            ? h("button", {
                type: "button",
                className: "omd-retryBtn",
                disabled: retryBusy,
                onClick: opts.onRetry,
              }, retryBusy ? t("ver.checking") : t("ver.retry"))
            : null);
      }
      var busy = !!opts && !!opts.busy;
      var note = (opts && opts.note) || "";
      var error = (opts && opts.error) || "";
      return h("div", { className: "omd-versionRow omd-versionNew" },
        h("span", { className: "omd-versionIcon" }, "🆙"),
        h("span", { className: "omd-versionText" },
          t("ver.newAvailable", { v: versionTagOf(v.latest) }),
          // 只信 https://github.com/ 的 release 链接；其余取值一律不渲染 <a>。
          v.releaseUrl && /^https:\/\/github\.com\//.test(v.releaseUrl)
            ? h("a", {
                className: "omd-versionLink",
                href: v.releaseUrl,
                target: "_blank",
                rel: "noreferrer",
              }, t("ver.viewUpdate"))
            : null),
        typeof (opts && opts.onUpgrade) === "function"
          ? h("button", {
              type: "button",
              className: "omd-upgradeBtn",
              disabled: busy,
              onClick: opts.onUpgrade,
            }, busy ? t("ver.upgrading") : t("ver.upgrade"))
          : null,
        busy ? h("span", { className: "omd-upgradeHint" }, t("ver.downloadHint")) : null,
        error
          ? h("span", { className: "omd-versionNote omd-versionNoteErr" }, error)
          : (note ? h("span", { className: "omd-versionNote" }, note) : null));
    }

    // 反馈弹窗宿主：fixed 悬浮在操作坞上方，水平居中；host 本身 pointer-events:
    // none，只有 toast 本体接事件（不挡下方按钮）。ok/warn 自动消失，err 带 ×
    // 手动关。aria-live 播报；err 单条 role=alert 更醒目。
    function ToastHost() {
      var _t = useState(function () { return toast.snapshot(); }), items = _t[0], setItems = _t[1];
      useEffect(function () {
        return toast.subscribe(function () { setItems(toast.snapshot()); });
      }, []);
      if (!items.length) return null;
      return h("div", { className: "pd-toastHost", "aria-live": "polite" },
        items.map(function (it) {
          return h("div", {
              key: it.id,
              className: "pd-toast pd-toast" + it.kind.charAt(0).toUpperCase() + it.kind.slice(1),
              role: it.kind === "err" ? "alert" : "status",
            },
            h("span", { className: "pd-toastIcon", "aria-hidden": "true" },
              it.kind === "err" ? "⛔" : it.kind === "warn" ? "⚠️" : "✅"),
            h("div", { className: "pd-toastText" }, it.text),
            h("button", {
              type: "button",
              className: "pd-toastClose",
              "aria-label": t("common.closeToast"),
              onClick: function () { toast.dismiss(it.id); },
            }, h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×")));
        }));
    }

    // ── 角色专用模型下拉（目录来自 GET /api/paoding/models，Node 半经
    //    ctx.llm 服务（listProviders / listModels）取已注册的模型路由）──────

    // 选项 value 编码：JSON.stringify([provider, model])。provider 路由与模型
    // id 都可能含任意字符（/ : . 等），裸拼接有歧义；JSON 数组编码可逆且无
    // 冲突，null（= 未配一侧）也能原样往返。
    function encodeModelOption(provider, model) {
      return JSON.stringify([provider, model]);
    }

    // 逆解码：非 JSON / 形状不对（含空串 = 「跟随主 agent」项）一律 null。
    function decodeModelOption(value) {
      try {
        var arr = JSON.parse(value);
        if (Array.isArray(arr) && arr.length === 2
          && (arr[0] === null || typeof arr[0] === "string")
          && (arr[1] === null || typeof arr[1] === "string")) {
          return { provider: arr[0], model: arr[1] };
        }
      } catch (err) { /* 空串或非编码值：按未识别处理 */ }
      return null;
    }

    // 目录 → 扁平选项表：group.id = provider 路由、model.id = 模型 id，显示名
    // 缺省回退 id；重复的 (provider, model) 对去重（value 兼作 React key）。
    function modelOptionsOf(groups) {
      var out = [];
      var seen = {};
      (groups || []).forEach(function (g) {
        if (!g || !Array.isArray(g.models)) return;
        var provider = typeof g.id === "string" ? g.id : "";
        g.models.forEach(function (m) {
          if (!m || typeof m.id !== "string" || m.id === "") return;
          var value = encodeModelOption(provider, m.id);
          if (seen[value]) return;
          seen[value] = true;
          out.push({
            value: value,
            provider: provider,
            providerName: g.name || provider,
            model: m.id,
            modelName: m.name || m.id,
          });
        });
      });
      return out;
    }

    // 选中值求解 + round-trip 保护：当前 (provider, model) 命中目录 → 返回该
    // 选项 value；未命中且至少一侧非空（手编配置、目录未刷新等）→ 追加一个
    // 「当前配置」选项并保持选中，绝不让已有配置值在下拉里凭空消失；两者皆
    // 空 → ""（「跟随主 agent 当前模型」）。extra 为需追加的 <option> 描述
    // （无需追加时 null），value/label 由调用方喂给 h("option", …)。
    function roleModelSelectionOf(options, provider, model) {
      if (!provider && !model) return { value: "", extra: null };
      for (var i = 0; i < options.length; i++) {
        if (options[i].model === model && options[i].provider === provider) {
          return { value: options[i].value, extra: null };
        }
      }
      var rtValue = encodeModelOption(provider || null, model || null);
      // 文案照实：模型缺失（只配 provider，后端会忽略）时按约定不带空格接全角括号。
      // i18n：provider 缺省文案也随语言走，占位符拼进完整句子。
      var providerLabel = provider || t("models.followRouting");
      var label = model
        ? t("models.current", { provider: providerLabel, model: model })
        : t("models.currentNoModel", { provider: providerLabel });
      return {
        value: rtValue,
        extra: { value: rtValue, label: label },
      };
    }

    // ── 场景模板（三档快捷预设）────────────────────────────────────────────────
    // 纯数据 + 纯函数，与面板解耦（便于 i18n / 单测）。label / desc 存字典 key
    // （tpl.*，见 04-i18n 字典），渲染侧经 t() 取当前语言文案——数据本身保持
    // 无语文。模板只动两个键：
    //   - roles_remove：删哪些内置角色；
    //   - main_agent_extra：主 agent 在基础白名单之外额外带哪些工具。
    // 工具面（roles.*.tools / main_agent_remove）、自定义角色、显示名、persona、
    // 角色专用模型、会话/启动方式、skills 一概不碰——「换班底」的语义收窄到
    // 「谁在场 + 主 agent 额外带什么」，切档永远不会悄悄改掉用户精调过的配置。
    //
    // 注意 search_internal_deep 是静态委派工具（不在配置层 ROLES 里，写进
    // roles_remove 会被后端 warn 并忽略，见 docs/configuration.md §2.2），三档
    // 都不写它；调研档「留深搜」正是靠它兜底，无需任何配置动作。
    var PAODING_SCENARIO_TEMPLATES = [
      {
        id: "lite",
        label: "tpl.lite.label",
        desc: "tpl.lite.desc",
        rolesRemove: ["search_external", "design"],
        extraAll: false,
      },
      {
        id: "research",
        label: "tpl.research.label",
        desc: "tpl.research.desc",
        rolesRemove: ["design", "implement"],
        extraAll: false,
      },
      {
        id: "full",
        label: "tpl.full.label",
        desc: "tpl.full.desc",
        rolesRemove: [],
        extraAll: true,
      },
    ];

    // 应用模板：深拷贝 assign 后只改 roles_remove 与 main_agent_extra，返回新
    // 对象（与面板其他 setter 的 JSON 克隆口径一致——新引用才会触发「assign 一变
    // 预览作废」等既有失效逻辑）。roles_remove 去重保序，只收内置角色名（与后端
    // parseRolesRemove 口径一致）；全开档 main_agent_extra = 检测库存全量副本，
    // 其余档位清空（档位 = 确定态而非「在现状上增减」，重复点击同档幂等）。
    // 不删 roles 里被删角色的条目：键保留，卡片显隐由渲染层按 roles_remove 过滤
    // ——这样「轻量/调研 → 全开」切回来时，此前的 persona / 模型 / 工具面原样
    // 复原，正是「模板不碰这些字段」要保的效果。
    function applyScenarioTemplate(assign, tpl, inventory) {
      var next = JSON.parse(JSON.stringify(assign));
      var remove = [];
      (tpl.rolesRemove || []).forEach(function (n) {
        if (remove.indexOf(n) === -1) remove.push(n);
      });
      next.roles_remove = remove;
      next.main_agent_extra = tpl.extraAll ? (inventory || []).slice() : [];
      return next;
    }
    // ── 工作区选择（配置对象）助手 ───────────────────────────────────────

    // 剥掉两个非目标字段容器键后的全局配置副本：existing 里现在还带 workspaces /
    // profile，工作区视角回落全局时不能把它们当目标字段读。返回 null 表示无。
    function globalConfigOf(d) {
      var existing = d && d.existing;
      if (!existing || typeof existing !== "object") return null;
      var out = Object.assign({}, existing);
      delete out.workspaces;
      delete out.profile;
      return out;
    }

    // 工作区标签条收纳个数的初值与兜底：测量未就绪（首帧）或环境不支持
    // ResizeObserver 时按这个数拆可见区 / 隐藏区；正常路径的收纳个数由装填
    // 算法按标签行实宽决定（见 ConfigPanel 的 tabsRowWidth / wsFitCount）。
    var WS_TABS_FALLBACK_COUNT = 5;

    // 工作区 pill 数据行：宿主注册表列表（GET /api/paoding/workspaces）为主，
    // state.existing.workspaces 里多出的键（宿主列表不可用 / 尚未在 GUI 注册）
    // 补在后面——「配置文件里出现过的工作区」必须永远可见、可切换。
    function workspaceRowsOf(d, list) {
      var rows = [];
      var seen = {};
      (list || []).forEach(function (it) {
        if (!it || typeof it.path !== "string" || it.path === "" || seen[it.path]) return;
        seen[it.path] = true;
        rows.push({
          path: it.path,
          title: typeof it.title === "string" && it.title !== "" ? it.title : null,
          sessionCount: typeof it.sessionCount === "number" ? it.sessionCount : null,
        });
      });
      var wsCfg = (d && d.existing && d.existing.workspaces) || {};
      Object.keys(wsCfg).forEach(function (p) {
        if (seen[p]) return;
        seen[p] = true;
        rows.push({ path: p, title: null, sessionCount: null });
      });
      return rows;
    }

    // pill 文案：宿主 title 优先，缺省回落路径 basename（宿主列表不可用的降级行）。
    function wsLabelOf(row) {
      if (row.title) return row.title;
      var parts = String(row.path).replace(/[\/\\]+$/, "").split(/[\/\\]/); // Windows 路径按 \ 也能取到 basename
      return parts[parts.length - 1] || row.path;
    }

    // 工作区配置状态三态（tab / 菜单项共用的小标签）：
    //   project —— 专属预设已生成（orchestrator-<slug> 已落盘，项目配置生效）
    //   pending —— 配置里存了工作区条目、但预设还没生成（编辑过没应用）
    //   global  —— 没有任何条目（新会话跟随全局 orchestrator 预设）
    // 判定优先级 installed > existing 条目 > 无。existing.workspaces 是磁盘
    // 配置原文透传，meta 的 installed 对账 installedPresets。
    function wsTagOf(existingWs, meta, wsPath) {
      var m = meta && meta[wsPath];
      if (m && m.installed) return "project";
      if (existingWs && Object.prototype.hasOwnProperty.call(existingWs, wsPath)) return "pending";
      return "global";
    }

    // 三态 → 标签文案（i18n：tab 小徽标与「更多」菜单共用，与 tooltip 口径一致）
    function wsTagTextOf(kind) {
      return kind === "project" ? t("ws.tag.project") : kind === "pending" ? t("ws.tag.pending") : t("ws.tag.global");
    }

    // 角色卡「默认展开」判定单一来源（toggleRole / roleCard 共用）：主 agent
    // 与外部检索卡默认展开，其余默认收起；openMap 显式开关优先。
    function defaultOpenOf(name) {
      return name === "__main__" || name === "search_external";
    }

    // 工作区 tab / 「更多」菜单项共用的 title 提示串（两处渲染同款拼法，抽
    // 一处防漂移）：路径 + 会话数 + 配置状态（项目 / 待应用 / 全局）。
    function wsTabTipOf(row, meta, existingWs) {
      var m = meta && meta[row.path];
      var kind = wsTagOf(existingWs, meta, row.path);
      return row.path +
        (row.sessionCount != null ? t("ws.tip.sessions", { n: row.sessionCount }) : "") +
        (kind === "project"
          ? t("ws.tip.project", { id: m && m.presetId })
          : kind === "pending"
            ? t("ws.tip.pending")
            : t("ws.tip.global"));
    }

    // 工作区 tab 的显示顺序：按会话数降序（缺失沉底、同分保持注册表顺序），
    // 激活项再恒置顶（紧跟「全局默认」之后）。收纳装填按这个顺序进行，激活
    // tab 自然永远留在可见区；「更多」按钮上的 omd-tabMoreActive 兜底分支
    // 保留（万一首帧测量未就绪）。
    function wsDisplayOrderOf(rows, activeWs) {
      // 会话数从多到少：常用工作区靠前，冷门的自然沉进「更多」菜单。缺失
      //（null）按 -1 处理沉底；同分保持注册表顺序（V8 的 sort 稳定，不抖）。
      var order = rows.slice().sort(function (a, b) {
        var ca = a && a.sessionCount != null ? a.sessionCount : -1;
        var cb = b && b.sessionCount != null ? b.sessionCount : -1;
        return cb - ca;
      });
      if (activeWs === null) return order;
      // 激活项恒置顶（紧跟「全局默认」）：装填按此顺序进行，正在操作的 tab
      // 永远不会被收进「更多」。
      for (var i = 0; i < order.length; i++) {
        if (order[i].path === activeWs && i > 0) {
          var active = order.splice(i, 1)[0];
          order.unshift(active);
          break;
        }
      }
      return order;
    }

    // 「添加工作区」组合框建议行：服务端候选（GET workspaces?discover=1 的
    // items）按当前输入做子串过滤——完整路径或 basename 命中即可，不分大小写；
    // 空输入 = 全部候选。没拉到候选（null）或无匹配时返回空数组，调用方据此
    // 整块不渲染下拉。
    function wsSuggestionsOf(cands, query) {
      if (!Array.isArray(cands) || !cands.length) return [];
      var q = String(query || "").trim().toLowerCase();
      if (q === "") return cands.slice();
      return cands.filter(function (c) {
        return (typeof c.path === "string" && c.path.toLowerCase().indexOf(q) !== -1) ||
          (typeof c.basename === "string" && c.basename.toLowerCase().indexOf(q) !== -1);
      });
    }

    // ── 通用确认弹窗（confirm 型模态框）────────────────────────────────────
    // 照 80-mount 的 createWorkspaceController 做模块级小状态器 + 单例：发起方
    // （ConfigPanel 的删除 / 保存并应用、86 页头的升级）与渲染方（86 的
    // ConfirmLayer）分属两棵 React 子树，中间隔着懒挂载的 createRoot，props
    // 传不通，靠快照 + subscribe 同步。req 纯 JS 对象直存（含 onConfirm 回调），
    // 不经 JSON 序列化。本片段拼接序在 86 之前，confirmCtrl / confirmModalOf
    // 由 86 直接共用，不得重复声明。
    function createConfirmController() {
      var snapshot = { req: null };
      var listeners = [];
      function notify() {
        listeners.slice().forEach(function (listener) { listener(); });
      }
      return {
        getSnapshot: function () { return snapshot; },
        subscribe: function (listener) {
          listeners.push(listener);
          return function () {
            var i = listeners.indexOf(listener);
            if (i !== -1) listeners.splice(i, 1);
          };
        },
        // 弹出确认框：opts = { title, body, confirmText, cancelText, danger, onConfirm }。
        // 不在这里执行 onConfirm——确认键点击时（confirmModalOf）先 close 再调，
        // req 先行清空，异步 onConfirm 期间弹窗已卸载，双击 / Enter 不会二触发。
        ask: function (opts) {
          snapshot = {
            req: {
              title: opts.title,
              body: opts.body,
              confirmText: opts.confirmText || t("common.confirm"),
              cancelText: opts.cancelText || t("common.cancel"),
              danger: !!opts.danger,
              onConfirm: opts.onConfirm,
            },
          };
          notify();
        },
        close: function () {
          if (snapshot.req === null) return;
          snapshot = { req: null };
          notify();
        },
      };
    }
    var confirmCtrl = createConfirmController();

    // 确认弹窗纯渲染函数：只依赖模块级 h / P，与控制器同址声明。结构对齐
    // wsModalOf / roleAddModalOf（pd-modalMask/Card/Header/Title/Close/Body/
    // Footer），正文用 pd-modalText（多行文案 pre-line），danger 时确认钮加
    // pd-dangerBtn（红底，删除类操作专用）。close 由 ConfirmLayer 传入。
    function confirmModalOf(req, close) {
      if (!req) return null;
      return h("div", { className: "pd-modalMask",
          // 只点遮罩空白处才收（mousedown 真正落在遮罩上），在卡片内按下拖选不误关
          onMouseDown: function (e) { if (e.target === e.currentTarget) close(); } },
        h("div", { className: "pd-modalCard pd-confirmCard", role: "alertdialog", "aria-modal": "true",
            "aria-label": req.title, "aria-describedby": "pd-confirmBody" },
          h("div", { className: "pd-modalHeader" },
            h("h2", { className: "pd-modalTitle" }, req.title),
            h("button", { type: "button", className: "pd-modalClose", "aria-label": t("common.close"), onClick: close },
              h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
          h("div", { className: "pd-modalBody" },
            h("div", { className: "pd-modalText", id: "pd-confirmBody" }, req.body)),
          h("div", { className: "pd-modalFooter" },
            // 焦点默认落在确认钮（危险操作落在取消钮）：开窗即可 Enter 确认 /
            // 取消，与原生 confirm 的键盘习惯对齐；danger 反向落焦是让破坏性
            // 操作多一道显式点击的门槛。弹窗关闭即整体卸载，重开重新自动聚焦。
            h(P.Button, { variant: "outline", size: "md", autoFocus: !!req.danger, onClick: close },
              req.cancelText || t("common.cancel")),
            h(P.Button, {
              variant: "primary",
              size: "md",
              className: req.danger ? "pd-dangerBtn" : undefined,
              autoFocus: !req.danger,
              onClick: function () {
                // 先 close 再执行：req 立即清空、按钮随弹窗卸载，onConfirm
                // 异步期间的重复点击 / Enter 都不会再命中确认路径。
                close();
                if (typeof req.onConfirm === "function") req.onConfirm();
              },
            }, req.confirmText || t("common.confirm")))));
    }

    // ── 检查提示卡（结构化体检结果的渲染）──────────────────────────────────
    // warnState = { source: "preview" | "apply", items: [{level, code, message}] }
    // （items 即 tools/lib/health.mjs healthCheck 的 items 原样）。无 items 不渲染
    // （零占位）；逐条一行，按 level 分色（error 红 / warn 琥珀 / info 中性，复用
    // statusRow 同款 omd-status* 类），code 收进悬浮提示（面向排障，不占版面）。
    // 行不放 role=alert：卡片随响应常驻展示而非突发警报，读屏按普通内容播报即可。
    function warningsCardOf(warnState) {
      if (!warnState || !Array.isArray(warnState.items) || warnState.items.length === 0) return null;
      var rows = warnState.items.map(function (w, i) {
        var level = w && (w.level === "error" || w.level === "warn") ? w.level : "info";
        var cls = level === "error" ? "omd-statusError" : level === "warn" ? "omd-statusWarn" : "omd-status";
        var icon = level === "error" ? "⛔" : level === "warn" ? "⚠️" : "ℹ️";
        // 悬浮提示：已知 code（tools/lib/health.mjs 的固定集）给本地化标题
        // （warn.title.<code>），未知 code 沿用「检查项：<code>」；服务端 message
        // 原文作正文（服务端体检文案仅中文，本轮不译——取舍见 04 字典注释）。
        var title = undefined;
        if (w && w.code) {
          title = tHas("warn.title." + w.code)
            ? t("warn.title." + w.code) + "（" + w.code + "）"
            : t("warn.itemTitle", { code: w.code });
        }
        return h("div", { className: cls, key: i, title: title },
          h("span", { className: "omd-statusIcon" }, icon),
          h("span", { className: "omd-statusText" }, (w && w.message) || ""));
      });
      return h("div", { className: "omd-group" },
        h("div", { className: "omd-groupHeading" },
          h("span", { className: "omd-groupIcon" }, ic(P.IconWarningOutline16, 14)),
          h("span", null, warnState.source === "apply" ? t("warn.heading.apply") : t("warn.heading.preview")),
          h("span", { className: "omd-count" }, warnState.items.length)),
        h("div", { className: "omd-section" }, rows));
    }

    // ── 预览「本次变更」区块（preview.diff 结构化差分的渲染）─────────────────
    // 服务端 preview 响应的 diff 是纯结构零文案（tools/lib/config.mjs
    // diffAssignments），客户端在此按块渲染成可读行，全部措辞走 t() 字典：
    //   - changed=false → 一行「与上次保存的配置一致」；
    //   - changed=true → 主 agent（新带/移除工具 + persona/技能变化；modelChanged
    //     恒 false 不渲染）→ 各角色（新增/移除/变更，变更细分 +N -N 工具、
    //     persona、专用模型、启动方式、后台续跑）→ roles_remove（删/恢复内置
    //     角色）→ main_extra（附加工具通道增删明细）逐块完整列出（预览区本就
    //     在整页滚动流里，行多不怕）。
    // apply 确认流程刻意不加本区块：预览才是「看一眼」的时刻，确认弹窗保持
    // 一屏说清。行按语义着色：净新增（绿）/ 净移除（红）/ 变更明细（中性）。
    function diffLineOf(text, tone) {
      return h("div", {
        className: "omd-diffLine" +
          (tone === "add" ? " omd-diffLineAdd" : tone === "del" ? " omd-diffLineDel" : ""),
      }, text);
    }

    // 工具/角色名列表串（按既有 listSep 口径连接）；调用方先判空再取。
    function diffListStr(list) {
      return (list || []).join(t("common.listSep"));
    }

    function diffBlockOf(diff) {
      if (!diff || typeof diff !== "object") return null; // 老服务端无 diff 字段：整块零占位
      var lines = [];
      if (diff.changed) {
        // 主 agent：extra 增删与 remove 增删已由服务端合并成净增减视图
        //（toolsAdded / toolsRemoved），直接按净变化渲染。
        var ma = diff.mainAgent || {};
        if (ma.toolsAdded && ma.toolsAdded.length) {
          lines.push(diffLineOf(t("diff.mainToolsAdded", { n: ma.toolsAdded.length, list: diffListStr(ma.toolsAdded) }), "add"));
        }
        if (ma.toolsRemoved && ma.toolsRemoved.length) {
          lines.push(diffLineOf(t("diff.mainToolsRemoved", { n: ma.toolsRemoved.length, list: diffListStr(ma.toolsRemoved) }), "del"));
        }
        if (ma.personaChanged) lines.push(diffLineOf(t("diff.mainPersona")));
        if (ma.skillsChanged) lines.push(diffLineOf(t("diff.mainSkills")));
        // 角色：新增 / 移除 / 变更（变更行细分到维度，逐维度本地化）。
        (diff.roles || []).forEach(function (r) {
          if (!r || !r.name) return;
          if (r.op === "added") { lines.push(diffLineOf(t("diff.roleAdded", { name: r.name }), "add")); return; }
          if (r.op === "removed") { lines.push(diffLineOf(t("diff.roleRemoved", { name: r.name }), "del")); return; }
          var details = [];
          if ((r.toolsAdded && r.toolsAdded.length) || (r.toolsRemoved && r.toolsRemoved.length)) {
            details.push(t("diff.roleTools", { added: (r.toolsAdded || []).length, removed: (r.toolsRemoved || []).length }));
          }
          if (r.personaChanged) details.push(t("diff.rolePersona"));
          if (r.modelChanged) details.push(t("diff.roleModel"));
          if (r.startModeChanged) details.push(t("diff.roleStartMode"));
          if (r.backgroundModeChanged) details.push(t("diff.roleBgMode"));
          if (details.length) {
            lines.push(diffLineOf(t("diff.roleChanged", { name: r.name, details: details.join(t("common.listSep")) })));
          }
        });
        // roles_remove：新增 = 删除的内置角色（净移除）；移除 = 恢复（净新增）。
        var rr = diff.rolesRemove || {};
        if (rr.added && rr.added.length) {
          lines.push(diffLineOf(t("diff.rolesRemoveAdded", { n: rr.added.length, list: diffListStr(rr.added) }), "del"));
        }
        if (rr.removed && rr.removed.length) {
          lines.push(diffLineOf(t("diff.rolesRemoveRemoved", { n: rr.removed.length, list: diffListStr(rr.removed) }), "add"));
        }
        // main_extra 通道明细（主 agent 合并视图之外的通道拆分，按任务要求一并列出）。
        var me = diff.mainExtra || {};
        if (me.added && me.added.length) {
          lines.push(diffLineOf(t("diff.mainExtraAdded", { n: me.added.length, list: diffListStr(me.added) }), "add"));
        }
        if (me.removed && me.removed.length) {
          lines.push(diffLineOf(t("diff.mainExtraRemoved", { n: me.removed.length, list: diffListStr(me.removed) }), "del"));
        }
      }
      return h("div", { className: "omd-diffBlock" },
        h("div", { className: "omd-diffHeading" }, t("diff.heading")),
        diff.changed && lines.length
          ? h("div", { className: "omd-diffLines" }, lines)
          : h("div", { className: "omd-diffNone" }, t("diff.unchanged")));
    }

    // ── 主面板 ─────────────────────────────────────────────────────────────

    function ConfigPanel(props) {
      var _s = useState(null), data = _s[0], setData = _s[1];
      var _e = useState(null), error = _e[0], setError = _e[1];
      var _a = useState(null), assign = _a[0], setAssign = _a[1];
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      var _op = useState(null), busyOp = _op[0], setBusyOp = _op[1];
      var _p = useState(null), preview = _p[0], setPreview = _p[1];
      // 检查提示卡状态（形状见 warningsCardOf）：preview 源随 assign 变更作废
      //（与预览同一失效逻辑），apply 源描述的是「已落盘结果」——应用成功后
      // 服务端回拉 state 重建 assign 不算编辑，不作废，直到下一次预览/应用。
      var _wn = useState(null), warnState = _wn[0], setWarnState = _wn[1];
      var _o = useState({}), openMap = _o[0], setOpenMap = _o[1];
      var _m = useState({}), personaMap = _m[0], setPersonaMap = _m[1];
      var _x = useState(false), extraOpen = _x[0], setExtraOpen = _x[1];
      var _r = useState(0), extraRev = _r[0], setExtraRev = _r[1];
      var _dnr = useState(0), displayNameRev = _dnr[0], setDisplayNameRev = _dnr[1]; // 主 agent 显示名 input 重挂（key 技巧）
      var _rn = useState({}), roleNameRev = _rn[0], setRoleNameRev = _rn[1]; // 内置角色显示名 input 重挂（每角色独立 key 计数）
      var _rm = useState({}), roleModelRev = _rm[0], setRoleModelRev = _rm[1]; // 角色专用模型/provider input 重挂（仅降级手输模式用；每角色独立 key 计数）
      var _mg = useState(null), modelGroups = _mg[0], setModelGroups = _mg[1]; // 模型目录 groups（/api/paoding/models）
      var _mgok = useState(false), modelGroupsOk = _mgok[0], setModelGroupsOk = _mgok[1]; // 目录可用 = 下拉模式；false = 降级双 input
      var _mgerr = useState(""), modelGroupsErr = _mgerr[0], setModelGroupsErr = _mgerr[1]; // 目录拉取失败原因（降级 hint 一句话展示）
      // 版本信息（/api/paoding/version；null = 未取到/检测失败，静默不显示）。
      // 状态挂在页头 PageShell（版本号展示在标题旁），经 props 下发：
      // setVerInfo 供 loadVersion 回写页头（版本号与更新卡都在 PageShell）。
      var setVerInfo = props && props.setVerInfo;
      // 工具面瘦身统计（state.slim = 按已保存配置算的 {total, main}）：呈现区
      // 同样挂在页头 PageShell（副标题下一行，版本号/更新卡同区），经 props
      // 下发 setSlimInfo 供 load / doRescan / doApply 回写。null = 老服务端
      // 无该字段 / 尚未取到，页头一行零占位。
      var setSlimInfo = props && props.setSlimInfo;
      // 导入配置后的整体刷新入口：ConfigPanel 把 load 注册给页头（PageShell 的
      // 「更多 → 导入配置」成功后调用）。面板与页头分属两棵子树，props 只能
      // 单向传「注册函数」，刷新动作反过来经 ref 回调触达。
      var registerReload = props && props.registerReload;
      var _ws = useState(null), activeWs = _ws[0], setActiveWs = _ws[1]; // 当前配置对象：null = 全局默认；否则工作区绝对路径
      // 视角切换计数：switchWorkspace 每次自增，拼进全部未受控（defaultValue）
      // 编辑器的 key——否则切 tab 不重挂，旧工作区输入框里未提交的文本会在
      // blur 时写进新工作区的 assign（串台）。现有各 rev 只覆盖「校验失败 /
      // 恢复默认」重挂，不覆盖切视角，故统一再加这一维。
      var _swr = useState(0), switchRev = _swr[0], setSwitchRev = _swr[1];
      var _wsl = useState([]), wsList = _wsl[0], setWsList = _wsl[1]; // 宿主工作区列表（GET /api/paoding/workspaces；失败降级为空数组，pill 由配置文件键兜底）
      var _wslt = useState(false), wsListTried = _wslt[0], setWsListTried = _wslt[1]; // 列表请求尘埃落定标记（成败均置位）：pendingOpenWs 消费条件用
      var _wsle = useState(""), wsListErr = _wsle[0], setWsListErr = _wsle[1]; // 列表拉取失败的降级提示（"" = 正常零占位）：标签条只剩配置文件兜底的工作区时，给用户一句交代
      var _wsao = useState(false), wsAddOpen = _wsao[0], setWsAddOpen = _wsao[1]; // 「添加工作区」弹窗开合态（旧版是 tab 条下方的内联展开行）
      var _wsap = useState(""), wsAddPath = _wsap[0], setWsAddPath = _wsap[1];
      var _wsae = useState(""), wsAddErr = _wsae[0], setWsAddErr = _wsae[1];
      var _rao = useState(false), roleAddOpen = _rao[0], setRoleAddOpen = _rao[1]; // 「新建自定义 agent 角色」弹窗开合态（原原生 prompt 改模态框）
      var _ran = useState(""), roleAddName = _ran[0], setRoleAddName = _ran[1];
      var _radn = useState(""), roleAddDispName = _radn[0], setRoleAddDispName = _radn[1]; // 弹窗第二字段「显示名」（可选；残值语义同 roleAddName，成功提交才清）
      var _rabm = useState("one-shot"), roleAddBgMode = _rabm[0], setRoleAddBgMode = _rabm[1]; // 弹窗第三字段「会话模式」：'one-shot' | 'continuable'（残值语义同上，成功提交才复位）
      var _rasm = useState("fresh"), roleAddStartMode = _rasm[0], setRoleAddStartMode = _rasm[1]; // 弹窗第四字段「启动方式」：'fresh' | 'fork'（残值语义同上，成功提交才复位）
      var _rae = useState(""), roleAddErr = _rae[0], setRoleAddErr = _rae[1];
      // 「重命名自定义角色」弹窗三件套（原原生 prompt 改模态框）：For 为
      // null = 关闭，非空 = 待改名的旧 toolName（身份键，提交时迁移 skills 引用）。
      var _rrf = useState(null), roleRenameFor = _rrf[0], setRoleRenameFor = _rrf[1];
      var _rrv = useState(""), roleRenameVal = _rrv[0], setRoleRenameVal = _rrv[1]; // 弹窗输入值（开窗预填旧名）
      var _rre = useState(""), roleRenameErr = _rre[0], setRoleRenameErr = _rre[1];
      var roleAddDispRef = useRef(null); // 显示名 input 引用：toolName 框 Enter 的移焦落点（两字段分工见 roleAddModalOf 注释）
      var _wsc = useState(null), wsCands = _wsc[0], setWsCands = _wsc[1]; // 服务端候选目录（?discover=1）；null = 未拉到（含失败），纯手输兜底
      var _wsso = useState(false), wsSuggestOpen = _wsso[0], setWsSuggestOpen = _wsso[1]; // 建议下拉展开态（跟随输入框焦点 / Esc）
      var _wsmo = useState(false), wsMenuOpen = _wsmo[0], setWsMenuOpen = _wsmo[1]; // 「更多」下拉展开态（放不下收进来的那批工作区）
      var _wssk = useState(null), wsSkills = _wssk[0], setWsSkills = _wssk[1]; // 当前工作区技能合并列表（用户级 + 该工作区项目级；null = 全局视角 / 未拉到）
      var _wspk = useState(null), wsProjSkills = _wspk[0], setWsProjSkills = _wspk[1]; // 项目级技能子集（Set，与 wsSkills 同源同步；项目角标据此渲染）
      var _wsse = useState(""), wsSkillsErr = _wsse[0], setWsSkillsErr = _wsse[1]; // 工作区技能拉取失败的降级一句话提示
      var wsSkillsCacheRef = useRef({}); // 工作区技能缓存：每路径只拉一次（面板生命周期；失败也记 null 不重试）
      var wsCandsTriedRef = useRef(false); // 候选只拉一次的面板级闸门（失败的尝试也算数，防聚焦一次请求一次）
      var activeWsRef = useRef(activeWs); // load / rescan / preview / apply 等异步回调里读最新值，不依赖闭包里的旧 activeWs
      activeWsRef.current = activeWs; // 渲染期同步（回调只在这些 setter 之后触发，安全）
      var rootRef = useRef(null); // 面板根节点（重新检测后回顶用）
      var previewRef = useRef(null); // 预览生成组根节点（条件渲染，预览成功后定位用）
      var assignRef = useRef(assign); // doPreview 完成回调里比对请求时快照：生成期间 assign 变过则结果作废
      assignRef.current = assign; // 渲染期同步（同 activeWsRef 的做法）
      var _sr = useState(null), scrollReq = _sr[0], setScrollReq = _sr[1]; // 滚动请求："preview" | "top" | null
      // 工作区标签行自动收纳：量出标签行实宽后由装填算法决定直接露出几个
      // tab（wsFitCount），放不下的收进「更多」。tabWidthsRef 缓存测量层量到
      // 的每个 tab 自然宽度（data-ws-key → offsetWidth），跨渲染复用。
      var tabsRowRef = useRef(null); // .omd-tabs 标签行（宽度来源）
      var tabsMeasureRef = useRef(null); // 隐藏测量层容器
      var tabWidthsRef = useRef({});
      var _rw = useState(0), tabsRowWidth = _rw[0], setTabsRowWidth = _rw[1];
      var _fc = useState(WS_TABS_FALLBACK_COUNT), wsFitCount = _fc[0], setWsFitCount = _fc[1]; // 初值与兜底 = 测量未就绪时的固定 5 个

      var ready = !!(data && assign); // 面板数据就绪：宽度观察 / 装填计算只在就绪后跑
      // 装填计算的依赖指纹：工作区集合、显示顺序、文案或安装标记任一变化都会
      // 改变这个串，effect 据此重算收纳个数（行宽变化经 tabsRowWidth 触达）。
      // 必须先于下方用到它的 useEffect 求值，依赖数组才能拿到当次渲染的值。
      var wsMetaNow = (data && data.workspaceMeta) || {};
      var existingWsKey = (data && data.existing && data.existing.workspaces) || null;
      var wsWidthKey = "";
      (function buildKey() {
        var rowsFor = workspaceRowsOf(data, wsList);
        var ord = wsDisplayOrderOf(rowsFor, activeWs);
        for (var i = 0; i < ord.length; i++) {
          var m = wsMetaNow[ord[i].path];
          wsWidthKey += (i ? "|" : "") + ord[i].path + ":" + wsLabelOf(ord[i]) + ":"
            + (ord[i].sessionCount != null ? ord[i].sessionCount : "-") + ":"
            + (m && m.installed ? "2" : existingWsKey && Object.prototype.hasOwnProperty.call(existingWsKey, ord[i].path) ? "1" : "0");
        }
      })();

      // 实现在模块级 paodingApi（PageShell 的页头升级卡也用它），这里薄包一层
      // 保持既有调用点与 useCallback 依赖口径不变。
      var api = useCallback(function (path, body) { return paodingApi(path, body); }, []);

      // 目标配置基座选取：工作区视角（wsPath 非空）优先取该工作区已保存条目
      // （existing.workspaces[wsPath]，没应用过则回落剥掉 workspaces/profile 的
      // 全局 existing），全局视角直接用 existing（同样剥污染键）、再回落建议值。
      // 返回的 assignments 只由下方显式字段拼出，workspaces / profile 两个容器
      // 键天然混不进 POST 体。
      var buildTargetAssignments = useCallback(function (d, wsPath) {
        var base = null;
        if (wsPath) {
          var wsCfg = d.existing && d.existing.workspaces && d.existing.workspaces[wsPath];
          if (wsCfg) base = wsCfg;
        }
        if (!base) {
          base = globalConfigOf(d) || d.suggested || { roles: {}, roles_remove: [], main_agent_display_name: null, main_agent_extra: [], main_agent_remove: [], main_agent_skills: [], main_agent_skills_inline: [], main_agent_persona_extra: null, skills: {} };
        }
        // roles_remove：被删除的内置角色名单（只含 DEFAULT_ROLES 名）。名单内的内置角色
        // 不重建进 roles —— 删除状态跨刷新 / 重新检测保留，卡片消失，仅留在恢复区。
        var removed = (base.roles_remove || []).filter(function (n) { return DEFAULT_ROLES.indexOf(n) !== -1; });
        var roles = {};
        DEFAULT_ROLES.forEach(function (name) {
          if (removed.indexOf(name) !== -1) return;
          roles[name] = {
            persona: (base.roles && base.roles[name] && base.roles[name].persona) || null,
            // 显示名透传：string 非 '' 保留，缺省 / '' / null 一律 null（内置默认条目 name:null）
            name: roleNameOf(base.roles, name),
            // 专用模型 / provider 透传：string 非 '' 保留，缺省 / '' / null 一律 null
            //（null = 跟随主 agent 当前模型；provider 只配不配 model 时后端 warn 并忽略）
            model: roleStringRef(base.roles, name, "model"),
            provider: roleStringRef(base.roles, name, "provider"),
            // 会话模式透传：仅 'continuable' 认可，其余归 'one-shot'（字面量，
            // 与 config 层 normalizeBackgroundMode 的序列化形状一致）
            background_mode: roleBgModeOf(base.roles, name),
            // 启动方式透传：仅 'fork' 认可，其余归 'fresh'（与 config 层
            // normalizeStartMode 的序列化形状一致；决定委派块块级 provider 行）
            start_mode: roleStartModeOf(base.roles, name),
            tools: (base.roles && base.roles[name] && base.roles[name].tools) ||
              (d.blocks && d.blocks[name]) || [],
          };
        });
        Object.keys(base.roles || {}).forEach(function (name) {
          if (DEFAULT_ROLES.indexOf(name) !== -1) return;
          roles[name] = {
            persona: base.roles[name].persona || null,
            name: roleNameOf(base.roles, name),
            // 自定义角色同样携带 model / provider（null 或 string），形状与内置一致
            model: roleStringRef(base.roles, name, "model"),
            provider: roleStringRef(base.roles, name, "provider"),
            // 会话模式与内置同款收法：'one-shot' = 缺省一次性，'continuable' = 可续
            background_mode: roleBgModeOf(base.roles, name),
            // 启动方式与内置同款收法：'fresh' = 缺省全新启动，'fork' = 继承对话
            start_mode: roleStartModeOf(base.roles, name),
            tools: base.roles[name].tools || [],
          };
        });
        return {
          roles: roles,
          roles_remove: removed,
          // 显示名键（仅 preset 显示名，persona 身份行不可改名）：null / '' / 缺省
          // 一律归一为 null（= 默认「编排模式 (Orchestrator)」，工作区预设用派生名）
          main_agent_display_name: base.main_agent_display_name == null || base.main_agent_display_name === "" ? null : base.main_agent_display_name,
          main_agent_extra: base.main_agent_extra || [],
          main_agent_remove: base.main_agent_remove || [],
          main_agent_skills: (base.main_agent_skills || []).slice(),
          main_agent_skills_inline: (base.main_agent_skills_inline || []).slice(),
          // 语义：null/缺省 = 用默认常量（compose 时回落）；'' = 明确清空；其他 = 用户覆盖
          main_agent_persona_extra: base.main_agent_persona_extra == null ? null : base.main_agent_persona_extra,
          skills: Object.assign({}, base.skills || {}),
        };
      }, []);

      var load = useCallback(function () {
        api("state").then(function (d) {
          setData(d);
          setAssign(buildTargetAssignments(d, activeWsRef.current));
          // 页头瘦身统计跟着 state 走（state.slim 按已保存的全局配置计算，与
          // 工作区视角无关）；老服务端无 slim 字段时置 null 隐藏该行。
          if (typeof setSlimInfo === "function") setSlimInfo(d && d.slim ? d.slim : null);
        }).catch(function (err) { setError(err.message); });
      }, [api, buildTargetAssignments]);

      useEffect(load, [load]);

      // 把「整体刷新」注册给页头（「导入配置」成功后由 PageShell 调用）：load
      // 重拉 state + 按新配置重建 assign；导入 = 整份文件被替换，两源检查提示
      // 一并作废（旧卡描述的已落盘结果已不在盘上，留着只会误导）。load 是
      // useCallback 稳定引用；卸载时反注册，防页头持有失效闭包。
      useEffect(function () {
        if (typeof registerReload !== "function") return;
        registerReload(function () {
          setWarnState(null);
          load();
        });
        return function () { registerReload(null); };
      }, [load, registerReload]);

      // 工作区列表：面板加载时拉一次宿主注册表（与 state 并行）。失败降级为
      // 空列表——workspaceRowsOf 会用 state.existing.workspaces 的键兜底出 pill，
      // 绝不阻塞面板。降级不再无声：宿主侧故障（如插件实例已 disposed 的僵尸
      // 场景）会让接口 500，标签条只剩配置文件兜底的 tab，用户容易误判成
      // 「功能坏了」，故留一行可见提示；err.message 截短后括注原文，便于对照
      // 日志定位。请求错误 / 响应格式异常都汇入同一个 catch，提示口径一致。
      var loadWorkspaces = useCallback(function () {
        api("workspaces").then(function (d) {
          if (!d || d.ok !== true || !Array.isArray(d.items)) throw new Error(t("ws.listBadResponse"));
          setWsList(d.items);
          setWsListTried(true);
          setWsListErr("");
        }).catch(function (err) {
          setWsList([]); // 静默降级：只用配置文件里已有的工作区键
          setWsListTried(true);
          var msg = err && err.message ? String(err.message) : "";
          setWsListErr(t("ws.listFailHint")
            + (msg ? t("ws.listFailDetail", { msg: msg.length > 80 ? msg.slice(0, 80) + "…" : msg }) : ""));
        });
      }, [api]);

      useEffect(loadWorkspaces, [loadWorkspaces]);

      // 宿主菜单「庖丁配置」入口的落地：state 与工作区列表都就绪（列表成败
      // 均算就绪，wsListTried 见 loadWorkspaces）后，把 pendingOpenWs 指着的
      // 工作区切为激活 tab。找不到（未注册 / 列表拉失败）给 warn、留在当前
      // tab，一次性消费不再重试。
      useEffect(function () {
        if (pendingOpenWs === null || !data || !wsListTried) return;
        var target = pendingOpenWs;
        pendingOpenWs = null;
        var rows = workspaceRowsOf(data, wsList);
        var hit = null;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].path.replace(/[\/\\]+$/, "") === target) { hit = rows[i].path; break; }
        }
        if (hit) switchWorkspace(hit);
        else toast.warn(t("ws.notInList", { path: target }));
      }, [data, wsListTried]);

      // 「添加工作区」候选：输入框首次聚焦时拉一次服务端扫描
      //（GET workspaces?discover=1），面板生命周期内缓存不重拉（含失败的
      // 尝试——不该每次聚焦都打一遍接口）。请求错误 / 响应异常一律静默：
      // 候选保持 null，输入框退化成现状的纯手输，不弹错不打扰。
      function loadWsCands() {
        if (wsCandsTriedRef.current) return;
        wsCandsTriedRef.current = true;
        api("workspaces?discover=1").then(function (d) {
          if (d && d.ok === true && Array.isArray(d.items)) setWsCands(d.items);
        }).catch(function () { /* 静默降级：纯手输 */ });
      }

      // 按工作区拉技能（GET workspaces?skills=1&path=…）：切到某工作区时拉取
      // 该目录的技能全集（用户级 + 该工作区项目级）与项目级子集。面板生命周期
      // 内每路径只拉一次（结果存 wsSkillsCacheRef，失败也记 null 不重试）。
      // 失败降级：wsSkills 置 null（技能网格回落 data.skills 用户级）并留一句
      // 提示；切回全局清空两态。响应回来时若已切走（activeWsRef 对不上）只写
      // 缓存、不再动当前视图，防串台。
      function applyWsSkills(wsPath) {
        if (!wsPath) {
          setWsSkills(null);
          setWsProjSkills(null);
          setWsSkillsErr("");
          return;
        }
        var cached = wsSkillsCacheRef.current[wsPath];
        if (cached !== undefined) {
          setWsSkills(cached ? cached.skills : null);
          setWsProjSkills(cached ? new Set(cached.projectSkills) : null);
          setWsSkillsErr(cached ? "" : t("ws.skillsFail"));
          return;
        }
        api("workspaces?skills=1&path=" + encodeURIComponent(wsPath)).then(function (d) {
          if (!d || d.ok !== true || !Array.isArray(d.skills)) throw new Error("技能列表响应格式异常");
          var proj = Array.isArray(d.projectSkills) ? d.projectSkills : [];
          wsSkillsCacheRef.current[wsPath] = { skills: d.skills, projectSkills: proj };
          if (activeWsRef.current !== wsPath) return; // 期间已切走：只留缓存
          setWsSkills(d.skills);
          setWsProjSkills(new Set(proj));
          setWsSkillsErr("");
        }).catch(function () {
          wsSkillsCacheRef.current[wsPath] = null;
          if (activeWsRef.current !== wsPath) return;
          setWsSkills(null);
          setWsProjSkills(null);
          setWsSkillsErr(t("ws.skillsFail"));
        });
      }

      // 切换配置对象（全局 ↔ 工作区）：按新视角重建 assign，并清掉上一视角的
      // 预览（预览文本对应的是旧目标，留着只会误导）；切到工作区时顺带
      // 拉取该工作区的技能列表（带缓存，见 applyWsSkills）。
      function switchWorkspace(wsPath) {
        setActiveWs(wsPath);
        activeWsRef.current = wsPath;
        if (data) setAssign(buildTargetAssignments(data, wsPath));
        setPreview(null);
        setSwitchRev(switchRev + 1); // 未受控编辑器随 key 变化重挂：显示新目标值，blur 不再把旧视角文本写进新视角
        applyWsSkills(wsPath);
      }

      // 添加工作区：POST /api/paoding/workspaces 注册到宿主（幂等），成功后
      // 刷新工作区列表并切到该工作区（未应用过配置的工作区先回落全局现状，
      // 首次「保存并应用」才生成工作区专属 preset 与 workspaces 条目）。
      // rawPath 仅组合框建议行点击时传选中的候选路径（只认 string，按钮
      // onClick 透传进来的事件对象等一律回落当前输入值，Enter 语义不变）。
      function submitWorkspace(rawPath) {
        var p = String(typeof rawPath === "string" ? rawPath : wsAddPath || "").trim();
        if (p === "") return;
        setBusy(true);
        setBusyOp("wsadd");
        api("workspaces", { path: p }).then(function (r) {
          var ws = (r && r.workspace) || {};
          var wsPath = typeof ws.path === "string" && ws.path !== "" ? ws.path : p;
          setWsAddPath("");
          setWsAddOpen(false);
          setWsSuggestOpen(false);
          setWsAddErr("");
          return api("workspaces").then(function (d) {
            if (d && d.ok === true && Array.isArray(d.items)) setWsList(d.items);
            switchWorkspace(wsPath);
            toast.ok(t(r.created === false ? "ws.existsToast" : "ws.addedToast", { path: wsPath }));
          });
        }).catch(function (err) {
          setWsAddErr(err.message);
        }).finally(function () {
          setBusy(false);
          setBusyOp(null);
        });
      }

      // 收起「添加工作区」弹窗（右上 × / 取消按钮 / 点遮罩空白处共用）。不清
      // wsAddPath / wsAddErr：成功路径由 submitWorkspace 自己清理，取消后重开
      // 保留残值——改两个字就能续填，报错文案也留着，重开即见上次失败原因。
      function closeWsModal() {
        setWsAddOpen(false);
        setWsSuggestOpen(false);
      }

      // 收起「新建自定义 agent 角色」弹窗（右上 × / 取消按钮 / 点遮罩空白处
      // 共用）。同样不清 roleAddName / roleAddDispName / roleAddErr：取消重开
      // 保留残值续填。
      function closeRoleAddModal() {
        setRoleAddOpen(false);
      }

      // 收起「重命名自定义角色」弹窗（右上 × / 取消按钮 / 点遮罩空白处 /
      // Esc 共用）。同样不清 roleRenameVal / roleRenameErr：取消重开保留
      // 残值续填，重开时由 renameRole 重置（预填旧名 + 清错误行）。
      function closeRoleRenameModal() {
        setRoleRenameFor(null);
      }

      // 弹窗 / 「更多」菜单的 Esc 分层拦截：捕获阶段先于 PageShell 的冒泡监听
      // 触发，stopPropagation 之后页面级关页逻辑不再收到该事件。优先级：更多
      // 菜单 > 弹窗；弹窗里建议下拉还开着时先只收下拉，再按一次才收弹窗。
      // 确认弹窗（confirmCtrl）不在本链里——它的 Esc 由 86 的 ConfirmLayer
      // 自带捕获级监听处理（注册在本监听之后，本监听只在自己弹窗开着时才
      // stopPropagation，互不踩踏）。
      useEffect(function () {
        var onKey = function (e) {
          if (!e || e.key !== "Escape") return;
          if (wsMenuOpen) { e.stopPropagation(); setWsMenuOpen(false); return; }
          if (wsAddOpen) {
            e.stopPropagation();
            if (wsSuggestOpen) setWsSuggestOpen(false);
            else setWsAddOpen(false);
          }
          if (roleAddOpen) { e.stopPropagation(); closeRoleAddModal(); }
          if (roleRenameFor) { e.stopPropagation(); closeRoleRenameModal(); }
        };
        document.addEventListener("keydown", onKey, true);
        return function () { document.removeEventListener("keydown", onKey, true); };
      }, [wsAddOpen, wsSuggestOpen, wsMenuOpen, roleAddOpen, roleRenameFor]);

      // 「更多」菜单的外点关闭：目标不在菜单本体、也不在「更多」按钮内就收起。
      // 不 stopPropagation——正常点击照常生效；菜单项与「更多」按钮自身的
      // onClick 已各自收菜单，这里只兜「点面板其它地方」这一种情况。
      useEffect(function () {
        if (!wsMenuOpen) return;
        var onDocClick = function (e) {
          var t = e && e.target;
          if (t && typeof t.closest === "function" && t.closest(".omd-tabMenu, .omd-tabMore")) return;
          setWsMenuOpen(false);
        };
        document.addEventListener("click", onDocClick, true);
        return function () { document.removeEventListener("click", onDocClick, true); };
      }, [wsMenuOpen]);

      // 标签行宽度观察：就绪后先量一次行宽，再挂 ResizeObserver 跟随窗口缩放、
      // 侧栏开合等布局变化。老环境没有 ResizeObserver 就止步于这一次测量，
      // 收纳个数停在兜底值（WS_TABS_FALLBACK_COUNT），交互不缺失只是不自适应。
      useEffect(function () {
        if (!ready) return;
        var row = tabsRowRef.current;
        if (!row) return;
        var measure = function () { setTabsRowWidth(row.clientWidth); };
        measure();
        if (typeof ResizeObserver !== "function") return;
        var ro = new ResizeObserver(measure);
        ro.observe(row);
        return function () { ro.disconnect(); };
      }, [ready]);

      // 装填计算：先从测量层收一轮实测宽度（data-ws-key → offsetWidth），再按
      // 「全局默认必放、工作区按显示顺序逐个尝试」做前缀和装填，算出直接露出
      // 的 tab 个数。行宽为 0 或某行宽度还没量到（首帧）就维持现值等下一轮——
      // 首帧 wsFitCount 仍是兜底 5，宽度到位后这里修正，可能轻微跳变，可接受。
      useEffect(function () {
        if (!ready) return;
        var layer = tabsMeasureRef.current;
        if (layer) {
          var nodes = layer.querySelectorAll("[data-ws-key]");
          for (var i = 0; i < nodes.length; i++) {
            tabWidthsRef.current[nodes[i].getAttribute("data-ws-key")] = nodes[i].offsetWidth;
          }
        }
        var widths = tabWidthsRef.current;
        var globalW = widths.__global__ || 0;
        var addW = widths.__add__ || 0;
        var moreW = widths.__more__ || 0;
        if (!globalW || !addW || !tabsRowWidth) return; // 测量未就绪：维持现值
        var order = wsDisplayOrderOf(workspaceRowsOf(data, wsList), activeWs);
        // gap 4px、行内边距 2px×2，再留 8px 安全余量抵消「更多」计数徽标的
        // 位数差与亚像素取整。
        var GAP = 4, SAFETY = 8;
        var avail = tabsRowWidth - 4 - SAFETY;
        var prefix = [0];
        for (var j = 0; j < order.length; j++) {
          var w = widths[order[j].path] || 0;
          if (!w) return; // 某行还没量到（首帧）：等下一轮，别算出缩水值
          prefix.push(prefix[j] + w);
        }
        var N = order.length, k = 0;
        while (k < N) {
          var next = k + 1;
          // 放进 next 个工作区时整行要摆：全局默认 + 这 next 个 + 「＋」，
          // 还有装不下的（next < N）就再为「更多」预留一位；间隙数 = 项数 - 1。
          var need = globalW + prefix[next] + addW + (next < N ? moreW : 0) + GAP * (1 + next + (next < N ? 1 : 0));
          if (need > avail) break;
          k = next;
        }
        setWsFitCount(k);
      }, [ready, tabsRowWidth, wsWidthKey]);

      // 模型目录：与 loadState 并行拉一次（目录发现可能稍慢，属正常；失败不
      // 阻塞面板，只把角色专用模型降级为双 input 手输）。请求错误 / ok:false /
      // 响应格式异常都归入降级，原因一句话留在 modelGroupsErr。
      var loadModels = useCallback(function () {
        api("models").then(function (d) {
          var groups = d && Array.isArray(d.groups) ? d.groups : null;
          if (!d || d.ok !== true || !groups) throw new Error(t("models.listBadResponse"));
          setModelGroups(groups);
          setModelGroupsOk(true);
          setModelGroupsErr("");
        }).catch(function (err) {
          setModelGroupsOk(false);
          setModelGroupsErr(err.message);
        });
      }, [api]);

      useEffect(loadModels, [loadModels]);

      // 版本提示：面板挂载后异步拉一次 /api/paoding/version（api 助手无 body
      // 即 GET，与首屏 state/models 并行、不阻塞渲染；服务端带 1 小时缓存且
      // 绝不 5xx）。失败静默：不设 error 状态——检测只是锦上添花，网络不通、
      // 接口异常都不该打扰面板；error/latest 皆空时 versionRowOf 也不渲染。
      var loadVersion = useCallback(function () {
        api("version").then(function (d) {
          if (d && typeof d.current === "string" && d.current && typeof setVerInfo === "function") setVerInfo(d);
        }).catch(function () { /* 静默：版本检测失败不影响面板 */ });
      }, [api]);

      useEffect(loadVersion, [loadVersion]);

      // 滚动请求：preview 需等条件渲染挂载后生效（effect 在 commit 后运行），top 立即生效。
      useEffect(function () {
        if (!scrollReq) return;
        var el = scrollReq === "preview" ? previewRef.current : rootRef.current;
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
        setScrollReq(null);
      }, [scrollReq, preview]);

      function setRoleTools(name, tool, on) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          var list = next.roles[name].tools;
          if (on && list.indexOf(tool) === -1) list.push(tool);
          if (!on) next.roles[name].tools = list.filter(function (t) { return t !== tool; });
          return next;
        });
      }

      function setMainExtra(tool, on) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          if (on && next.main_agent_extra.indexOf(tool) === -1) next.main_agent_extra.push(tool);
          if (!on) next.main_agent_extra = next.main_agent_extra.filter(function (t) { return t !== tool; });
          return next;
        });
      }

      function setMainRemove(tool, on) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.main_agent_remove = next.main_agent_remove || [];
          if (on && next.main_agent_remove.indexOf(tool) !== -1) next.main_agent_remove = next.main_agent_remove.filter(function (t) { return t !== tool; });
          if (!on && next.main_agent_remove.indexOf(tool) === -1) next.main_agent_remove.push(tool);
          return next;
        });
      }

      function setMainSkill(skill, on) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.main_agent_skills = next.main_agent_skills || [];
          if (on && next.main_agent_skills.indexOf(skill) === -1) next.main_agent_skills.push(skill);
          if (!on) next.main_agent_skills = next.main_agent_skills.filter(function (s) { return s !== skill; });
          return next;
        });
      }

      function setMainSkillInline(skill, on) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.main_agent_skills_inline = next.main_agent_skills_inline || [];
          if (on && next.main_agent_skills_inline.indexOf(skill) === -1) next.main_agent_skills_inline.push(skill);
          if (!on) next.main_agent_skills_inline = next.main_agent_skills_inline.filter(function (s) { return s !== skill; });
          return next;
        });
      }

      function setSkill(skill, role, on) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          var picked = next.skills[skill] || [];
          if (on && picked.indexOf(role) === -1) picked.push(role);
          if (!on) picked = picked.filter(function (r) { return r !== role; });
          if (picked.length) next.skills[skill] = picked;
          else delete next.skills[skill];
          return next;
        });
      }

      // 主 persona 尾部追加（main_agent_persona_extra）写入：
      // 全空 → ''（明确清空，不追加任何内容）；与默认常量一致 → null（= 用默认常量，
      // 代码里 DEFAULT_MAIN_AGENT_PERSONA_EXTRA 演进时自动跟随）；其余 → 用户覆盖文本。
      function setMainPersonaExtra(raw) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          var v = String(raw || "").replace(/[ \t\r\n]+$/, "");
          var def = (data && data.mainPersonaExtraDefault) || "";
          if (v.trim() === "") next.main_agent_persona_extra = "";
          else next.main_agent_persona_extra = v === def ? null : v;
          return next;
        });
      }

      function restoreMainPersonaExtra() {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.main_agent_persona_extra = null; // null = 用默认常量
          return next;
        });
        setExtraRev(extraRev + 1); // 重挂 textarea，defaultValue 重新取默认文本
      }

      // 「新建自定义 agent 角色」三件套（原原生 prompt 实现改为模态框，
      // 弹窗本体见下方 roleAddModalOf）：open 开弹窗，close 收起，submit
      // 做校验 + 创建。校验失败走弹窗内错误行，不再用原生弹窗 / toast。
      function openRoleAddModal() {
        setRoleAddErr(""); // 上次失败原因开弹窗即清；roleAddName / roleAddDispName
        // 故意不清——与 closeWsModal「取消保留残值」同语义，重开接着上次输入续填。
        setRoleAddOpen(true);
      }

      function submitRoleAdd() {
        var name = String(roleAddName || "").trim();
        // 空名静默吞掉：确认按钮在空值时本来就 disabled，这里只兜输入框直接
        // 按 Enter 的路径（与旧 prompt 实现的 if (!name) return 同语义）。
        if (name === "") return;
        if (!/^[a-z][a-z0-9_-]{1,31}$/.test(name)) { setRoleAddErr(t("panel.roleNameInvalid")); return; }
        // 内置名不可经「新建」再造：已删除（不在 roles、在 roles_remove）的
        // 内置名在此拦截并引导走恢复区，避免同一内置名同时出现在卡片流与
        // 「已删除的内置角色」恢复区；仍正常存在的内置名由下方「已存在」命中。
        if (DEFAULT_ROLES.indexOf(name) !== -1) { setRoleAddErr(t("panel.roleNameBuiltin", { name: name })); return; }
        // 已存在检查从 setAssign updater 挪到外层：报错要走弹窗内错误行，
        // setState 副作用不能塞进 updater；闭包 assign 与点击时刻一致，双击
        // 极端场景下重复创建也只是同形状覆盖，幂等无害。
        if (assign.roles[name]) { setRoleAddErr(t("panel.roleExists", { name: name })); return; }
        // 显示名校验与 roleTitleBlock 的 commitRoleName 同源（不含 \r \n、
        // trim 后 ≤60、空 = null）：新建时就把显示名写进出厂形状，省得建完
        // 再去卡片里补一枪。报错走弹窗内错误行（不 toast）——此刻弹窗还开着，
        // 错误行就贴在输入框下面，比 toast 更贴输入现场。
        var dispRaw = String(roleAddDispName == null ? "" : roleAddDispName);
        if (/[\r\n]/.test(dispRaw)) { setRoleAddErr(t("panel.dispNameNewline")); return; }
        var dispTrim = dispRaw.trim();
        if (dispTrim.length > 60) { setRoleAddErr(t("panel.dispNameTooLong")); return; }
        var disp = dispTrim === "" ? null : dispTrim; // 空 / 纯空白 = null：事件流标题回落 toolName
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          // 新角色全字段出厂形状：与 buildAssignments / restoreBuiltinRole 条目一致
          //（model/provider 置 null = 跟随主 agent 当前模型；background_mode
          // 用弹窗单选值，字面量 'one-shot' | 'continuable'；start_mode 用弹窗
          // 单选值，字面量 'fresh' | 'fork'，决定委派块块级 provider 行）。name
          // 是可选显示名（null = 用 toolName 当标题），不再恒 null。
          next.roles[name] = {
            persona: null,
            name: disp,
            model: null,
            provider: null,
            start_mode: roleAddStartMode,
            background_mode: roleAddBgMode,
            // 出厂 tools 默认全选 = 核心工具面（customCoreToolsOf：restrictBase
            // 去四个委派名与 mcp__ 工具）+ host 检测库存。两集合不相交，无需去重
            //（render 侧 roleCandidateTools 拼候选时自带去重兜底）。
            tools: customCoreToolsOf(data).concat((data && data.inventory) || []),
          };
          return next;
        });
        setRoleAddOpen(false);
        setRoleAddName("");
        setRoleAddDispName("");
        setRoleAddBgMode("one-shot"); // 成功提交即复位出厂默认（取消重开才保留残值）
        setRoleAddStartMode("fresh"); // 成功提交即复位出厂默认（取消重开才保留残值）
        setRoleAddErr("");
        toast.ok(t("panel.roleAddedToast", { name: name }));
      }

      // 自定义角色改名（toolName = 委派调用名）：名称是身份键，改它要联动
      // 迁移 skills 里的角色引用（skills.<技能> = [角色名…]）。roles 键按原
      // 顺序重建（旧名位置原位替换）；校验与新建同源（2-32 位小写字母/数字/
      // 下划线/连字符），内置名 / 已存在的名字一律拦。只改当前视角的
      // assignments——工作区视角改的是该工作区条目，别的视角不动（与编辑
      // 语义一致）。应用后生成侧换 delegation-<新名> 委派块，旧调用名消失，
      // 需重启 / 新会话生效。
      // 原原生 prompt 实现改为模态框三件套（弹窗本体见 72 片段的
      // roleRenameModalOf）：open 开窗预填旧名，close 收起，submit 走校验链。
      // 校验失败走弹窗内错误行，不再 toast。
      function renameRole(name) {
        setRoleRenameVal(name); // 预填当前名：多数场景只改一两个字
        setRoleRenameErr("");
        setRoleRenameFor(name);
      }

      function submitRoleRename() {
        var name = roleRenameFor; // 旧名（身份键）
        var v = String(roleRenameVal || "").trim();
        // 未改动：原 prompt 下按 Enter 即关窗（只是没改名），这里对齐——直接收起。
        if (v === name) { closeRoleRenameModal(); return; }
        if (!/^[a-z][a-z0-9_-]{1,31}$/.test(v)) { setRoleRenameErr(t("panel.roleNameInvalid")); return; }
        if (DEFAULT_ROLES.indexOf(v) !== -1) { setRoleRenameErr(t("panel.roleRenameBuiltin", { name: v })); return; }
        // 已存在检查从 setAssign updater 挪到外层（与 submitRoleAdd 同款）：
        // 报错要走弹窗内错误行，setState 副作用不能塞进 updater；闭包 assign
        // 与点击时刻一致。
        if (assign.roles[v]) { setRoleRenameErr(t("panel.roleExists", { name: v })); return; }
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          var roles = {};
          Object.keys(next.roles).forEach(function (k) { roles[k === name ? v : k] = next.roles[k]; });
          next.roles = roles;
          Object.keys(next.skills || {}).forEach(function (sk) {
            var arr = next.skills[sk];
            if (Array.isArray(arr) && arr.indexOf(name) !== -1) {
              next.skills[sk] = arr.map(function (r) { return r === name ? v : r; });
            }
          });
          return next;
        });
        // 卡片开合状态跟着换键（旧键遗留无碍，顺手清干净）
        setOpenMap(function (m) {
          if (!(name in m)) return m;
          var c = Object.assign({}, m);
          c[v] = c[name];
          delete c[name];
          return c;
        });
        closeRoleRenameModal();
        setRoleRenameVal("");
        setRoleRenameErr("");
        toast.ok(t("panel.roleRenamedToast", { old: name, new: v }));
      }

      function removeRole(name) {
        // 原原生 confirm 改通用确认弹窗：删除属破坏性操作，danger 红底确认钮。
        confirmCtrl.ask({
          title: t("panel.delCustomRoleTitle"),
          body: t("panel.delCustomRoleBody", { name: name }),
          danger: true,
          confirmText: t("common.confirmDelete"),
          onConfirm: function () {
            setAssign(function (prev) {
              var next = JSON.parse(JSON.stringify(prev));
              delete next.roles[name];
              Object.keys(next.skills).forEach(function (s) {
                next.skills[s] = next.skills[s].filter(function (r) { return r !== name; });
              });
              return next;
            });
          },
        });
      }

      // 内置角色删除：roles 删 key + skills 引用剔除 + roles_remove 记名（去重）。
      // 后端语义：roles_remove 里的内置名 = 已删除（卡片消失、生成不再委派），
      // 可经 restoreBuiltinRole 恢复；自定义角色删除语义不变（只删 roles key，不进 roles_remove）。
      function removeBuiltinRole(name) {
        // 原原生 confirm 改通用确认弹窗；文案含恢复引导（多行由
        // pd-modalText 的 pre-line 保留换行），danger 红底确认钮。
        confirmCtrl.ask({
          title: t("panel.delBuiltinRoleTitle"),
          body: t("panel.delBuiltinRoleBody", { name: name }),
          danger: true,
          confirmText: t("common.confirmDelete"),
          onConfirm: function () {
            setAssign(function (prev) {
              var next = JSON.parse(JSON.stringify(prev));
              delete next.roles[name];
              Object.keys(next.skills).forEach(function (s) {
                next.skills[s] = next.skills[s].filter(function (r) { return r !== name; });
              });
              next.roles_remove = next.roles_remove || [];
              if (next.roles_remove.indexOf(name) === -1) next.roles_remove.push(name);
              return next;
            });
          },
        });
      }

      // 内置角色恢复：roles_remove 除名 + 重建角色。工具面取内置默认 allow
      // （data.blocks[name]），不沿用删前自定义配置——恢复即出厂默认，简化处理。
      // 显示名同样置 null（出厂默认），重建条目与 buildAssignments 形状一致。
      // 专用模型 / provider 同理置 null：恢复 = 回到「跟随主 agent 当前模型」，
      // 不保留删前的模型固定配置。start_mode 置 'fresh'、background_mode 置
      // 'one-shot'（出厂缺省）。
      function restoreBuiltinRole(name) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.roles_remove = (next.roles_remove || []).filter(function (r) { return r !== name; });
          var defTools = (data && data.blocks && data.blocks[name]) || [];
          next.roles[name] = { persona: null, name: null, model: null, provider: null, start_mode: "fresh", background_mode: "one-shot", tools: defTools.slice() };
          return next;
        });
      }

      // 场景模板一键切换：只改 roles_remove 与 main_agent_extra（见
      // applyScenarioTemplate），点的是本地 assign、不自动保存——预览随 assign
      // 变更由既有失效逻辑自动作废，toast 明示「保存并应用后生效」。
      function applyTemplateClick(tpl) {
        if (!assign) return;
        setAssign(function (prev) {
          return applyScenarioTemplate(prev, tpl, (data && data.inventory) || []);
        });
        toast.ok(t("panel.tplAppliedToast", { label: t(tpl.label) }));
      }

      function doPreview() {
        if (!assign) return;
        var reqAssign = assign;
        setBusy(true);
        setBusyOp("preview");
        setPreview(null);
        setWarnState(null); // 旧一轮的提示条目随新预览请求一并清掉（失败也不留陈账）
        // workspace 透传当前配置对象（null = 全局默认），服务端据此选生成落点。
        api("preview", { assignments: reqAssign, workspace: activeWsRef.current }).then(function (r) {
          if (assignRef.current !== reqAssign) return; // 生成期间配置已改：结果过期，不挂旧预览
          setPreview(r);
          setWarnState({ source: "preview", items: Array.isArray(r.warnings) ? r.warnings : [] });
          setScrollReq("preview"); // 预览成功后自动滚动定位到预览生成区
        }).catch(function (err) {
          toast.err(err.message);
          // 预览失败（如零工具角色 422）通常伴随体检说明：卡片给出每条原因，
          // 比 toast 一行错误更可行动。
          if (Array.isArray(err.warnings) && err.warnings.length) {
            setWarnState({ source: "preview", items: err.warnings });
          }
        }).finally(function () {
          setBusy(false);
          setBusyOp(null);
        });
      }

      // 预览时效：assign 一变即作废已挂出的预览——预览文本对应生成时刻的目标
      // 配置，继续挂着「✅ 生成成功」只会误导（switchWorkspace 自带
      // setPreview(null) 只覆盖切视角，这里兜住其余一切编辑路径；生成中的
      // 请求由 doPreview 里的 assignRef 快照比对作废）。检查提示卡里 preview
      // 源的条目描述的是同一次生成的产物，随预览一并作废；apply 源的描述的是
      // 已落盘结果，不受编辑影响，保留到下一次预览 / 应用。
      useEffect(function () {
        setPreview(null);
        setWarnState(function (prev) {
          return prev && prev.source === "preview" ? null : prev;
        });
      }, [assign]);

      function doApply() {
        if (!assign) return;
        var wsPath = activeWsRef.current;
        // 确认文案按配置对象分流（语义原样保留）：全局覆盖共享的 orchestrator
        // 预设（现状文案）；工作区落独立预设、只并进 workspaces 段，全局预设
        // 不受影响。写预设非破坏性操作，danger 不置位（主色确认钮）。
        // 确认文案按配置对象分流（语义原样保留）：全局覆盖共享的 orchestrator
        // 预设（现状文案）；工作区落独立预设、只并进 workspaces 段，全局预设
        // 不受影响。写预设非破坏性操作，danger 不置位（主色确认钮）。
        confirmCtrl.ask({
          title: t("panel.applyTitle"),
          body: wsPath ? t("panel.applyBodyWs") : t("panel.applyBodyGlobal"),
          danger: false,
          confirmText: t("panel.applyConfirm"),
          onConfirm: function () {
            setBusy(true);
            setBusyOp("apply");
            api("apply", { assignments: assign, workspace: wsPath }).then(function (r) {
              var notes = (r.roleResults || []).map(function (x) {
                return x.role + ": " + x.intent.length + " → " + x.kept.length;
              });
              var summary = notes.join(t("common.listSep")) + t("common.period");
              // 体检结果挂卡展示；warn/error 在场时成功 toast 降为 warn 档点一句
              // 「见下方」（成功 toast 的既有信息——preset id / 生效说明——不丢，
              // 并进 warn 文案），全 info / 无条目保持原成功 toast。
              var warnItems = Array.isArray(r.warnings) ? r.warnings : [];
              setWarnState({ source: "apply", items: warnItems });
              var badCount = warnItems.filter(function (w) {
                return w && (w.level === "error" || w.level === "warn");
              }).length;
              var warnTail = t("panel.warnTail", { n: warnItems.length });
              // 全局应用成功：页头瘦身统计改按本次提交配置（apply 响应自带
              // slim，与落盘内容同口径）；工作区应用不动全局配置，下方 state
              // 回拉自带 slim，不在额外设值。
              if (!wsPath && r && r.slim && typeof setSlimInfo === "function") setSlimInfo(r.slim);
              if (wsPath) {
                // 工作区应用：点明生成的 preset id，提示去预设选择器选用（工作区
                // 预设不会自动成为默认，须在新建会话时显式选择）。体检 bad 时
                // summary 槽位换 warnTail（沿用原口径：角色明细让位给检查提示）。
                var wsMsg = t("panel.appliedWs", { id: r.presetId || "orchestrator-<slug>", summary: badCount > 0 ? warnTail : summary })
                  + (r.staleNote ? t("panel.staleReapply") : "");
                if (badCount > 0) toast.warn(wsMsg); else toast.ok(wsMsg);
                // 服务端 apply 后已重刷状态缓存：静默拉一次，让 workspaceMeta /
                // existing.workspaces 跟上（全局路径保持旧交互，不额外拉取）。
                // 回拉重建 assign 不清 apply 源提示卡（见 warnState 注释）。
                api("state").then(function (d) {
                  setData(d);
                  setAssign(buildTargetAssignments(d, activeWsRef.current));
                  if (typeof setSlimInfo === "function") setSlimInfo(d && d.slim ? d.slim : null);
                }).catch(function () { /* 静默：落盘已成功，仅展示层暂旧 */ });
              } else {
                var gMsg = t("panel.appliedGlobal", { summary: badCount > 0 ? warnTail : summary })
                  + (r.staleNote ? t("panel.staleRestart") : t("panel.effectiveRestart"));
                if (badCount > 0) toast.warn(gMsg); else toast.ok(gMsg);
              }
              // 显示名 / 角色名单可能变了：事件流委派行键控注册跟着刷新（行组件
              // 标题读 delegateMeta，刷新即可见，无需重开会话）。
              refreshDelegateRows();
            }).catch(function (err) {
              toast.err(err.message);
              // 失败（如零工具角色 422）也把体检说明挂卡：错误原因逐条可读，
              // 修起来有据可依。落盘未发生，卡描述的是「这次为什么没成」。
              if (Array.isArray(err.warnings) && err.warnings.length) {
                setWarnState({ source: "apply", items: err.warnings });
              }
            }).finally(function () {
              setBusy(false);
              setBusyOp(null);
            });
          },
        });
      }

      function doRescan() {
        setBusy(true);
        setBusyOp("rescan");
        setScrollReq("top"); // 立即滚动回面板顶部（不等接口返回，结果经 toast 播报）
        api("rescan", {}).then(function (d) {
          setData(d);
          setAssign(buildTargetAssignments(d, activeWsRef.current));
          // 重扫后的 state 自带瘦身统计，页头一行同步刷新（字段缺失则隐藏）。
          if (typeof setSlimInfo === "function") setSlimInfo(d && d.slim ? d.slim : null);
          // 回调参数 d 即重扫后的新 state，直接报数字，补回原徽标条的信息量
          toast.ok(t("panel.rescanned", { n: (d.inventory || []).length, m: (d.skills || []).length }));
        }).catch(function (err) { toast.err(err.message); }).finally(function () {
          setBusy(false);
          setBusyOp(null);
        });
      }

      function toggleRole(name) {
        setOpenMap(function (prev) {
          var next = Object.assign({}, prev);
          next[name] = !(name in prev ? prev[name] : defaultOpenOf(name));
          return next;
        });
      }

      function togglePersona(name) {
        setPersonaMap(function (prev) {
          var next = Object.assign({}, prev);
          next[name] = !prev[name];
          return next;
        });
      }

      // ── 渲染 ───────────────────────────────────────────────────────────────

      // 配置对象标签页（tablist）：「全局默认」+ 各工作区（preset 已生成的
      // 前缀小圆点标记，元数据来自 state.workspaceMeta）+「更多」下拉 + 末尾
      // 「＋ 添加工作区」按钮（点击打开输入弹窗，弹窗由 wsModalOf 渲染）。露出
      // 几个 tab 不再是固定数：ConfigPanel 的装填算法按标签行实宽算出
      // wsFitCount，本函数照它拆可见 / 隐藏两段；行内另挂一个常驻隐藏测量层
      // （omd-tabsMeasure）供算法读每个 tab 的自然宽度，测量未就绪时
      // wsFitCount 停在兜底值 5（WS_TABS_FALLBACK_COUNT）。tab 点击语义与旧
      // pill 行一致 = switchWorkspace（逻辑不动，只换了皮）。
      function workspaceBarOf() {
        var rows = workspaceRowsOf(data, wsList);
        var meta = (data && data.workspaceMeta) || {};
        var existingWs = (data && data.existing && data.existing.workspaces) || {};
        // 可见 / 隐藏拆分：显示顺序里激活工作区恒排最前，它天然留在可见区；
        // 下标落在 wsFitCount 之后的收进「更多」菜单。
        var order = wsDisplayOrderOf(rows, activeWs);
        var visible = order.slice(0, Math.min(order.length, wsFitCount));
        var hidden = order.slice(visible.length);
        var tabs = [h("button", {
          key: "__global__",
          type: "button",
          role: "tab",
          "aria-selected": activeWs === null ? "true" : "false",
          className: "omd-tab" + (activeWs === null ? " omd-tabActive" : ""),
          title: t("ws.globalTabTip"),
          onClick: function () { switchWorkspace(null); },
        }, h("span", { className: "omd-tabText" }, t("ws.globalTab")))];
        tabs = tabs.concat(visible.map(function (row) {
          var kind = wsTagOf(existingWs, meta, row.path);
          var tip = wsTabTipOf(row, meta, existingWs);
          return h("button", {
            key: row.path,
            type: "button",
            role: "tab",
            "aria-selected": activeWs === row.path ? "true" : "false",
            className: "omd-tab" + (activeWs === row.path ? " omd-tabActive" : ""),
            title: tip,
            onClick: function () { switchWorkspace(row.path); },
          },
            h("span", { className: "omd-tabText" }, wsLabelOf(row)),
            h("span", { className: "omd-tabTag omd-tabTag" + kind.charAt(0).toUpperCase() + kind.slice(1) },
              wsTagTextOf(kind)),
            row.sessionCount != null ? h("span", { className: "omd-tabCount" }, t("ws.sessionCount", { n: row.sessionCount })) : null);
        }));
        // 「更多」入口：仅在确有收进来的工作区时出现。正常路径激活项按显示
        // 顺序排最前、必然可见，这里仍兜底判一次——首帧 wsFitCount 还是兜底
        // 值时激活项可能暂居 hidden，就双挂 omd-tabMoreActive + omd-tabActive
        // 借用激活视觉（主色 + 激活条，CSS 不另画一份）。
        var hiddenActive = false;
        for (var k = 0; k < hidden.length; k++) {
          if (hidden[k].path === activeWs) { hiddenActive = true; break; }
        }
        if (hidden.length > 0) {
          tabs.push(h("button", {
            key: "__more__",
            type: "button",
            className: "omd-tab omd-tabMore" + (hiddenActive ? " omd-tabMoreActive omd-tabActive" : ""),
            title: t("ws.moreTip", { n: hidden.length }),
            "aria-haspopup": "listbox",
            "aria-expanded": wsMenuOpen ? "true" : "false",
            onClick: function () { setWsMenuOpen(!wsMenuOpen); },
          },
            h("span", { className: "omd-tabText" }, t("ws.more")),
            h("span", { className: "omd-tabMoreCount" }, String(hidden.length))));
        }
        // 末尾「＋ 添加工作区」：与 tab 同尺寸的弱化按钮（ghost），点击打开输入弹窗。
        tabs.push(h("button", {
          key: "__add__",
          type: "button",
          className: "omd-tab omd-tabAdd",
          title: t("ws.addTabTip"),
          disabled: busy,
          onClick: function () { setWsAddOpen(true); setWsAddErr(""); },
        },
          h("span", { className: "omd-groupIcon" }, ic(P.IconPlusOutline16, 14)),
          h("span", { className: "omd-tabText" }, t("ws.addTab"))));
        // 测量层单件：与真实 tab 同款 .omd-tab 类，自然宽度因此一致；不进
        // a11y 树、不可聚焦，只负责被装填算法 offsetWidth 量。
        function measureTabOf(key, label) {
          return h("button", { type: "button", "data-ws-key": key, className: "omd-tab", tabIndex: -1 },
            h("span", { className: "omd-tabText" }, label));
        }
        // 行包裹层 omd-tabsRow：给「更多」下拉做锚点——挂在整列容器上的话
        // top:100% 会落到提示行下面，视觉上和标签行脱节；锚在行包裹层上，
        // 下拉恰好贴着标签行的下边框展开。
        return h("div", { className: "omd-wsTabs" },
          h("div", { className: "omd-tabsRow" },
          h("div", { className: "omd-tabs", role: "tablist", "aria-label": t("ws.tablistLabel"), ref: tabsRowRef }, tabs),
          // 宽度测量层：常驻渲染（不随 wsFitCount 变），挪出视口且不可见，只把
          // 各 tab 的自然宽度喂给装填算法。「更多」原型计数固定写 99 按两位数
          // 算宽，与装填里的 SAFETY 余量搭配。
          h("div", { className: "omd-tabsMeasure", ref: tabsMeasureRef, "aria-hidden": "true" },
            measureTabOf("__global__", t("ws.globalTab")),
            order.map(function (row) {
              var m = meta[row.path];
              var mk = wsTagOf(existingWs, meta, row.path);
              return h("button", { key: row.path, type: "button", "data-ws-key": row.path, className: "omd-tab", tabIndex: -1 },
                h("span", { className: "omd-tabText" }, wsLabelOf(row)),
                h("span", { className: "omd-tabTag omd-tabTag" + mk.charAt(0).toUpperCase() + mk.slice(1) },
                  wsTagTextOf(mk)),
                row.sessionCount != null ? h("span", { className: "omd-tabCount" }, t("ws.sessionCount", { n: row.sessionCount })) : null);
            }),
            h("button", { type: "button", "data-ws-key": "__more__", className: "omd-tab omd-tabMore", tabIndex: -1 },
              h("span", { className: "omd-tabText" }, t("ws.more")),
              h("span", { className: "omd-tabMoreCount" }, "99")),
            h("button", { type: "button", "data-ws-key": "__add__", className: "omd-tab omd-tabAdd", tabIndex: -1 },
              h("span", { className: "omd-groupIcon" }, ic(P.IconPlusOutline16, 14)),
              h("span", { className: "omd-tabText" }, t("ws.addTab")))),
          // 「更多」下拉：菜单项信息结构与 tab 同款（小圆点 / 名称 / 会话数，
          // title 拼法也一致），点击直接切过去。role=listbox/option 表达
          // 「从清单里选一个配置对象」的语义，aria-selected 标当前项。
          wsMenuOpen && hidden.length > 0
            ? h("div", { className: "omd-tabMenu", role: "listbox", "aria-label": t("ws.menuLabel") },
                hidden.map(function (row) {
                  var kind = wsTagOf(existingWs, meta, row.path);
                  var tip = wsTabTipOf(row, meta, existingWs);
                  return h("button", {
                    key: row.path,
                    type: "button",
                    role: "option",
                    "aria-selected": activeWs === row.path ? "true" : "false",
                    className: "omd-tabMenuItem" + (activeWs === row.path ? " omd-tabMenuItemActive" : ""),
                    title: tip,
                    onClick: function () { setWsMenuOpen(false); switchWorkspace(row.path); },
                  },
                    h("span", { className: "omd-tabText" }, wsLabelOf(row)),
                    h("span", { className: "omd-tabTag omd-tabTag" + kind.charAt(0).toUpperCase() + kind.slice(1) },
                      wsTagTextOf(kind)),
                    row.sessionCount != null ? h("span", { className: "omd-tabCount" }, t("ws.sessionCount", { n: row.sessionCount })) : null);
                }))
            : null),
          h("div", { className: "omd-hint" },
            t("ws.barHint")));
      }

      // 「添加工作区」弹窗：旧版是 tab 条下方的内联展开行，改为模态框输入。
      // 右上 × / 取消 / 点遮罩空白处 / Esc 都只收弹窗（Esc 分层见上方捕获级
      // useEffect）；确认按钮与输入框 Enter 走 submitWorkspace——成功路径自己
      // 关弹窗、刷新列表并切到新工作区，这里不重复收尾。
      function wsModalOf() {
        if (!wsAddOpen) return null;
        // 建议行：候选按当前输入子串过滤（下拉展开才算）；没拉到候选或无匹配
        // 时是空数组，下拉整块不渲染。（随旧内联行整体迁入弹窗）
        var wsSuggestRows = wsSuggestOpen ? wsSuggestionsOf(wsCands, wsAddPath) : [];
        return h("div", { className: "pd-modalMask",
            // 只点遮罩空白处才收（mousedown 真正落在遮罩上），在卡片内按下拖选不误关
            onMouseDown: function (e) { if (e.target === e.currentTarget) closeWsModal(); } },
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": t("ws.addTitle") },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, t("ws.addTitle")),
              h("button", { type: "button", className: "pd-modalClose", "aria-label": t("common.close"), onClick: closeWsModal },
                h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              h("label", { className: "pd-modalLabel" }, t("ws.pathLabel")),
              h("div", { className: "omd-wsSuggestWrap" },
                h("input", {
                  type: "text",
                  className: "omd-nameInput omd-wsAddInput",
                  value: wsAddPath,
                  placeholder: t("ws.pathPlaceholder"),
                  spellCheck: false,
                  autoFocus: true,
                  onFocus: function () { loadWsCands(); setWsSuggestOpen(true); },
                  onBlur: function () { setWsSuggestOpen(false); },
                  onChange: function (e) { setWsAddPath(e.target.value); setWsSuggestOpen(true); },
                  // 只认 Enter；Esc 不在这里拦——捕获级监听（见上方 useEffect）
                  // 在 document 上先截停并 stopPropagation，事件到不了 React
                  // 合成层，这里写 Escape 分支永远不会触发。
                  onKeyDown: function (e) {
                    if (e.key === "Enter") { setWsSuggestOpen(false); submitWorkspace(); }
                  },
                }),
                wsSuggestRows.length
                  ? h("div", { className: "omd-wsSuggest", role: "listbox" },
                      wsSuggestRows.map(function (c) {
                        return h("button", {
                          key: c.path,
                          type: "button",
                          className: "omd-wsSuggestItem",
                          title: c.path,
                          disabled: busy,
                          // mousedown 的默认行为会把焦点从输入框夺走，blur 先于
                          // click 把下拉卸载、点击就落空——preventDefault 掐掉它，
                          // input 保持聚焦，click 才能安稳到达建议行。
                          onMouseDown: function (e) { e.preventDefault(); },
                          onClick: function () {
                            setWsSuggestOpen(false);
                            setWsAddPath(c.path);
                            submitWorkspace(c.path);
                          },
                        },
                          h("span", { className: "omd-wsSuggestName" }, c.basename || c.path),
                          h("span", { className: "omd-wsSuggestPath" }, c.path));
                      }))
                  : null),
              wsAddErr ? statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), wsAddErr) : null,
              h("div", { className: "omd-hint" }, t("ws.pathHint"))),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", disabled: busy, onClick: closeWsModal }, t("common.cancel")),
              h(P.Button, {
                variant: "primary",
                size: "md",
                disabled: busy || String(wsAddPath).trim() === "",
                onClick: submitWorkspace,
              }, busyOp === "wsadd" ? t("ws.adding") : t("ws.addConfirm")))));
      }

      // 「新建自定义 agent 角色」弹窗：结构 / 关闭路径与「添加工作区」弹窗
      // （wsModalOf）完全一致——右上 × / 取消 / 点遮罩空白处 / Esc 都只收弹窗
      //（Esc 分层见上方捕获级 useEffect）。两字段表单的 Enter 分工：toolName
      // 框 Enter 不提交（用户多半还想填显示名），只把焦点挪到显示名框；显示
      // 名框 Enter 才走 submitRoleAdd——成功路径自己关弹窗并清残值，这里不
      // 重复收尾。新建是纯本地 setAssign 操作，无请求，按钮不挂 busy 态。
      function roleAddModalOf() {
        if (!roleAddOpen) return null;
        return h("div", { className: "pd-modalMask",
            // 只点遮罩空白处才收（mousedown 真正落在遮罩上），在卡片内按下拖选不误关
            onMouseDown: function (e) { if (e.target === e.currentTarget) closeRoleAddModal(); } },
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": t("panel.roleAddTitle") },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, t("panel.roleAddTitle")),
              h("button", { type: "button", className: "pd-modalClose", "aria-label": t("common.close"), onClick: closeRoleAddModal },
                h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              h("label", { className: "pd-modalLabel" }, t("panel.roleAddToolNameLabel")),
              h("input", {
                type: "text",
                className: "omd-nameInput",
                value: roleAddName,
                placeholder: t("panel.roleAddNamePlaceholder"),
                spellCheck: false,
                autoFocus: true,
                onChange: function (e) { setRoleAddName(e.target.value); },
                // Enter 只移焦不提交：这是两字段表单的第一段，直接提交会跳过
                // 还没填的显示名。Esc 仍不在这里拦——捕获级监听（见上方
                // useEffect）在 document 上先截停并 stopPropagation，事件到不了
                // React 合成层，这里写 Escape 分支永远不会触发。
                onKeyDown: function (e) {
                  if (e.key === "Enter") {
                    var inp = roleAddDispRef.current; // 弹窗条件渲染，此刻必已挂载；仍判空兜极端时序
                    if (inp && typeof inp.focus === "function") inp.focus();
                  }
                },
              }),
              h("label", { className: "pd-modalLabel" }, t("panel.dispNameLabel")),
              h("input", {
                ref: roleAddDispRef,
                type: "text",
                className: "omd-nameInput",
                value: roleAddDispName,
                // 占位语义与 roleTitleBlock 的 subject=toolName 一致：留空 = 事件流标题回落 toolName
                placeholder: t("panel.dispNamePlaceholder"),
                spellCheck: false,
                onChange: function (e) { setRoleAddDispName(e.target.value); },
                // 第二段的 Enter 才是提交：第一段已把焦点送到这里，用户在此按
                // Enter 即视为整个表单填完。
                onKeyDown: function (e) {
                  if (e.key === "Enter") submitRoleAdd();
                },
              }),
              // 「会话模式」单选（与角色卡 roleBgModeBlock 同款语义）：缺省一次性，
              // 选「可续」才写 background_mode: 'continuable'；提示 / 警告行内联。
              h("label", { className: "pd-modalLabel" }, t("panel.bgModeLabel")),
              h("div", { className: "omd-nameRow" },
                h("label", { className: "omd-toolItem" },
                  h("input", {
                    type: "radio",
                    className: "omd-check",
                    name: "pd-bgm-roleadd",
                    checked: roleAddBgMode !== "continuable",
                    onChange: function () { setRoleAddBgMode("one-shot"); },
                  }),
                  h("span", { className: "omd-toolName" }, t("panel.bgOneshot"))),
                h("label", { className: "omd-toolItem" },
                  h("input", {
                    type: "radio",
                    className: "omd-check",
                    name: "pd-bgm-roleadd",
                    checked: roleAddBgMode === "continuable",
                    onChange: function () { setRoleAddBgMode("continuable"); },
                  }),
                  h("span", { className: "omd-toolName" }, t("panel.bgContinuable")))),
              roleAddBgMode === "continuable"
                ? h("div", { className: "omd-hint" }, roleBgContinuableHint())
                : null,
              roleAddBgMode === "continuable" && data && data.persistenceAvailable === false
                ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), roleBgPersistenceWarn())
                : null,
              // 「启动方式」单选（与角色卡 roleStartModeBlock 同款语义）：缺省全新，
              // 选「继承对话」才写 start_mode: 'fork'（委派块块级 provider 行）。
              h("label", { className: "pd-modalLabel" }, t("panel.startModeLabel")),
              h("div", { className: "omd-nameRow" },
                h("label", { className: "omd-toolItem" },
                  h("input", {
                    type: "radio",
                    className: "omd-check",
                    name: "pd-sm-roleadd",
                    checked: roleAddStartMode !== "fork",
                    onChange: function () { setRoleAddStartMode("fresh"); },
                  }),
                  h("span", { className: "omd-toolName" }, t("panel.smFresh"))),
                h("label", { className: "omd-toolItem" },
                  h("input", {
                    type: "radio",
                    className: "omd-check",
                    name: "pd-sm-roleadd",
                    checked: roleAddStartMode === "fork",
                    onChange: function () { setRoleAddStartMode("fork"); },
                  }),
                  h("span", { className: "omd-toolName" }, t("panel.smFork")))),
              roleAddStartMode === "fork"
                ? h("div", { className: "omd-hint" },
                    t("panel.forkStartHint"))
                : null,
              roleAddErr ? statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), roleAddErr) : null,
              h("div", { className: "omd-hint" },
                t("panel.roleAddHint"))),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", onClick: closeRoleAddModal }, t("common.cancel")),
              h(P.Button, {
                variant: "primary",
                size: "md",
                disabled: String(roleAddName).trim() === "",
                onClick: submitRoleAdd,
              }, t("panel.roleAddConfirm")))));
      }

      // 「重命名自定义角色」弹窗：结构 / 关闭路径与 roleAddModalOf 一致——
      // 右上 × / 取消 / 点遮罩空白处 / Esc 都只收弹窗（Esc 分层见 70 片段的
      // 捕获级 useEffect）。单字段表单：开窗预填旧名，Enter 直接提交（重命名
      // 没有第二段）；校验失败走弹窗内错误行，成功路径由 submitRoleRename 关
      // 弹窗并清残值。改的是 toolName（身份键），显示名不在此处。
      function roleRenameModalOf() {
        if (!roleRenameFor) return null;
        return h("div", { className: "pd-modalMask",
            // 只点遮罩空白处才收（mousedown 真正落在遮罩上），在卡片内按下拖选不误关
            onMouseDown: function (e) { if (e.target === e.currentTarget) closeRoleRenameModal(); } },
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": t("panel.roleRenameTitle") },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, t("panel.roleRenameTitle")),
              h("button", { type: "button", className: "pd-modalClose", "aria-label": t("common.close"), onClick: closeRoleRenameModal },
                h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              h("label", { className: "pd-modalLabel" }, t("panel.roleRenameLabel")),
              h("input", {
                type: "text",
                className: "omd-nameInput",
                value: roleRenameVal,
                placeholder: roleRenameFor || "", // 占位即旧名（输入框已预填，占位只在清空后可见）
                spellCheck: false,
                autoFocus: true,
                onChange: function (e) { setRoleRenameVal(e.target.value); },
                // Esc 不在这里拦——捕获级监听（见 70 片段 useEffect）在 document
                // 上先截停并 stopPropagation，事件到不了 React 合成层，这里写
                // Escape 分支永远不会触发。
                onKeyDown: function (e) {
                  if (e.key === "Enter") submitRoleRename();
                },
              }),
              roleRenameErr ? statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), roleRenameErr) : null,
              h("div", { className: "omd-hint" },
                t("panel.roleRenameHint"))),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", onClick: closeRoleRenameModal }, t("common.cancel")),
              h(P.Button, {
                variant: "primary",
                size: "md",
                // 空值 / 与旧名相同都禁用确认：后者点确认只会空转收窗，禁用
                // 让按钮状态与「确实改了名」对齐。
                disabled: String(roleRenameVal).trim() === "" || String(roleRenameVal).trim() === roleRenameFor,
                onClick: submitRoleRename,
              }, t("panel.roleRenameConfirm")))));
      }

      if (!data || !assign) {
        // 面板没起来（含 state 加载失败）才走这条整页分支：失败渲染常驻错误行，
        // 不进 toast——此刻页面还没有内容可依托，错误必须一直可见。
        return h("div", { className: "pd-page" },
          error
            ? statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), error)
            : h("div", { className: "omd-loading" },
                h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16)),
                h("span", null, t("panel.loading"))));
      }

      // 技能网格数据源（主 agent 软引导/内联 + 下方角色 skills 分组共用）：
      // 工作区视角（activeWs 非空）且已拉到 wsSkills 时用「用户级 + 该工作区
      // 项目级」合并列表；全局视角 / 拉取中 / 拉取失败降级一律回落 state 的
      // 用户级技能 data.skills。gridProj 仅在合并生效时非空（项目角标据此渲染）。
      var gridSkills = activeWs !== null && Array.isArray(wsSkills) ? wsSkills : (data.skills || []);
      var gridProj = activeWs !== null && wsProjSkills ? wsProjSkills : null;

      // 技能网格作用域小字（分组标题旁）：说明当前网格覆盖的技能来源——
      // 全局 = 仅用户级技能；工作区 = 用户级 + 该工作区项目级技能。
      function skillScopeNote() {
        return h("span", { className: "omd-skillScope" },
          activeWs !== null ? t("panel.scopeWs") : t("panel.scopeGlobal"));
      }

      // 角色工具候选（三组网格共用数据源）：所有角色（内置 + 自定义）= SRC
      // allow 面 ∪ 核心工具清单 ∪ host 检测库存。内置角色在 SRC 面上再并核心
      // 工具候选——勾选才生效，默认勾选仍来自 suggested/staticBase，默认面不
      // 变；自定义角色无 SRC 基础面，自然回落核心清单（customCoreToolsOf：去
      // 四个委派名与 mcp__ 工具）。分组口径：mcp__ 前缀 → 「MCP 工具」；其余
      // 名字里在 inventory 中的 → 「插件工具」（mnemon_* 等直注册工具）；两者
      // 皆非 → 「基础工具」。全部拼接后按首次出现去重。
      function roleCandidateTools(name) {
        var base = ((data.blocks && data.blocks[name]) || []).concat(customCoreToolsOf(data));
        return base.concat(data.inventory || []).filter(function (t, i, arr) { return arr.indexOf(t) === i; });
      }

      function personaBlock(name) {
        var open = !!personaMap[name];
        return h("div", { className: "omd-persona" },
          h("button", {
            type: "button",
            className: "omd-personaToggle",
            "aria-expanded": open ? "true" : "false",
            onClick: function () { togglePersona(name); },
          },
            h("span", { className: open ? "omd-chevron omd-chevronOpen" : "omd-chevron" }, ic(P.IconChevronDownOutline14, 14)),
            h("span", null, t("panel.personaToggle")),
            h("span", { className: "omd-personaEdit" }, ic(P.IconEditOutline16, 14))),
          open ? h("div", { className: "omd-personaBody" },
            h("textarea", {
              key: "omd-persona-" + name + "-" + switchRev, // 切视角重挂：defaultValue 显示新目标的 persona
              className: "omd-textarea",
              defaultValue: assign.roles[name].persona || "",
              placeholder: t("panel.personaPlaceholder"),
              spellCheck: false,
              disabled: busy,
              onBlur: function (e) {
                setAssign(function (prev) {
                  var next = JSON.parse(JSON.stringify(prev));
                  next.roles[name].persona = e.target.value.trim() === "" ? null : e.target.value;
                  return next;
                });
              },
            }),
            h("div", { className: "omd-hint" }, t("panel.personaHint")))
          : null);
      }

      // 主 agent「人设追加」：折叠编辑器，结构与角色 personaBlock 一致。
      // textarea 显示生效文本 = 配置值 ?? 后端默认常量（mainPersonaExtraDefault）；
      // 清空保存 = ''（移除默认规则）；文本 == 默认常量时回落 null（跟随默认演进）。
      function mainPersonaExtraBlock() {
        var def = (data && data.mainPersonaExtraDefault) || "";
        var val = assign.main_agent_persona_extra == null ? def : assign.main_agent_persona_extra;
        return h("div", { className: "omd-persona" },
          h("button", {
            type: "button",
            className: "omd-personaToggle",
            "aria-expanded": extraOpen ? "true" : "false",
            onClick: function () { setExtraOpen(!extraOpen); },
          },
            h("span", { className: extraOpen ? "omd-chevron omd-chevronOpen" : "omd-chevron" }, ic(P.IconChevronDownOutline14, 14)),
            h("span", null, t("panel.extraToggle")),
            h("span", { className: "omd-personaEdit" }, ic(P.IconEditOutline16, 14))),
          extraOpen ? h("div", { className: "omd-personaBody" },
            h("textarea", {
              key: "omd-extra-" + extraRev + "-" + switchRev,
              className: "omd-textarea omd-extraArea",
              defaultValue: val,
              placeholder: t("panel.extraPlaceholder"),
              spellCheck: false,
              disabled: busy,
              onBlur: function (e) { setMainPersonaExtra(e.target.value); },
            }),
            h("div", { className: "omd-extraActions" },
              h("button", {
                type: "button",
                className: "omd-extraRestore",
                disabled: busy,
                onClick: restoreMainPersonaExtra,
              }, t("common.restoreDefault")),
              h("span", { className: "omd-extraHint" },
                t("panel.extraActionHint"))),
            h("div", { className: "omd-hint" }, t("panel.extraClearHint")))
          : null);
      }

      // 主 agent「显示名」行（main_agent_display_name）：仅替换 preset 显示名
      //（GUI 预设选择器里的名字），不动 persona 身份行——编排主 agent 的身份
      // 语义不属于可配置项，UI 不提供改名入口。默认文案
      // 「编排模式 (Orchestrator)」为后端默认常量，UI 侧硬编码做占位（后端
      // state 无该默认字段就不引，与 mainPersonaExtraDefault 处理思路一致）。
      // 写回校验与后端一致：trim 后 1-60 字符、不含 \r \n；空 = null（默认显示
      // 名，工作区预设用派生名）；非空纯空白视为非法（防误触把已有显示名静默
      // 清回默认）。
      function mainNameBlock() {
        var DEFAULT_NAME = "编排模式 (Orchestrator)";
        function commitDisplayName(raw) {
          var s = String(raw == null ? "" : raw);
          if (/[\r\n]/.test(s)) {
            toast.warn(t("panel.mainNameNewline"));
            setDisplayNameRev(displayNameRev + 1); // 重挂 input，回到上次生效值
            return;
          }
          var v = s.trim();
          if (s !== "" && v === "") {
            toast.warn(t("panel.mainNameBlank"));
            setDisplayNameRev(displayNameRev + 1);
            return;
          }
          if (v.length > 60) {
            toast.warn(t("panel.mainNameTooLong"));
            setDisplayNameRev(displayNameRev + 1);
            return;
          }
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.main_agent_display_name = v === "" ? null : v; // null = 默认显示名
            return next;
          });
          if (v === "") setDisplayNameRev(displayNameRev + 1); // 清空 = 默认：重挂显示占位
        }
        function restoreMainDisplayName() {
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.main_agent_display_name = null; // null = 默认显示名
            return next;
          });
          setDisplayNameRev(displayNameRev + 1);
        }
        return h("div", { className: "omd-mainName" },
          h("div", { className: "omd-glabel" }, t("panel.mainNameLabel")),
          h("div", { className: "omd-nameRow" },
            h("input", {
              key: "omd-displayName-" + displayNameRev + "-" + switchRev,
              type: "text",
              className: "omd-nameInput",
              defaultValue: assign.main_agent_display_name || "",
              placeholder: DEFAULT_NAME,
              spellCheck: false,
              disabled: busy,
              onBlur: function (e) { commitDisplayName(e.target.value); },
            }),
            h("button", { type: "button", className: "omd-extraRestore", disabled: busy, onClick: restoreMainDisplayName }, t("common.restoreDefault"))),
          h("div", { className: "omd-hint" },
            t("panel.mainNameHint")));
      }

      // 内置角色「显示名」input 重挂（key 技巧）：写回校验失败 / 清空回默认时
      // 让对应 input 以生效值重新挂载（defaultValue 重读）；每角色独立计数，
      // 互不牵连（其余内置角色 input 已提交的值不受影响）。
      function bumpRoleNameRev(name) {
        setRoleNameRev(function (prev) {
          var next = Object.assign({}, prev);
          next[name] = (next[name] || 0) + 1;
          return next;
        });
      }

      // 角色「专用模型 / provider」input 重挂（key 技巧）：与 roleNameRev 同款。
      // 仅降级手输模式（模型目录不可用）仍在用：校验失败 / 清空回默认时让对应
      // input 以生效值重新挂载；每角色独立计数，model 与 provider 两个 input
      // 共用同一 rev（成对重挂，不残留旧输入）。下拉模式为受控 select，无此需要。
      function bumpRoleModelRev(name) {
        setRoleModelRev(function (prev) {
          var next = Object.assign({}, prev);
          next[name] = (next[name] || 0) + 1;
          return next;
        });
      }

      // 角色「显示名」行（内置与自定义通用）：
      //   - 内置：替换默认 persona 首行身份句主语（persona 已自定义时后端
      //     忽略，仅提示），同时是事件流委派行的标题；
      //   - 自定义：后端不消费此字段（其 persona 全文自写），纯粹用作事件流
      //     委派行标题——不动 toolName / 调用名 / persona。
      // 校验与主 agent 名同源约束：trim 后 1-60 字符、不含 \r \n；
      // 空 / 纯空白 = 默认（写入 null = 事件流回落缺省标题）。
      function roleTitleBlock(name, isCustom) {
        var subject = isCustom ? name : (ROLE_DEFAULT_SUBJECT[name] || name);
        function commitRoleName(raw) {
          var s = String(raw == null ? "" : raw);
          if (/[\r\n]/.test(s)) {
            toast.warn(t("panel.roleNameNewline", { name: name }));
            bumpRoleNameRev(name); // 重挂 input，回到上次生效值
            return;
          }
          var v = s.trim();
          if (v.length > 60) {
            toast.warn(t("panel.roleNameTooLong", { name: name }));
            bumpRoleNameRev(name);
            return;
          }
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.roles[name].name = v === "" ? null : v;
            return next;
          });
          if (v === "") bumpRoleNameRev(name); // 空 / 纯空白 = 默认：重挂显示占位
        }
        return h("div", { className: "omd-mainName" },
          h("div", { className: "omd-glabel" },
            isCustom ? t("panel.roleNameLabelCustom") : t("panel.roleNameLabelBuiltin")),
          h("div", { className: "omd-nameRow" },
            h("input", {
              key: "omd-roleName-" + name + "-" + ((roleNameRev && roleNameRev[name]) || 0) + "-" + switchRev,
              type: "text",
              className: "omd-nameInput",
              defaultValue: (assign.roles[name] && assign.roles[name].name) || "",
              placeholder: subject,
              spellCheck: false,
              disabled: busy,
              onBlur: function (e) { commitRoleName(e.target.value); },
            })),
          h("div", { className: "omd-hint" },
            isCustom
              ? t("panel.roleNameHintCustom", { name: name })
              : t("panel.roleNameHintBuiltin", { subject: subject })));
      }

      // 角色「专用模型」行（内置与自定义角色通用同一组件，签名不变）：
      //   - 下拉模式（模型目录可用）：单选 select，选项 = 「跟随主 agent 当前
      //     模型」（value ""）+ 目录里每个 (provider 路由, 模型) 一项；选中目录
      //     项即成对写入 roles[name].provider + model（生成层写入委派块
      //     agentOptions，含冷恢复在内固定）。目录外的已有配置值（手编配置、
      //     目录未刷新等）以「当前配置」选项保真显示并保持选中（round-trip
      //     保护，绝不凭空消失）。
      //   - 降级模式（目录拉取失败 / ok:false / 格式异常）：回退现状的 model +
      //     provider 双 input 手输，全部原有校验保留（禁换行、≤120、空 = null、
      //     provider 单配 hint），失败原因一句话进 omd-hint，不阻塞面板其余功能。
      function roleModelBlock(name) {
        var role = assign.roles[name] || {};

        // ── 降级模式：目录不可用 → 现状双 input ───────────────────────────
        if (!modelGroupsOk) {
          var rev = (roleModelRev && roleModelRev[name]) || 0;
          function labelOf(key) { return key === "provider" ? "provider" : t("panel.modelField"); }
          function commitRoleModel(key, raw) {
            var s = String(raw == null ? "" : raw);
            if (/[\r\n]/.test(s)) {
              toast.warn(t("panel.roleModelNewline", { name: name, field: labelOf(key) }));
              bumpRoleModelRev(name); // 重挂 input，回到上次生效值
              return;
            }
            var v = s.trim();
            if (v.length > 120) {
              toast.warn(t("panel.roleModelTooLong", { name: name, field: labelOf(key) }));
              bumpRoleModelRev(name);
              return;
            }
            // 成对性检查按「本次写入后的最终值」判定（assign 为 blur 前的生效值，
            // 另一字段的已提交值已在其中），不放进 setAssign updater（保持其纯函数）。
            var cur = assign.roles[name] || {};
            var model = key === "model" ? (v === "" ? null : v) : (cur.model || null);
            var provider = key === "provider" ? (v === "" ? null : v) : (cur.provider || null);
            setAssign(function (prev) {
              var next = JSON.parse(JSON.stringify(prev));
              next.roles[name][key] = v === "" ? null : v;
              return next;
            });
            // provider 非空而 model 为空 → 允许保存（后端原样落盘），但明确提示会被忽略
            if (provider && !model) {
              toast.warn(t("panel.providerIgnored", { name: name }));
            }
            if (v === "") bumpRoleModelRev(name); // 清空 = 跟随主 agent：重挂显示占位
          }
          return h("div", { className: "omd-mainName" },
            h("div", { className: "omd-glabel" }, t("panel.roleModelLabel")),
            h("div", { className: "omd-nameRow" },
              h("input", {
                key: "omd-roleModel-" + name + "-" + rev + "-" + switchRev,
                type: "text",
                className: "omd-nameInput",
                defaultValue: role.model || "",
                placeholder: "deepseek-v4-pro",
                spellCheck: false,
                disabled: busy,
                onBlur: function (e) { commitRoleModel("model", e.target.value); },
              }),
              h("input", {
                key: "omd-roleProvider-" + name + "-" + rev + "-" + switchRev,
                type: "text",
                className: "omd-nameInput",
                defaultValue: role.provider || "",
                placeholder: t("panel.providerPlaceholder"),
                spellCheck: false,
                disabled: busy,
                onBlur: function (e) { commitRoleModel("provider", e.target.value); },
              })),
            h("div", { className: "omd-hint" },
              t("panel.modelFallbackHint", { err: modelGroupsErr || t("panel.unknownError") })));
        }

        // ── 下拉模式：选项来自 /api/paoding/models ────────────────────────
        var options = modelOptionsOf(modelGroups);
        var sel = roleModelSelectionOf(options, role.provider || null, role.model || null);
        var children = [h("option", { key: "follow", value: "" }, t("models.followMain"))];
        options.forEach(function (opt) {
          children.push(h("option", { key: opt.value, value: opt.value },
            t("models.option", { model: opt.modelName, provider: opt.providerName })));
        });
        if (sel.extra) children.push(h("option", { key: "current", value: sel.extra.value }, sel.extra.label));
        function commitRoleModelOption(value) {
          if (value === "") {
            // 「跟随主 agent 当前模型」：model / provider 一并归 null
            setAssign(function (prev) {
              var next = JSON.parse(JSON.stringify(prev));
              next.roles[name].model = null;
              next.roles[name].provider = null;
              return next;
            });
            return;
          }
          var dec = decodeModelOption(value);
          if (!dec) return; // 理论不可达：选项 value 均由本组件编码
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.roles[name].provider = dec.provider || null; // 成对写入；下拉模式不存在「只配 provider」状态
            next.roles[name].model = dec.model || null;
            return next;
          });
        }
        return h("div", { className: "omd-mainName" },
          h("div", { className: "omd-glabel" }, t("panel.roleModelLabel")),
          h("div", { className: "omd-nameRow" },
            h("select", {
              key: "omd-roleModel-" + name, // 每角色独立实例；模式 / 选项集切换可整体重挂
              className: "omd-nameInput",
              disabled: busy,
              value: sel.value,
              onChange: function (e) { commitRoleModelOption(e.target.value); },
            }, children)),
          h("div", { className: "omd-hint" },
            t("panel.modelSelectHint")));
      }

      // 角色「会话模式」行（内置与自定义角色通用，同 roleModelBlock 的定位）：
      // 单选 roles.<toolName>.background_mode ——「一次性（one-shot）」为缺省
      //（字面量 'one-shot'，与 config 层 normalizeBackgroundMode 恒收两个合法
      // 值的序列化形状一致），「可续（continuable）」写 'continuable'。选中
      // 可续时行内展示成本提示；host 层 persistence 后端缺失
      //（state.persistenceAvailable === false，字段缺失的老服务端视为可用不
      // 误报）时再叠加委派将报错的警告——只警示，不拦截预览 / 应用。
      function roleBgModeBlock(name) {
        var continuable = !!(assign.roles[name] && assign.roles[name].background_mode === "continuable");
        function commitBgMode(on) {
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.roles[name].background_mode = on ? "continuable" : "one-shot";
            return next;
          });
        }
        function bgOption(key, label, checked, on) {
          return h("label", { key: key, className: "omd-toolItem" },
            h("input", {
              type: "radio",
              className: "omd-check",
              name: "pd-bgm-" + name, // 每角色独立单选组；name 含 toolName 不串台
              checked: checked,
              disabled: busy,
              onChange: function () { commitBgMode(on); },
            }),
            h("span", { className: "omd-toolName" }, label));
        }
        return h("div", { className: "omd-mainName" },
          h("div", { className: "omd-glabel" }, t("panel.bgModeLabel")),
          h("div", { className: "omd-nameRow" },
            bgOption("one-shot", t("panel.bgOneshot"), !continuable, false),
            bgOption("continuable", t("panel.bgContinuable"), continuable, true)),
          continuable ? h("div", { className: "omd-hint" }, roleBgContinuableHint()) : null,
          continuable && data.persistenceAvailable === false
            ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), roleBgPersistenceWarn())
            : null);
      }

      // 角色「启动方式」行（内置与自定义角色通用，同 roleBgModeBlock 的定位）：
      // 单选 roles.<toolName>.start_mode ——「全新（fresh）」为缺省（字面量
      // 'fresh'，与 config 层 normalizeStartMode 恒收两个合法值的序列化形状
      // 一致），「继承对话（fork）」写 'fork'（委派块的块级 provider 行改落
      // fork）。选中继承对话且该角色配了专用模型时行内提示互斥：fork 子代理
      // 继承主 agent 的提供方与模型，专用模型不生效（应用时后端 warn 并忽略）。
      // 注意与「专用模型」行的 provider 字段（LLM 路由）无关。
      function roleStartModeBlock(name) {
        var role = assign.roles[name] || {};
        var fork = role.start_mode === "fork";
        var hasModel = typeof role.model === "string" && role.model !== "";
        function commitStartMode(toFork) {
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.roles[name].start_mode = toFork ? "fork" : "fresh";
            return next;
          });
        }
        function smOption(key, label, checked, on) {
          return h("label", { key: key, className: "omd-toolItem" },
            h("input", {
              type: "radio",
              className: "omd-check",
              name: "pd-sm-" + name, // 每角色独立单选组；name 含 toolName 不串台
              checked: checked,
              disabled: busy,
              onChange: function () { commitStartMode(on); },
            }),
            h("span", { className: "omd-toolName" }, label));
        }
        return h("div", { className: "omd-mainName" },
          h("div", { className: "omd-glabel" }, t("panel.startModeLabel")),
          h("div", { className: "omd-nameRow" },
            smOption("fresh", t("panel.smFresh"), !fork, false),
            smOption("fork", t("panel.smFork"), fork, true)),
          fork
            ? h("div", { className: "omd-hint" },
                t("panel.forkStartHint"))
            : null,
          fork && hasModel
            ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), roleForkModelHint())
            : null);
      }

      function roleCard(name) {
        var isMain = name === "__main__";
        var display = isMain ? t("role.mainAgent") : name;
        var isCustom = !isMain && DEFAULT_ROLES.indexOf(name) === -1;
        var open = name in openMap ? openMap[name] : defaultOpenOf(name);

        var d = data;
        var a = assign;

        var head = h("div", { className: "omd-roleHeadWrap" },
          h("button", {
            type: "button",
            className: "omd-roleHead",
            "aria-expanded": open ? "true" : "false",
            onClick: function () { toggleRole(name); },
          },
            h("span", { className: open ? "omd-chevron omd-chevronOpen" : "omd-chevron" }, ic(P.IconChevronDownOutline14, 14)),
            h("span", { className: "omd-roleName" }, display),
            h("span", { className: "omd-roleBadge" }, isMain ? t("role.badgeFixed") : (isCustom ? t("role.badgeCustom") : t("role.badgeBuiltin"))),
            h("span", { className: "omd-roleCount" },
              t("role.toolCount", { n: isMain
                ? ((data.restrictBase || []).length + a.main_agent_extra.length - (a.main_agent_remove || []).length)
                : a.roles[name].tools.length }))),
          // 自定义角色改名按钮：toolName 是身份键（委派调用名 / skills 引用），
          // 与内置角色的「显示名」不是一回事——那个只改 persona 主语。
          isCustom
            ? h("button", {
                type: "button",
                className: "omd-roleEdit",
                title: t("role.renameTitle", { name: name }),
                onClick: function (e) {
                  e.stopPropagation();
                  renameRole(name);
                },
              }, ic(P.IconEditOutline16, 16))
            : null,
          // 删除按钮：自定义角色走 removeRole（仅删 roles key）；内置角色走
          // removeBuiltinRole（删 key + roles_remove 记名 → 卡片消失、可恢复）。
          // 主 agent（__main__）卡不可删。内置卡只渲染存在于 assign.roles 的，删后即隐。
          !isMain
            ? h("button", {
                type: "button",
                className: "omd-roleDel",
                title: isCustom ? t("role.delCustomTitle", { name: name }) : t("role.delBuiltinTitle", { name: name }),
                onClick: function (e) {
                  e.stopPropagation();
                  if (isCustom) removeRole(name);
                  else removeBuiltinRole(name);
                },
              }, ic(P.IconTrashOutline16, 16))
            : null);

        var body = [];
        if (isMain) {
          body.push(mainNameBlock());
          body.push(h("div", { className: "omd-glabel" }, t("panel.baseToolsMain")));
          // 三组工具网格都走 toolGridOf：超过 8 项的组自动带行内筛选框
          //（oninput 纯 DOM 切显隐，见 20 片段 toolGridOf / applyToolFilter）。
          body.push(toolGridOf(data.restrictBase || [], function (t) {
            return toolItem(t, "base", (a.main_agent_remove || []).indexOf(t) === -1, busy,
              function (e) { setMainRemove(t, e.target.checked); }, t);
          }));
          // host 检测库存按角色卡同口径拆两组：mcp__ 前缀 → 「MCP 工具」，
          // 其余（mnemon_* 等插件直注册工具）→ 「插件工具」。勾选逻辑不变，
          // 都写入 main_agent_extra。
          var mainInv = data.inventory || [];
          var mainMcpTools = mainInv.filter(function (t) { return hostTool(t); });
          var mainPluginTools = mainInv.filter(function (t) { return !hostTool(t); });
          body.push(h("div", { className: "omd-glabel" }, t("panel.mcpToolsMain")));
          body.push(toolGridOf(mainMcpTools, function (t) {
            return toolItem(t, "mcp", a.main_agent_extra.indexOf(t) !== -1, busy,
              function (e) { setMainExtra(t, e.target.checked); }, t);
          }, h("div", { className: "omd-empty" }, t("panel.noMcp"))));
          body.push(h("div", { className: "omd-glabel" }, t("panel.pluginToolsMain")));
          body.push(toolGridOf(mainPluginTools, function (t) {
            return toolItem(t, "plugin", a.main_agent_extra.indexOf(t) !== -1, busy,
              function (e) { setMainExtra(t, e.target.checked); }, t);
          }, h("div", { className: "omd-empty" }, t("panel.noPlugin"))));
          body.push(h("div", { className: "omd-glabel" }, t("panel.skillsMain")));
          body.push(gridSkills.length
            ? h("div", null,
                h("div", { className: "omd-toolGrid" }, gridSkills.map(function (s) {
                  return toolItem(s, t("panel.tagReadOnDemand"), a.main_agent_skills.indexOf(s) !== -1, busy,
                    function (e) { setMainSkill(s, e.target.checked); }, s + "s",
                    gridProj && gridProj.has(s) ? t("common.projectBadge") : null);
                })),
                h("div", { className: "omd-glabel" }, t("panel.skillsInline")),
                h("div", { className: "omd-toolGrid" }, gridSkills.map(function (s) {
                  return toolItem(s, t("panel.tagInline"), a.main_agent_skills_inline.indexOf(s) !== -1, busy,
                    function (e) { setMainSkillInline(s, e.target.checked); }, s + "i",
                    gridProj && gridProj.has(s) ? t("common.projectBadge") : null);
                })))
            : h("div", { className: "omd-empty" }, t("panel.noSkills")));
          body.push(mainPersonaExtraBlock());
        } else {
          // 模型行位置：内置角色卡在「显示名」之后、工具面区之前；自定义角色卡
          // 在 body 顶部（其无默认显示名可换，不加 builtinNameBlock）。两个场景
          // 通用同一 roleModelBlock——下拉模式成对写 provider + model（不存在
          // 「只配 provider」）；目录不可用降级双 input 时才可能出现该状态（后端
          // warn 并忽略）。留空 = 跟随主 agent 当前模型。
          // 「会话模式」单选紧随模型行（内置 / 自定义通用）：缺省一次性，
          // 选可续时行内给成本提示 + persistence 缺失警告（如有）。
          // 「启动方式」单选紧随会话模式行（内置 / 自定义通用）：缺省全新，
          // 选继承对话时行内给快照语义提示；配了专用模型再叠加互斥警告。
          body.push(roleTitleBlock(name, isCustom));
          body.push(roleModelBlock(name));
          body.push(roleBgModeBlock(name));
          body.push(roleStartModeBlock(name));
          // 三组网格（同 roleCandidateTools 注释的分组口径）：「基础工具」=
          // 非 mcp__ 且不在检测库存（blocks ∪ customCoreToolsOf 减 inventory）；
          // 「MCP 工具」= mcp__ 前缀（含 SRC 自带行，如 tavily）；「插件工具」
          // = 检测库存中非 mcp__ 的直注册工具（mnemon_* 等）。三组勾选逻辑
          // 一致（setRoleTools），分组只影响展示。
          var candidates = roleCandidateTools(name);
          var inv = data.inventory || [];
          var mcpTools = candidates.filter(function (t) { return hostTool(t); });
          var pluginTools = candidates.filter(function (t) { return !hostTool(t) && inv.indexOf(t) !== -1; });
          var baseTools = candidates.filter(function (t) { return !hostTool(t) && inv.indexOf(t) === -1; });
          var checked = a.roles[name].tools;
          // 三组网格同走 toolGridOf（超 8 项自动带筛选框，与主 agent 卡同款）。
          body.push(h("div", { className: "omd-glabel" }, t("panel.baseTools")));
          body.push(toolGridOf(baseTools, function (t) {
            return toolItem(t, "base", checked.indexOf(t) !== -1, busy,
              function (e) { setRoleTools(name, t, e.target.checked); }, t);
          }, h("div", { className: "omd-empty" }, t("panel.none"))));
          body.push(h("div", { className: "omd-glabel" }, t("panel.mcpTools")));
          body.push(toolGridOf(mcpTools, function (t) {
            return toolItem(t, "mcp", checked.indexOf(t) !== -1, busy,
              function (e) { setRoleTools(name, t, e.target.checked); }, t);
          }, h("div", { className: "omd-empty" }, t("panel.noMcp"))));
          body.push(h("div", { className: "omd-glabel" }, t("panel.pluginTools")));
          body.push(toolGridOf(pluginTools, function (t) {
            return toolItem(t, "plugin", checked.indexOf(t) !== -1, busy,
              function (e) { setRoleTools(name, t, e.target.checked); }, t);
          }, h("div", { className: "omd-empty" }, t("panel.noPlugin"))));
          body.push(personaBlock(name));
        }

        return h("div", { className: "omd-roleCard", key: name },
          head,
          open ? h("div", { className: "omd-roleBody" }, body) : null);
      }

      function skillsBlock() {
        // 数据源与主 agent 技能网格一致（工作区视角 = 合并列表，见 gridSkills）；
        // 项目级技能在名字旁加「项目」角标。
        var rows = gridSkills.map(function (s) {
          var roleNames = Object.keys(assign.roles);
          var picked = assign.skills[s] || [];
          return h("div", { className: "omd-skillRow", key: s },
            h("span", { className: "omd-skillName", title: s }, s),
            gridProj && gridProj.has(s) ? h("span", { className: "omd-skillProj" }, t("common.projectBadge")) : null,
            h("div", { className: "omd-skillRoles" }, roleNames.map(function (r) {
              return h("label", { className: "omd-skillRole", key: r },
                h("input", {
                  type: "checkbox",
                  className: "omd-check",
                  checked: picked.indexOf(r) !== -1,
                  disabled: busy,
                  onChange: function (e) { setSkill(s, r, e.target.checked); },
                }),
                h("span", null, r));
            })));
        });
        return rows.length ? rows : h("div", { className: "omd-empty" }, t("panel.noSkills"));
      }

      var customRoles = Object.keys(assign.roles).filter(function (n) { return DEFAULT_ROLES.indexOf(n) === -1; });
      // 内置角色可见名单：条目键存在且未被 roles_remove 删除（场景模板切到
      // 轻量/调研档后条目键仍保留——为的是切回全开档时 persona / 模型 / 工具面
      // 原样复原——卡片显隐一律按 roles_remove 判定；标题计数同口径）。
      var visibleBuiltinRoles = DEFAULT_ROLES.filter(function (n) {
        return !!assign.roles[n] && (assign.roles_remove || []).indexOf(n) === -1;
      });

      // persistence 警告横幅：host 层会话持久化后端缺失（state.persistenceAvailable
      // === false；字段缺失的老版服务端视为可用，不误报）且当前视角的任意角色
      // 配了可续（continuable）时，面板顶部警示——只提示不拦截，预览 / 应用照常。
      var persistenceWarn = data.persistenceAvailable === false && hasContinuableRole(assign.roles);

      var applyBtn = h(P.Button, {
        variant: "primary",
        size: "md",
        disabled: busy,
        onClick: doApply,
        icon: busyOp === "apply"
          ? h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16))
          : ic(P.IconCheckOutline16, 16),
      }, busyOp === "apply" ? t("panel.applying") : t("panel.applyBtn"));

      var previewBtn = h(P.Button, {
        variant: "outline",
        size: "md",
        disabled: busy,
        onClick: doPreview,
        icon: busyOp === "preview"
          ? h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16))
          : ic(P.IconCordisPluginOutline14, 14),
      }, busyOp === "preview" ? t("panel.previewing") : t("panel.previewBtn"));

      var rescanBtn = h(P.Button, {
        variant: "ghost",
        size: "md",
        disabled: busy,
        onClick: doRescan,
        icon: busyOp === "rescan"
          ? h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16))
          : ic(P.IconRefreshOutline16, 16),
      }, busyOp === "rescan" ? t("panel.scanning") : t("panel.rescanBtn"));

      return h("div", { className: "pd-page", ref: rootRef },
        // 运行时识别降级：持续状态（不是事件），内联一行小字贴标签行上方，
        // 平时（runtimeOk 正常）零占位
        runtimeNoteOf(data),

        // persistence 警告横幅：仅当前视角确有可续角色且 host 层持久化后端
        // 缺失时出现（判定见上方 persistenceWarn），其余场合零占位
        persistenceWarn
          ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), roleBgPersistenceWarn())
          : null,

        // 配置对象（全局默认 / 各工作区，标签页）
        workspaceBarOf(),

        // 宿主工作区列表拉取失败的可见降级提示：此时标签条只剩配置文件兜底的
        // tab，一声不吭的话用户会误以为「注册过的工作区不见了」是功能缺陷。
        // 仅请求失败 / 响应异常时出现（wsListErr 非空，成功路径零占位）；贴在
        // 标签条容器下方另起一行，不动标签行自身的收纳 / 下拉锚点布局，
        // role=status 礼貌播报即可（持久化警告同款 statusRow，错误行才用 alert）。
        wsListErr
          ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), wsListErr, "status")
          : null,

        // 「添加工作区」弹窗：fixed 全屏遮罩不占布局流，挂在根数组末尾即可；
        // 未打开时返回 null，零开销
        wsModalOf(),

        // 「新建自定义 agent 角色」弹窗：同为 fixed 全屏遮罩不占布局流，
        // 未打开时返回 null，零开销
        roleAddModalOf(),

        // 「重命名自定义角色」弹窗：同上（原原生 prompt 改模态框）
        roleRenameModalOf(),

        // 角色与工具
        h("div", { className: "omd-group" },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconUserOutline16, 14)),
            h("span", null, t("panel.rolesToolsHeading")),
            h("span", { className: "omd-count" }, visibleBuiltinRoles.length + customRoles.length)),
          // 场景模板行：三档快捷预设（只动 roles_remove + main_agent_extra），
          // 贴工具配置区上方；说明进 title 悬浮，不占版面。仅改本地 assign，
          // 保存仍走「保存并应用」。
          h("div", { className: "omd-chips" },
            h("span", { className: "omd-restoreTitle" }, t("panel.tplHeading")),
            PAODING_SCENARIO_TEMPLATES.map(function (tpl) {
              return h("button", {
                type: "button",
                key: tpl.id,
                className: "omd-restorePill",
                title: t(tpl.desc),
                disabled: busy,
                onClick: function () { applyTemplateClick(tpl); },
              }, t(tpl.label));
            })),
          roleCard("__main__"),
          visibleBuiltinRoles.map(function (n) { return roleCard(n); }),
          customRoles.map(function (n) { return roleCard(n); }),
          // 已删除的内置角色恢复区（仅删除过内置角色时出现）
          (assign.roles_remove || []).length
            ? h("div", { className: "omd-restoreRow" },
                h("div", { className: "omd-restoreTitle" }, t("panel.removedHeading")),
                h("div", { className: "omd-chips" }, (assign.roles_remove || []).map(function (n) {
                  return h("button", {
                    type: "button",
                    key: n,
                    className: "omd-restorePill",
                    title: t("role.restoreTitle", { name: n }),
                    onClick: function () { restoreBuiltinRole(n); },
                  }, t("role.restorePill", { name: n }));
                })),
                h("div", { className: "omd-hint" },
                  t("panel.restoreHint")))
            : null,
          h("button", { type: "button", className: "omd-addRole", onClick: openRoleAddModal },
            h("span", { className: "omd-addRoleIcon" }, ic(P.IconPlusOutline16, 16)),
            h("span", null, t("panel.roleAddBtn")))),

        // 技能分配
        h("div", { className: "omd-group" },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconSkillOutline16, 14)),
            h("span", null, t("panel.skillsHeading")),
            skillScopeNote(),
            h("span", { className: "omd-count" }, gridSkills.length)),
          // 工作区技能拉取失败的降级提示（一句话）：此刻网格数据源已回落用户级。
          activeWs !== null && wsSkillsErr
            ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), wsSkillsErr)
            : null,
          skillsBlock()),

        // 检查提示卡（预览 / 应用的结构化体检结果；无条目零占位）：
        // preview 源贴着预览区上方，assign 一变即随预览作废；apply 源描述已
        // 落盘结果，保留到下一次预览 / 应用（失效口径见 warnState 注释）。
        warningsCardOf(warnState),

        // 预览生成（预览成功后才出现）
        preview ? h("div", { className: "omd-group", ref: previewRef },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconDataOutline16, 14)),
            h("span", null, t("panel.previewBtn"))),
          h("div", { className: "omd-previewSummary" },
            t("panel.previewOk") +
            (preview.presetId ? t("panel.previewPreset", { id: preview.presetId }) : "") +
            (preview.roleResults || []).map(function (r) {
              return " · " + r.role + ": " + r.intent.length + " → " + r.kept.length;
            }).join("")),
          // 「本次变更」区块：服务端 diff 到场才渲染（老服务端零占位）；
          // unchanged 一行、changed 完整列出（见 70 片段 diffBlockOf）。
          diffBlockOf(preview.diff),
          // 瘦身统计（按本次提交配置算的预览口径）：与页头「按已保存配置」的
          // 一行区分，随行标注「按当前未保存配置」。apply 确认流程不加区块。
          preview.slim ? h("div", { className: "omd-slimLine" },
            slimLineText(preview.slim),
            h("span", { className: "omd-slimNote" }, t("slim.pendingNote"))) : null,
          h("pre", { className: "omd-pre" }, preview.text)) : null,

        // 悬浮操作坞（sticky bottom：按钮常驻滚动容器底部，改完配置无需滚回顶部再操作）
        h("div", { className: "omd-actionBar" },
          previewBtn, rescanBtn,
          h("span", { className: "omd-applyDock" }, applyBtn)));
    }

    // ── 挂载：底部入口 + 会话中栏全页 overlay ──────────────────────────────
    //
    // 入口走宿主 slots 键控槽（sidebar.footer.action，见下方 mountFooterEntry
    // 与 exports.inject 的 slots 声明）；全页 overlay 为纯 DOM + React root：
    //   1) 底部入口：左下角动作条（与插件广场 cordis 徽章同槽位，设置行上方）；
    //      宽栏 42px 圆角行 / 窄栏 36px 圆钮，点击开关 overlay；
    //      由观察器自动放回。
    //   2) 全页 overlay：容器 div（data-dsh-paoding-view）append 到会话中栏，
    //      createRoot 渲染整页配置页；打开态在 <html> 上设
    //      data-dsh-paoding-active，CSS 据此隐藏会话内容、显示本页。与
    //      mnemon / taskboard / ssh 互斥（dsh-panel-activate 事件 + active
    //      属性双通道），点侧栏会话行等上下文自动关闭。

    // react-dom/client：宿主 ModuleLoader seed 提供（mnemon 线上 bundle 同款
    // 用法）。异常宿主下取不到时 overlay 不挂，侧栏入口仍可用（保底不炸）。
    var ReactDOMClient = null;
    try { ReactDOMClient = require("react-dom/client"); } catch (err) { ReactDOMClient = null; }

    // 框架无关的小状态器（照 mnemon 的 MnemonWorkspaceController）：侧栏入口
    // 与全页 overlay 共享同一份 { open } 快照，subscribe 驱动两侧同步。
    // 「带目标工作区打开」的待办路径：宿主工作区菜单的「庖丁配置」入口点击时
    // 写入（controller.open(path)），ConfigPanel 在 state + 工作区列表都就绪后
    // 消费并切到该 tab。放模块级而非 prop 钻透——controller 与 ConfigPanel 分属
    // DOM 注入层与 React 层，中间隔着懒挂载的 createRoot，props 传不进去。
    var pendingOpenWs = null;

    function setPendingOpenWs(wsPath) {
      pendingOpenWs = typeof wsPath === "string" && wsPath.trim() !== ""
        ? wsPath.trim().replace(/[\/\\]+$/, "")
        : null;
    }

    function createWorkspaceController() {
      var snapshot = { open: false };
      var listeners = [];
      function notify() {
        listeners.slice().forEach(function (listener) { listener(); });
      }
      function setOpen(open, reassert) {
        if (snapshot.open === open && !reassert) return;
        snapshot = { open: open };
        notify();
      }
      return {
        getSnapshot: function () { return snapshot; },
        subscribe: function (listener) {
          listeners.push(listener);
          return function () {
            var i = listeners.indexOf(listener);
            if (i !== -1) listeners.splice(i, 1);
          };
        },
        // open 带 reassert：重复打开（如属性观察兜底触发）时也把 active 属性
        // 与互斥广播重新刷一遍，而不是因「已是 true」短路。可选 wsPath = 打开
        // 后要切到的工作区路径（宿主菜单「庖丁配置」入口用，见 pendingOpenWs）。
        open: function (wsPath) { setPendingOpenWs(wsPath); setOpen(true, true); },
        close: function () { setOpen(false); },
        toggle: function () { setOpen(!snapshot.open); },
      };
    }

    // ── 侧栏底部入口（sidebar.footer.action 键控槽）────────────────────────
    // 入口挂在左下角底部动作条：注册 sidebar.footer.action
    // 列表槽（与插件广场 cordis 徽章同一槽位，渲染在设置行上方的动作条里）。
    // 观感复刻 cordis 徽章 / 设置触发钮：宽栏 = 42px 圆角行（图标 + 文案），
    // 窄栏（56px rail）= 36px 圆形图标钮。点击开 / 关全页 overlay（mountPanel
    // 一套不动：互斥广播、工作区菜单深链、Esc 层级照旧）。
    function makeFooterEntry(controller) {
      return function FooterEntry(props) {
        var wide = !!(props && props.wide);
        var _st = useState(controller.getSnapshot().open), open = _st[0], setOpenState = _st[1];
        var _lt = useState(0), langTick = _lt[0], setLangTick = _lt[1];
        useEffect(function () {
          return controller.subscribe(function () { setOpenState(controller.getSnapshot().open); });
        }, []);
        // 语言切换时整体重渲染入口（label / aria / title 全走 t() 取新文案）；
        // tick 只为触发重渲染，无业务含义。
        useEffect(function () {
          return onLangChange(function () { setLangTick(function (n) { return n + 1; }); });
        }, []);
        return h("button", {
          type: "button",
          className: "pd-footerBtn" + (wide ? "" : " pd-footerRail"),
          "data-active": open ? "true" : undefined,
          "aria-label": t("nav.entryTitle"),
          "aria-haspopup": "dialog",
          "aria-expanded": open ? "true" : "false",
          title: wide ? undefined : t("nav.entryTitle"),
          onClick: function () { controller.toggle(); },
        },
          h(P.IconSkillOutline16, { size: wide ? 16 : 18 }),
          wide ? h("span", { className: "pd-footerLabel" }, t("nav.entryTitle")) : null);
      };
    }

    function mountFooterEntry(ctx, controller) {
      if (typeof document === "undefined") return function () {};
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function" || typeof ctx.slots.register !== "function") {
        return function () {}; // 槽口不可用（老宿主）：静默不挂，面板仅失去底部入口
      }
      var Entry = makeFooterEntry(controller);
      var dispose = ctx.slots.inject("sidebar.footer.action", function () {
        return ctx.slots.register({ name: "sidebar.footer.action", id: "paoding-config", order: 10, label: t("nav.entryTitle") }, Entry);
      });
      return typeof dispose === "function" ? dispose : function () {};
    }


    // ── 委派事件流行（tool.call.toolview 键控行替换）────────────────────────
    // 事件流里每个工具调用行由 ToolCallTree 按 toolName 查 tool.call.toolview
    // 键控插槽，键命中则整行替换成注册组件（bash / read / grep / cordis 等都
    // 走这条路）。这里为庖丁的委派工具（内置四角色 + 自定义角色名）注册行：
    // 标题 = 显示名（roles.<toolName>.name，未配走中文缺省映射 / toolName），
    // 副题 = 调用参数 description（模型写的任务一句话），尾部状态点，点击展开
    // 子 agent 返回文本——通用行的结果查看能力不能丢。
    // 边界：只管工具调用行；子 agent 会话树 / 面包屑标题来自服务端会话摘要，
    // 不在客户端控制面。标题取全局配置的显示名（行渲染时不知道会话属于哪个
    // 工作区，工作区级显示名够不着）。
    // 标题回落表：值是 i18n 字典 key（role.title.*），取文案须过 t()——
    // 语言切换后 refreshDelegateRows 会重算 titles（见模块尾的订阅）。
    var DELEGATE_TITLE_FALLBACK = {
      search_external: "role.title.search_external",
      design: "role.title.design",
      implement: "role.title.implement",
      search_internal_deep: "role.title.search_internal_deep",
    };
    // 静态委派工具：不在 roles 键里（无条目、不可删不可改名），恒注册。
    var DELEGATE_STATIC_TOOLS = ["search_internal_deep"];

    function buildDelegateMeta(d) {
      var cfg = globalConfigOf(d) || (d && d.suggested) || {};
      var roles = (cfg && typeof cfg.roles === "object" && cfg.roles) || {};
      var removed = Array.isArray(cfg.roles_remove) ? cfg.roles_remove : [];
      var titles = {};
      var tools = DELEGATE_STATIC_TOOLS.slice();
      DELEGATE_STATIC_TOOLS.forEach(function (n) {
        var tk = DELEGATE_TITLE_FALLBACK[n];
        titles[n] = tk ? t(tk) : n;
      });
      Object.keys(roles).forEach(function (n) {
        if (removed.indexOf(n) !== -1) return; // 已删内置角色：委派工具不存在，键命中不了，不注册
        if (tools.indexOf(n) === -1) tools.push(n);
        var nm = roles[n] && typeof roles[n].name === "string" ? roles[n].name.trim() : "";
        var tk = DELEGATE_TITLE_FALLBACK[n];
        titles[n] = nm !== "" ? nm : (tk ? t(tk) : n);
      });
      return { titles: titles, tools: tools };
    }

    var delegateMeta = { titles: {}, tools: [] };
    var delegateRowsDispose = null;
    var delegateRowsCtx = null;

    // 调用块是双形态（与宿主 toolRowModel 同源判据）：进行中块无 kind、
    // 参数在 block.argsRaw；结算块有 kind、参数挪进 block.call.argsRaw，
    // 结果在 block.content，error.code === "interrupted" 表示被停。
    function delegateArgsRawOf(block) {
      if (!block || typeof block !== "object") return "";
      var raw = "kind" in block
        ? (block.call && typeof block.call.argsRaw === "string" ? block.call.argsRaw : "")
        : (typeof block.argsRaw === "string" ? block.argsRaw : "");
      return raw || "";
    }

    function delegateStatusOf(block) {
      if (!block || typeof block !== "object" || !("kind" in block)) return "running";
      if (block.error && block.error.code === "interrupted") return "stopped";
      if (block.isError || block.error) return "error";
      return "done";
    }

    // 展开用的结果文本：文本块原文 + 其余块 pretty JSON；空内容回落错误行。
    function delegateResultText(block) {
      var parts = [];
      var content = block && Array.isArray(block.content) ? block.content : [];
      for (var i = 0; i < content.length; i++) {
        var c = content[i];
        if (c && c.type === "text" && typeof c.text === "string") parts.push(c.text);
        else if (c) parts.push(JSON.stringify(c, null, 2));
      }
      if (parts.length === 0 && block && block.error) {
        parts.push((block.error.name || "error") + ": " + (block.error.code || ""));
      }
      return parts.join("\n");
    }

    function DelegateRow(props) {
      var block = props && props.block ? props.block : {};
      var toolName = (props && props.toolName) || "";
      var _o = useState(false), open = _o[0], setOpen = _o[1];
      var args = {};
      var argsRaw = delegateArgsRawOf(block);
      if (argsRaw !== "") {
        try {
          var parsed = JSON.parse(argsRaw);
          if (parsed && typeof parsed === "object") args = parsed;
        } catch (err) { /* 原始参数非 JSON：忽略，副题留空 */ }
      }
      var desc = typeof args.description === "string" ? args.description.trim() : "";
      var prompt = typeof args.prompt === "string" ? args.prompt : "";
      var status = delegateStatusOf(block);
      var stateCls = status === "running" ? "pd-delegateRunning" : (status === "error" ? "pd-delegateFailed" : (status === "stopped" ? "pd-delegateStopped" : "pd-delegateDone"));
      var stateGlyph = status === "running" ? "◌" : (status === "error" ? "✕" : (status === "stopped" ? "⊘" : "✓"));
      var title = delegateMeta.titles[toolName] || (tHas(DELEGATE_TITLE_FALLBACK[toolName]) ? t(DELEGATE_TITLE_FALLBACK[toolName]) : "") || toolName;
      return h("div", { className: "pd-delegateRow" + (status === "error" ? " pd-delegateErr" : "") },
        h("button", {
          type: "button",
          className: "pd-delegateHead",
          "aria-expanded": open ? "true" : "false",
          title: prompt ? prompt.slice(0, 400) : "",
          onClick: function () { setOpen(!open); },
        },
          h("span", { className: "pd-delegateState " + stateCls, "aria-hidden": "true" }, stateGlyph),
          h("span", { className: "pd-delegateTitle" }, title),
          desc ? h("span", { className: "pd-delegateDesc" }, desc) : null,
          h("span", { className: open ? "pd-delegateChev pd-delegateChevOpen" : "pd-delegateChev", "aria-hidden": "true" }, "▸")),
        open ? h("pre", { className: "pd-delegateBody" }, delegateResultText(block)) : null);
    }

    // 重注册：先撤旧键（inject 返回处置器，dsh-mnemon 同款用法），再按当前
    // 名单重建——自定义角色增删 / 显示名改动后由 refreshDelegateRows 触发。
    function syncDelegateRows() {
      if (delegateRowsDispose) {
        try { delegateRowsDispose(); } catch (err) { /* 撤旧失败不阻断重建 */ }
        delegateRowsDispose = null;
      }
      var ctx = delegateRowsCtx;
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function" || typeof ctx.slots.register !== "function") return;
      if (delegateMeta.tools.length === 0) return;
      delegateRowsDispose = ctx.slots.inject("tool.call.toolview", function () {
        var disposers = [];
        try {
          delegateMeta.tools.forEach(function (n) {
            disposers.push(ctx.slots.register({ name: "tool.call.toolview", key: n }, DelegateRow));
          });
        } catch (err) {
          disposers.forEach(function (d) { try { d(); } catch (e2) { /* 连锁失败静默 */ } });
          throw err;
        }
        return function () { disposers.forEach(function (d) { try { d(); } catch (e2) { /* 静默 */ } }); };
      });
    }

    function refreshDelegateRows() {
      paodingApi("state").then(function (d) {
        var next = buildDelegateMeta(d);
        // 比对串必须并进 titles 的值：显示名单独变更时键集合不变，只比键会
        // 漏判，事件流委派行标题刷不出来。
        var oldKeys = Object.keys(delegateMeta.titles).sort().map(function (k) { return k + ":" + delegateMeta.titles[k]; }).join("|")
          + "//" + delegateMeta.tools.slice().sort().join("|");
        var newKeys = Object.keys(next.titles).sort().map(function (k) { return k + ":" + next.titles[k]; }).join("|")
          + "//" + next.tools.slice().sort().join("|");
        if (newKeys !== oldKeys) {
          delegateMeta = next;
          syncDelegateRows();
        }
      }).catch(function () { /* 静默：行回落通用卡片 */ });
    }

    function mountDelegateRows(ctx) {
      if (typeof document === "undefined") return function () {};
      delegateRowsCtx = ctx;
      refreshDelegateRows();
      // 语言切换：titles 里的 t() 值已过期，整表重算；比对串含 titles 值，
      // 变了就重注册（无需理会 controller 是否已挂载——未挂载时 ctx.slots
      // 注入照常，行组件只在事件流渲染时才取值）。
      onLangChange(function () { refreshDelegateRows(); });
      var offReset = null;
      if (ctx && typeof ctx.on === "function") {
        try {
          var r = ctx.on("connection/reset", function () { refreshDelegateRows(); });
          if (typeof r === "function") offReset = r;
        } catch (err) { /* 事件口不可用：仅失去断线重连后的刷新 */ }
      }
      return function () {
        if (delegateRowsDispose) { try { delegateRowsDispose(); } catch (err) { /* 静默 */ } }
        delegateRowsDispose = null;
        if (offReset) { try { offReset(); } catch (err) { /* 静默 */ } }
        delegateRowsCtx = null;
      };
    }

    // ── 宿主工作区「...」菜单注入桥 ──────────────────────────────────────────
    // 宿主侧栏工作区行的「...」菜单只有「重命名 / 删除工作区」两项，onSelect
    // 硬编码只认这两个 id，没有插件扩展点。这里从 DOM 层补一个「庖丁配置」项：
    //   1. 捕获级监听 document 点击，按触发钮 aria-label（工作区“<名>”的操作）
    //      记下最近一次操作的宿主工作区名；
    //   2. MutationObserver 盯菜单 portal（每次打开都是新建 DOM）：认出「重命名
    //      + 删除工作区」两行 = 工作区菜单，克隆重命名行改文案为「庖丁配置」——
    //      克隆而非自绘，类名跟宿主构建走，观感天然一致，hash 类名升级也不怕；
    //   3. 点击：先合成 Escape 关掉宿主菜单，再按记下的名字到 /api/paoding/
    //      workspaces 反查路径（title 精确 → basename 兜底），controller.open
    //      (path) 打开本页，ConfigPanel 就绪后自动切到该工作区 tab。
    // 反查失败（列表拉不到 / 名字对不上）仍打开页面，落在全局默认并给 warn。
    // 宿主 i18n 的 aria-label 模板是「工作区“{name}”的操作」（zh）/「Workspace
    // “{name}” actions」类变体（en），这里宽松匹配：引号样式 + 尾缀都容错。
    function wsTitleFromAriaLabel(label) {
      if (typeof label !== "string" || label === "") return null;
      var m = label.match(/^(?:工作区|Workspace)\s*[“"']([^”"']{1,120})[”"']/);
      return m ? m[1] : null;
    }

    function mountWorkspaceMenuBridge(controller) {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
        return function () {};
      }
      var lastWsTitle = null;

      function onClickCapture(e) {
        var btn = e.target && e.target.closest ? e.target.closest("button[aria-label]") : null;
        if (!btn) return;
        var title = wsTitleFromAriaLabel(btn.getAttribute("aria-label"));
        if (title !== null) lastWsTitle = title;
      }

      // 在菜单 portal 里找「工作区菜单」：所有文本叶子按已知文案对筛，命中后
      // 爬回菜单行（列表容器的直接子级），并要求同容器存在「删除」行作证。
      function findHostWsMenu(rootNode) {
        var scopes = [rootNode, document.body];
        for (var si = 0; si < scopes.length; si++) {
          var scope = scopes[si];
          if (!scope || !scope.querySelectorAll) continue;
          var leafs = scope.querySelectorAll("button, [role='menuitem'], li, div, span");
          for (var i = 0; i < leafs.length; i++) {
            var leaf = leafs[i];
            if (leaf.childElementCount !== 0) continue;
            var txt = (leaf.textContent || "").trim();
            var isRename = txt === "重命名" || txt === "Rename";
            if (!isRename) continue;
            var row = leaf;
            while (row.parentElement && row.parentElement.childElementCount < 2) row = row.parentElement;
            var list = row.parentElement;
            if (!list) continue;
            var hasDelete = false;
            for (var c = 0; c < list.children.length; c++) {
              var t = (list.children[c].textContent || "");
              if (t.indexOf("删除工作区") !== -1 || t.indexOf("Delete workspace") !== -1) { hasDelete = true; break; }
            }
            if (!hasDelete) continue; // 缺「删除工作区」佐证：非工作区菜单（其他重命名入口），继续扫下一候选
            // 已注入过（自家行在菜单里）就不再动
            if (list.querySelector("[data-paoding-ws-menu]")) return null;
            return row;
          }
        }
        return null;
      }

      // 克隆宿主菜单行：换文案、清 id / aria 引用（防重复），打自家标记。
      function buildPaodingRow(modelRow, onPick) {
        var mine = modelRow.cloneNode(true);
        mine.removeAttribute("id");
        var inner = mine.querySelectorAll ? mine.querySelectorAll("[id]") : [];
        for (var i = 0; i < inner.length; i++) inner[i].removeAttribute("id");
        mine.setAttribute("data-paoding-ws-menu", "1");
        mine.setAttribute("aria-label", t("nav.entryTitle"));
        mine.setAttribute("title", t("nav.openToWs"));
        var walker = document.createTreeWalker(mine, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
          var txt = node.nodeValue;
          // 注意局部名用 txt：全局 t() 是 i18n 取词函数，不能被文本值遮蔽
          if (txt.indexOf("重命名") !== -1 || txt.toLowerCase().indexOf("rename") !== -1) {
            node.nodeValue = txt.replace(/重命名|Rename/gi, t("nav.entryTitle"));
          }
        }
        mine.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          onPick();
        });
        return mine;
      }

      // 合成 Escape 关宿主菜单（portal 挂 body，宿主 Menu 自行监听关闭）。
      function closeHostMenu() {
        try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (err) { /* 老内核无构造器：跳过 */ }
      }

      function pickAndOpen() {
        var title = lastWsTitle;
        closeHostMenu();
        // 等 Escape 落地再开本页（宿主菜单关闭与 overlay 激活互不抢事件）
        setTimeout(function () {
          if (!title) { controller.open(); return; }
          paodingApi("workspaces").then(function (d) {
            var items = (d && Array.isArray(d.items)) ? d.items : [];
            var hit = null;
            for (var i = 0; i < items.length; i++) {
              var it = items[i];
              if (!it || typeof it.path !== "string" || it.path === "") continue;
              if (typeof it.title === "string" && it.title === title) { hit = it.path; break; }
            }
            if (!hit) {
              // 标题对不上：按 basename 兜底（宿主缺省标题常取目录名）
              var norm = title.replace(/[\/\\]+$/, "");
              var base = norm.split("/").pop();
              for (var j = 0; j < items.length; j++) {
                var p = items[j] && items[j].path;
                if (typeof p !== "string" || p === "") continue;
                var pb = p.replace(/[\/\\]+$/, "").split("/").pop();
                if (pb === base) { hit = p; break; }
              }
            }
            if (hit) controller.open(hit);
            else {
              controller.open();
              toast.warn(t("menu.wsNotRegistered", { title: title }));
            }
          }).catch(function () {
            controller.open();
            toast.warn(t("menu.listFail"));
          });
        }, 80);
      }

      // 闸门：mutation 记录里新增的元素含「重命名 / Rename」才进全量扫描——
      // 聊天流 DOM 变更频繁，菜单 portal 是 body 直挂的小 subtree，先粗筛再细认。
      function recordsLookLikeMenu(records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i] && records[i].addedNodes;
          if (!added) continue;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (!n || n.nodeType !== 1) continue;
            var txt = n.textContent || "";
            if (txt.indexOf("重命名") !== -1 || txt.toLowerCase().indexOf("rename") !== -1) return true;
          }
        }
        return false;
      }

      var mo = new MutationObserver(function (records) {
        if (!recordsLookLikeMenu(records)) return;
        var model = findHostWsMenu(document.body);
        if (!model || !model.parentElement) return;
        model.parentElement.appendChild(buildPaodingRow(model, pickAndOpen));
      });
      mo.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("click", onClickCapture, true);
      return function () {
        mo.disconnect();
        document.removeEventListener("click", onClickCapture, true);
      };
    }

    // ── 全页 overlay ────────────────────────────────────────────────────────

    var CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"], .dshDesktopConversationSurface';
    var ACTIVE_ATTR = "data-dsh-paoding-active";
    var MNEMON_ACTIVE_ATTR = "data-dsh-mnemon-active";
    var TASKBOARD_ACTIVE_ATTR = "data-dsh-taskboard-active";
    var SSH_ACTIVE_ATTR = "data-dsh-ssh-active";
    var ACTIVATE_EVENT = "dsh-panel-activate";
    // 点侧栏上下文（会话行 / 项目行 / 搜索结果 / 新会话 / 各插件入口）时自动
    // 关闭本页——用户已离开配置语境。
    var SIDEBAR_CONTEXT_SELECTOR = "[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-mnemon-entry], [data-dsh-paoding-entry], [class*=\"sessionRow\"], [class*=\"projectRow\"], [class*=\"searchResultRow\"], [class*=\"searchResultWorkspace\"], [class*=\"newSession\"]";

    // 整页骨架：页头（标题 + 副标题 + 右上关闭）+ 内容区（ConfigPanel 整页
    // 内容，.pd-page 自身即滚动容器，悬浮操作坞的 sticky 语义在其中成立）。
    // Esc 关闭挂 document keydown（冒泡阶段）：「添加工作区」弹窗、「新建 /
    // 重命名角色」弹窗与「更多」菜单开着时，ConfigPanel 的捕获级监听先截停
    // Esc（只收菜单 / 建议下拉 / 弹窗，不关页）；确认弹窗开着时由 ConfirmLayer
    // 的捕获级监听截停（只关确认框）；事件都到不了这里。其余位置 Esc 一律关页。
    // 一键升级（页头更新卡「升级」按钮，统一入口）：
    // POST /api/paoding/upgrade，服务端经插件通道原地换版本（常规 profile 走
    // dsh 插件转发器；desktop profile 被 dsh CLI 的 Electron 专属守卫硬拒，
    // 服务端直跑 pnpm add），分钟级操作。确认弹窗（原原生 confirm
    // 改通用确认弹窗，confirmCtrl 单例见 70 片段）文案按挂载形态分流：
    // dev link 直连形态（layout 由服务端 version 路由按包根 .git 判定）无法
    // 就地升级，把手动切换命令说在前头；installed（registry 版）原地换版本，
    // 按宿主热重载能力（version 路由 hotReloadable：插件清单里有启用的
    // dsh-hmr 行）再分两级——有则「刷新页面即生效」，无则「重启 DSH 生效」。
    // 反馈（成功 note / 失败 err，含子进程输出尾部）都收在卡内，不与
    // 面板的 toast 反馈混流。升级非破坏性操作，danger 不置位；弹窗本体由
    // PageShell 末尾的 ConfirmLayer 渲染（页头与面板发起的确认共用一层）。
    function runUpgradeFlow(verInfo, setVerInfo, setUpgBusy, setUpgNote, setUpgErr) {
      if (!verInfo || !verInfo.latest) return;
      var isDev = verInfo.layout === "dev";
      // 二级分流：宿主插件清单里有启用的 dsh-hmr 插件行（0.2.1+ web/desktop
      // 发布 profile 默认带上，version 路由的 hotReloadable 字段）时，插件
      // 通道原地换版本后刷新页面即生效，无需重启 DSH——确认框与成功 note
      // 都换「刷新即生效」文案；字段缺失 / 探测失败回落「需重启」文案。
      var hot = verInfo.hotReloadable === true;
      var msg = isDev
        ? t("menu.upgradeDevBody")
        : t(hot ? "menu.upgradeBodyHot" : "menu.upgradeBody", { v: versionTagOf(verInfo.latest) });
      confirmCtrl.ask({
        title: t("menu.upgradeTitle"),
        body: msg,
        danger: false,
        confirmText: t("menu.upgradeConfirm"),
        onConfirm: function () {
          setUpgBusy(true);
          setUpgNote("");
          setUpgErr("");
          paodingApi("upgrade", {}).then(function (r) {
            if (r && r.upToDate) { setUpgNote(t("menu.upToDate")); return; }
            var done = versionTagOf((r && r.version) || verInfo.latest);
            // 服务端返回了 message 就原文透传（服务端消息不做客户端翻译），
            // 没有才落本地化兜底文案。
            setUpgNote((r && r.message) || t(hot ? "menu.upgradedHot" : "menu.upgraded", { v: done }));
            // 重拉版本信息：服务端有 1 小时缓存且本进程挂的还是旧代码，重启前
            // 更新卡可能仍在（重启后自然消失），以此处的生效提示为准。
            paodingApi("version").then(function (d) {
              if (d && typeof d.current === "string" && d.current) setVerInfo(d);
            }).catch(function () { /* 静默：升级已完成，重拉失败不打扰 */ });
          }).catch(function (err) {
            // 失败要醒目：截服务端透传的子进程输出尾部 ~300 字符并入 err，方便
            // 定位 pnpm 缓存权限（EPERM）之类环境问题，不用翻服务端日志。
            var tail = typeof err.output === "string" && err.output ? t("menu.errTail", { tail: err.output.slice(-300) }) : "";
            setUpgErr(err.message + tail);
          }).finally(function () {
            setUpgBusy(false);
          });
        },
      });
    }

    // ── 恢复备份（页头「更多」菜单 → 备份列表弹层 → 二次确认 → POST restore）──
    // 服务端契约（api-core.mjs / index.mjs 已落地）：
    //   GET  config/backups → { ok, backups: [{file, mtimeMs, size}] }（新→旧，可空）
    //   POST config/restore { file } → { ok }；422 文件名非法/备份坏、404 不存在、
    //   409 有 apply 在跑（{ error } 信封，客户端按既有错误 toast 惯例呈现）。
    // 行三段：bak-N 徽标（从文件名 .bak-N 尾缀解析，解析不出原样显示文件名）+
    // 本地时间（mtimeMs 按 UI 语言格式化）+ 大小（B/KB/MB 三档）。

    // 备份徽标：file 恒为 basename（服务端保证），形如
    // 「<配置文件名>.bak-1」→ 「bak-1」；形状不对原样透出（不猜）。
    function backupTagOf(file) {
      var m = String(file || "").match(/\.bak-(\d+)$/);
      return m ? "bak-" + m[1] : String(file || "");
    }

    // 本地时间：toLocaleString 按当前 UI 语言取 locale（zh → zh-CN / en → en-US
    // ——Electron 外壳 navigator 语言被钉成应用 locale，不可作格式化依据），
    // 24 小时制免「上午/下午」占宽；Intl 缺失的老内核逐层回落实现缺省格式。
    function backupTimeText(ms) {
      var d = new Date(typeof ms === "number" ? ms : 0);
      try {
        return d.toLocaleString(pdLang() === "en" ? "en-US" : "zh-CN", { hour12: false });
      } catch (err) {
        try { return d.toLocaleString(); } catch (err2) { return String(d); }
      }
    }

    // 大小：B / KB / MB 三档（配置文件量级远用不上 GB），KB 以上留一位小数。
    function backupSizeText(bytes) {
      var n = typeof bytes === "number" && isFinite(bytes) && bytes >= 0 ? bytes : 0;
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
      return (n / (1024 * 1024)).toFixed(1) + " MB";
    }

    // 确认弹窗层：订阅 70 片段的 confirmCtrl 单例（照 makeFooterEntry 的
    // useState + subscribe 写法），渲染 confirmModalOf。挂在 PageShell 根数组
    // 末尾——fixed 全屏遮罩覆盖整页，面板（删除角色 / 保存并应用）与页头
    // （升级）发起的确认都罩得住。
    // Esc 分层：自带 document 捕获级 keydown 监听。ConfigPanel 的捕获级监听
    // 先注册（ConfigPanel 是 PageShell 的子组件，子 effect 先于本组件 effect
    // 运行），但它只在自己弹窗 / 菜单开着时才 stopPropagation——确认框开着
    // 时该监听放行，本监听（注册在后）截停并只关确认框；stopPropagation 之后
    // PageShell 冒泡层的关页监听收不到事件，确认框开着时 Esc 不会顺带关页。
    // req 为空时不截停，Esc 照常落到关页监听。确认路径见 confirmModalOf：
    // 先 close（req 清空、弹窗卸载）再执行 onConfirm，异步期间重复 Enter /
    // 双击不会再触发。
    function ConfirmLayer() {
      var _cq = useState(confirmCtrl.getSnapshot()), confirmSnap = _cq[0], setConfirmSnap = _cq[1];
      useEffect(function () {
        return confirmCtrl.subscribe(function () { setConfirmSnap(confirmCtrl.getSnapshot()); });
      }, []);
      useEffect(function () {
        var onKey = function (e) {
          if (!e || e.key !== "Escape") return;
          if (!confirmCtrl.getSnapshot().req) return; // 无确认框不截停：放行给关页监听
          e.stopPropagation();
          confirmCtrl.close();
        };
        document.addEventListener("keydown", onKey, true);
        return function () { document.removeEventListener("keydown", onKey, true); };
      }, []);
      return confirmModalOf(confirmSnap.req, confirmCtrl.close);
    }

    function PageShell(props) {
      var onClose = props.onClose;
      // 版本信息挂页头（拉取逻辑仍在 ConfigPanel 的 loadVersion，经 setVerInfo 回写）
      var _v = useState(null), verInfo = _v[0], setVerInfo = _v[1];
      // 升级动作随更新卡留在页头：独立 busy/note/err，不复用 ConfigPanel 的
      // 面板级互斥——页头与面板各自成区，写盘目标不同（升级换插件载荷、面板
      // 写预设与配置），升级期间面板照常预览编辑互不干扰。
      var _ub = useState(false), upgBusy = _ub[0], setUpgBusy = _ub[1];
      var _un = useState(""), upgNote = _un[0], setUpgNote = _un[1];
      var _ue = useState(""), upgErr = _ue[0], setUpgErr = _ue[1];
      // 版本检测重试进行中（页头失败行的「重试」按钮禁用态）：与升级三态分开，
      // 检测失败重试不该锁升级（升级预检在服务端另做一次，不依赖这份 verInfo）。
      var _vb = useState(false), verRetryBusy = _vb[0], setVerRetryBusy = _vb[1];
      // 工具面瘦身统计（state.slim = 按已保存配置算的 {total, main}，ConfigPanel
      // 的 load / doRescan / doApply 经 props.setSlimInfo 回写）：副标题下一行，
      // 版本号 / 更新卡同区呈现。null = 未取到 / 老服务端无字段，整行零占位。
      var _sl = useState(null), slimInfo = _sl[0], setSlimInfo = _sl[1];
      // 委派效果统计（GET stats，页头瘦身行之下）：懒加载——本 effect 在首屏
      // 渲染完成后才发请求，不阻塞开面板（state 全量检测照旧先行）。只读展示
      // 拉一次不重试；服务缺失 / 拉取失败 / 响应异常一律维持 null 整卡不渲染，
      // 不为锦上添花的统计打扰使用。卸载后丢弃在途响应防置迟数据。
      var _st = useState(null), delStats = _st[0], setDelStats = _st[1];
      useEffect(function () {
        var alive = true;
        paodingApi("stats").then(function (d) {
          if (alive && d && d.ok === true) setDelStats(d);
        }).catch(function () { /* 静默降级：整卡不渲染 */ });
        return function () { alive = false; };
      }, []);
      // 语言切换 tick：页头文案（标题 / 副标题 / 菜单 / 语言项）走 t()，切换后
      // 需整体重渲染一次；ConfigPanel 内部另有 registerReload 整页重拉。
      var _lg = useState(0), langTick = _lg[0], setLangTick = _lg[1];
      useEffect(function () {
        return onLangChange(function () { setLangTick(function (n) { return n + 1; }); });
      }, []);

      // ── 页头「更多」菜单：配置导出 / 导入 ────────────────────────────────
      // 低频的整文件级操作收进菜单，页头保持一行动静。导出 / 导入写的是整份
      // 配置文件（非面板视图的局部编辑），与面板 busy 互不相干，独立 busy 态。
      var _mo = useState(false), moreOpen = _mo[0], setMoreOpen = _mo[1];
      var _eb = useState(false), expBusy = _eb[0], setExpBusy = _eb[1];
      var _ib = useState(false), impBusy = _ib[0], setImpBusy = _ib[1];
      var importFileRef = useRef(null); // 隐藏 file input（菜单项点击 → 程序化触发选文件）
      var reloadRef = useRef(null); // ConfigPanel 注册进来的 load（导入成功后整体刷新）

      // 导出：GET config/export 拿配置文件原文（服务端不存在时回基础模板），
      // Blob + a[download] 落盘，文件名以服务端给的为准（= 实际配置文件名）。
      function doExportConfig() {
        setMoreOpen(false);
        setExpBusy(true);
        paodingApi("config/export").then(function (r) {
          var name = r && typeof r.filename === "string" && r.filename ? r.filename : "dsh-paoding.config.yml";
          var blob = new Blob([r && typeof r.content === "string" ? r.content : ""], { type: "text/yaml;charset=utf-8" });
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          // revoke 留一拍：点击派发的下载任务未必当场读完 blob URL
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          toast.ok(t("menu.exported", { name: name }));
        }).catch(function (err) {
          toast.err(t("menu.exportFail", { msg: err.message }));
        }).finally(function () {
          setExpBusy(false);
        });
      }

      // 导入：选文件 → 读文本 → 确认弹窗（整体覆盖，danger 红钮）→ POST。
      // file input 复用同一个小众路径：每次先清 value，选同一个文件也能再触发。
      function pickImportFile() {
        setMoreOpen(false);
        if (!importFileRef.current) return;
        importFileRef.current.value = "";
        importFileRef.current.click();
      }

      function onImportFilePicked(e) {
        var file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        // File.text() 现代环境都有；老环境回落 FileReader，读不出只 toast 不打扰面板
        var reading = typeof file.text === "function"
          ? file.text()
          : new Promise(function (resolve, reject) {
              var reader = new FileReader();
              reader.onload = function () { resolve(String(reader.result)); };
              reader.onerror = function () { reject(new Error(t("menu.readFail"))); };
              reader.readAsText(file);
            });
        reading.then(function (text) {
          confirmCtrl.ask({
            title: t("menu.importTitle"),
            // 多行文案由 pd-modalText 的 pre-line 保留换行；工作区段会被整份
            // 替换这点必须说清（面板视图只显示一个配置对象，导入却是全文件）。
            body: t("menu.importBody", { name: file.name }),
            danger: true,
            confirmText: t("menu.importConfirm"),
            onConfirm: function () {
              setImpBusy(true);
              paodingApi("config/import", { content: text }).then(function () {
                toast.ok(t("menu.imported"));
                // 服务端 saveConfig 已改 mtime → state 缓存自动失效；这里触发
                // 面板重拉 state 并按新配置重建 assign（预览 / 提示卡一并作废）。
                if (typeof reloadRef.current === "function") reloadRef.current();
              }).catch(function (err) {
                toast.err(t("menu.importFail", { msg: err.message }));
              }).finally(function () {
                setImpBusy(false);
              });
            },
          });
        }).catch(function (err) {
          toast.err(t("menu.readFailPrefix", { msg: err.message }));
        });
      }

      // ── 恢复备份：备份列表弹层 ────────────────────────────────────────────
      // 打开即拉 GET config/backups（服务端已按新→旧排好，客户端不再排序）；
      // 行点击走 confirmCtrl 二次确认（覆盖前当前配置会先自动备份，danger 红钮
      // 与导入同款门槛），确认后 POST config/restore——成功 toast + 面板既有
      // 刷新路径（reloadRef 重拉 state 重建 assign，预览 / 提示卡一并作废，
      // 委派行显示名跟着重注册）；409 / 422 / 404 按既有错误 toast 惯例呈现
      //（本地前缀 + 服务端 message 原文），弹层留着方便换一个备份再试。
      var _bko = useState(false), bkOpen = _bko[0], setBkOpen = _bko[1];
      var _bkl = useState([]), bkList = _bkl[0], setBkList = _bkl[1];
      // bkBusy 双语义：列表拉取中（弹层显示加载行）/ 恢复请求在途（行全禁用，
      // 防双击重复回滚）。
      var _bkb = useState(false), bkBusy = _bkb[0], setBkBusy = _bkb[1];
      var _bke = useState(""), bkErr = _bke[0], setBkErr = _bke[1];

      function openBackupModal() {
        setMoreOpen(false);
        setBkOpen(true);
        setBkList([]);
        setBkErr("");
        setBkBusy(true);
        paodingApi("config/backups").then(function (d) {
          if (!d || d.ok !== true || !Array.isArray(d.backups)) throw new Error(t("menu.backupBadResponse"));
          setBkList(d.backups);
        }).catch(function (err) {
          setBkErr(t("menu.backupListFail", { msg: err.message }));
        }).finally(function () {
          setBkBusy(false);
        });
      }

      // 关弹层：恢复请求在途时不收（请求自见分晓，中途关层容易误以为没生效）。
      function closeBackupModal() {
        if (bkBusy) return;
        setBkOpen(false);
      }

      function pickBackup(item) {
        if (!item || typeof item.file !== "string" || item.file === "" || bkBusy) return;
        confirmCtrl.ask({
          title: t("menu.restoreTitle"),
          body: t("menu.restoreBody", { name: backupTagOf(item.file) }),
          danger: true,
          confirmText: t("menu.restoreConfirm"),
          onConfirm: function () {
            setBkBusy(true);
            paodingApi("config/restore", { file: item.file }).then(function () {
              toast.ok(t("menu.restored", { name: backupTagOf(item.file) }));
              setBkOpen(false);
              // 面板既有刷新路径（与「导入配置」同款）：重拉 state 重建 assign；
              // 显示名 / 角色名单可能被回滚改变，事件流委派行键控注册跟着刷新。
              if (typeof reloadRef.current === "function") reloadRef.current();
              refreshDelegateRows();
            }).catch(function (err) {
              toast.err(t("menu.restoreFail", { msg: err.message }));
            }).finally(function () {
              setBkBusy(false);
            });
          },
        });
      }

      // 备份弹层开着时的 Esc 分层（捕获级，与 ConfirmLayer 同款思路）：只收
      // 弹层本身；二次确认框开着时放行——ConfirmLayer 的监听（注册在前）先
      // stopPropagation 并只关确认框，这里不重复收弹层。
      useEffect(function () {
        if (!bkOpen) return;
        var onKey = function (e) {
          if (!e || e.key !== "Escape") return;
          if (confirmCtrl.getSnapshot().req) return; // 确认框优先：让它自己的监听去收
          e.stopPropagation();
          closeBackupModal();
        };
        document.addEventListener("keydown", onKey, true);
        return function () { document.removeEventListener("keydown", onKey, true); };
      }, [bkOpen, bkBusy]);

      // 备份列表弹层（结构对齐 confirmModalOf 的 pd-modal* 家族）：整行可点
      // 按钮列表（bak 徽标 + 本地时间 + 大小，服务端已按新→旧排好）；拉取中
      // 一行加载文案、空列表「暂无备份」、失败一行原因（不弹 toast，弹层里
      // 就地交代）。body 高度封顶出滚，备份链再长也不顶破视口。
      function backupModalOf() {
        if (!bkOpen) return null;
        var rows = bkList.map(function (it, i) {
          return h("button", {
            type: "button",
            key: it && typeof it.file === "string" && it.file ? it.file : "bak-" + i,
            className: "pd-backupItem",
            disabled: bkBusy,
            title: it && typeof it.file === "string" ? it.file : undefined,
            onClick: function () { pickBackup(it); },
          },
            h("span", { className: "pd-backupTag" }, backupTagOf(it && it.file)),
            h("span", { className: "pd-backupTime" }, backupTimeText(it && it.mtimeMs)),
            h("span", { className: "pd-backupSize" }, backupSizeText(it && it.size)));
        });
        return h("div", {
            className: "pd-modalMask",
            // 只点遮罩空白处才收（与 confirmModalOf 同款 mousedown 判据）
            onMouseDown: function (e) { if (e.target === e.currentTarget) closeBackupModal(); },
          },
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": t("menu.backupTitle") },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, t("menu.backupTitle")),
              h("button", {
                type: "button", className: "pd-modalClose", "aria-label": t("common.close"),
                onClick: closeBackupModal,
              }, h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              bkErr
                ? h("div", { className: "omd-status omd-statusError" },
                    h("span", { className: "omd-statusIcon" }, "⛔"),
                    h("span", { className: "omd-statusText" }, bkErr))
                : bkBusy && !bkList.length
                  ? h("div", { className: "pd-backupEmpty" }, t("menu.backupLoading"))
                  : bkList.length
                    ? h("div", { className: "pd-backupList" }, rows)
                    : h("div", { className: "pd-backupEmpty" }, t("menu.backupEmpty"))),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", disabled: bkBusy, onClick: closeBackupModal }, t("common.close")))));
      }

      // 菜单开着时 Esc 只收菜单（捕获级先于 PageShell 的关页监听，与
      // ConfigPanel 弹窗的 Esc 分层同款）；点菜单外空白处收菜单。
      useEffect(function () {
        if (!moreOpen) return;
        var onKey = function (e) {
          if (e && e.key === "Escape") {
            e.stopPropagation();
            setMoreOpen(false);
          }
        };
        var onClick = function (e) {
          var t = e && e.target;
          if (t && typeof t.closest === "function" &&
              (t.closest("[data-pd-more-menu]") || t.closest("[data-pd-more-btn]"))) return;
          setMoreOpen(false);
        };
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("mousedown", onClick, true);
        return function () {
          document.removeEventListener("keydown", onKey, true);
          document.removeEventListener("mousedown", onClick, true);
        };
      }, [moreOpen]);

      // 稳定的注册函数（ConfigPanel effect 依赖它）：导入成功后的整体刷新入口
      var registerReload = useCallback(function (fn) { reloadRef.current = fn; }, []);

      // 一键升级逻辑在共享的 runUpgradeFlow（页头更新卡统一走这一份）。
      function doUpgrade() {
        runUpgradeFlow(verInfo, setVerInfo, setUpgBusy, setUpgNote, setUpgErr);
      }

      // 检测失败重试：直接再拉一次 /api/paoding/version（服务端失败结果不进
      // 缓存，重试即真实检测；成功则 error 随新响应自然清空）。仍失败维持
      // 原提示——失败行常驻，重试按钮永远可用。
      function doRetryVersion() {
        setVerRetryBusy(true);
        paodingApi("version").then(function (d) {
          if (d && typeof d.current === "string" && d.current) setVerInfo(d);
        }).catch(function () { /* 仍不通：维持失败行，不额外打扰 */ }).finally(function () {
          setVerRetryBusy(false);
        });
      }
      useEffect(function () {
        var onKey = function (e) {
          if (e && e.key === "Escape" && typeof onClose === "function") onClose();
        };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, []);
      return h("div", { className: "pd-shell" },
        h("header", { className: "pd-pageHeader" },
          h("div", { className: "pd-pageTitles" },
            // 标题行：标题 + 版本号 + （有新版时的）更新卡并排；窄屏放不下时
            // 换行收纳，副标题独占下一行
            h("div", { className: "pd-titleRow" },
              h("h1", { className: "pd-pageTitle" }, t("nav.entryTitle"),
                verInfo && typeof verInfo.current === "string" && verInfo.current
                  ? h("span", { className: "pd-versionTag" }, versionTagOf(verInfo.current))
                  : null),
              versionRowOf(verInfo, { busy: upgBusy, onUpgrade: doUpgrade, note: upgNote, error: upgErr, onRetry: doRetryVersion, retryBusy: verRetryBusy })),
            h("p", { className: "pd-pageSubtitle" },
              t("menu.subtitle")),
            // 工具面瘦身统计一行：按已保存的全局配置（state.slim，见 setSlimInfo
            // 回写点）；数据未就绪 / 老服务端无该字段时零占位。
            slimInfo ? h("p", { className: "pd-slimLine" }, slimLineText(slimInfo)) : null,
            // 委派效果卡：紧贴瘦身行之下（delegationCardOf 自判，统计没拉到 /
            // 服务缺失时返回 null 整卡不渲染）。
            delegationCardOf(delStats)),
          // 页头「更多」菜单：整份配置文件的导出 / 导入（低频操作收进来，页头
          // 不添第二排按钮）。定位锚点用相对定位的薄包裹层，下拉复用工作区
          // 「更多」的 omd-tabMenu / omd-tabMenuItem 既有样式；靠右对齐（inline
          // style 压掉类里的 left:2px），避免从页头右缘向右溢出。
          h("div", { style: { position: "relative", flex: "none" } },
            h("button", {
              type: "button",
              className: "omd-restorePill",
              "data-pd-more-btn": "1",
              "aria-haspopup": "menu",
              "aria-expanded": moreOpen ? "true" : "false",
              title: t("menu.moreBtnTip"),
              onClick: function () { setMoreOpen(!moreOpen); },
            }, t("menu.moreBtn")),
            moreOpen ? h("div", {
                className: "omd-tabMenu",
                role: "menu",
                "aria-label": t("menu.menuLabel"),
                "data-pd-more-menu": "1",
                style: { left: "auto", right: "0", top: "calc(100% + 6px)", minWidth: "180px" },
              },
              h("button", {
                type: "button", role: "menuitem", className: "omd-tabMenuItem",
                disabled: expBusy || impBusy,
                onClick: doExportConfig,
              }, h("span", { className: "omd-tabText" }, expBusy ? t("menu.exporting") : t("menu.exportItem"))),
              h("button", {
                type: "button", role: "menuitem", className: "omd-tabMenuItem",
                disabled: expBusy || impBusy,
                onClick: pickImportFile,
              }, h("span", { className: "omd-tabText" }, impBusy ? t("menu.importing") : t("menu.importItem"))),
              // 恢复备份：弹备份列表（行点选 → confirmCtrl 二次确认 → POST
              // restore，见 openBackupModal / pickBackup / backupModalOf）。
              h("button", {
                type: "button", role: "menuitem", className: "omd-tabMenuItem",
                disabled: expBusy || impBusy,
                onClick: openBackupModal,
              }, h("span", { className: "omd-tabText" }, t("menu.restoreItem"))),
              // 语言切换项：label 刻意不进字典——按当前语言显示「另一端」的叫法，
              // 中文界面显示 English，英文界面显示中文（语言名用母语写才认得出）。
              h("button", {
                type: "button", role: "menuitem", className: "omd-tabMenuItem",
                title: t("menu.langTip"),
                onClick: function () {
                  setMoreOpen(false);
                  setLang(pdLang() === "zh" ? "en" : "zh");
                  if (typeof reloadRef.current === "function") reloadRef.current();
                },
              }, h("span", { className: "omd-tabText" }, pdLang() === "zh" ? "English" : "中文")))
              : null,
            // 隐藏选文件 input：导入入口的程序化触发器（样式零占位）
            h("input", {
              ref: importFileRef,
              type: "file",
              accept: ".yml,.yaml,text/yaml,text/plain",
              style: { display: "none" },
              onChange: onImportFilePicked,
            })),
          h("button", {
            type: "button",
            className: "pd-closeBtn",
            "aria-label": t("nav.closeAria"),
            title: t("nav.closeTip"),
            onClick: function () { if (typeof onClose === "function") onClose(); },
          }, h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
        h(ConfigPanel, { setVerInfo: setVerInfo, setSlimInfo: setSlimInfo, registerReload: registerReload }),
        // 恢复备份弹层：fixed 遮罩不占布局流；置于 ConfirmLayer 之前——两者
        // 遮罩同为 z-60，按 DOM 顺序叠放，行点选后的二次确认框必须盖在列表
        // 弹层之上。
        backupModalOf(),
        // 反馈 toast 宿主：订阅模块级 toast 控制器，悬浮于操作坞上方
        h(ToastHost),
        // 通用确认弹窗层：订阅 confirmCtrl（发起方见各 confirmCtrl.ask 调用点），
        // 放根数组末尾——fixed 遮罩不占布局流，页头 / 面板发起的确认都盖得住；
        // 无确认时渲染 null，仅保留 Esc 监听。
        h(ConfirmLayer));
    }

    // 全页 overlay 挂载：容器 div append 到会话中栏，createRoot 渲染 PageShell。
    // 懒挂载——首次打开才建容器 / 发起面板首屏请求；此后容器常驻（CSS 按
    // active 属性显隐），被 React 挤掉时由观察器重挂。
    function mountPanel(controller) {
      if (typeof document === "undefined" || typeof window === "undefined" || !ReactDOMClient) {
        return function () {};
      }
      var root;
      var container;
      var ensure = function () {
        if (!controller.getSnapshot().open) return; // 懒挂载：只在打开态维护容器
        if (container && container.isConnected) return;
        if (container) {
          if (root) root.unmount();
          root = undefined;
          container = undefined;
        }
        var column = document.querySelector(CONVERSATION_COLUMN_SELECTOR);
        if (!column) return;
        container = document.createElement("div");
        // dataset 驼峰转数据属性：dshPaodingView → data-dsh-paoding-view
        container.dataset.dshPaodingView = "";
        container.className = "pd-panelView";
        column.appendChild(container);
        root = ReactDOMClient.createRoot(container);
        root.render(h(PageShell, {
          onClose: function () { controller.close(); },
        }));
      };
      // 会话中栏晚于插件挂载 / 容器被挤掉时重挂
      var waitObserver = new MutationObserver(ensure);
      waitObserver.observe(document.body, { childList: true, subtree: true });

      var suppressCompatibilityClose = false;
      var applyActive = function () {
        if (!controller.getSnapshot().open) {
          document.documentElement.removeAttribute(ACTIVE_ATTR);
          return;
        }
        // 互斥：先广播请走 taskboard / ssh（兼容旧面板的事件协议），清掉三家
        // 的 active 属性（它们的属性观察者会自行关闭），再点亮自己、以
        // detail:"paoding" 对外宣告。
        suppressCompatibilityClose = true;
        try {
          document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "ssh" }));
          document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "taskboard" }));
        } finally {
          suppressCompatibilityClose = false;
        }
        document.documentElement.removeAttribute(MNEMON_ACTIVE_ATTR);
        document.documentElement.removeAttribute(TASKBOARD_ACTIVE_ATTR);
        document.documentElement.removeAttribute(SSH_ACTIVE_ATTR);
        document.documentElement.setAttribute(ACTIVE_ATTR, "");
        ensure();
        document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "paoding" }));
      };
      // 其它全页面板激活（taskboard / ssh / mnemon）→ 关闭自己
      var onOtherPanelActivate = function (event) {
        if (suppressCompatibilityClose || !controller.getSnapshot().open) return;
        var detail = event && event.detail;
        if (detail === "taskboard" || detail === "ssh" || detail === "mnemon") controller.close();
      };
      var onSidebarContextClick = function (event) {
        if (!controller.getSnapshot().open) return;
        var target = event.target;
        if (target && typeof target.closest === "function" && target.closest(SIDEBAR_CONTEXT_SELECTOR)) {
          controller.close();
        }
      };
      // 属性兜底：发现自己 active 丢了、或别的面板 active 了 → 关闭
      var activeObserver = new MutationObserver(function () {
        if (!controller.getSnapshot().open) return;
        var html = document.documentElement;
        if (!html.hasAttribute(ACTIVE_ATTR) || html.hasAttribute(MNEMON_ACTIVE_ATTR) ||
          html.hasAttribute(TASKBOARD_ACTIVE_ATTR) || html.hasAttribute(SSH_ACTIVE_ATTR)) {
          controller.close();
        }
      });
      activeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [ACTIVE_ATTR, MNEMON_ACTIVE_ATTR, TASKBOARD_ACTIVE_ATTR, SSH_ACTIVE_ATTR],
      });

      document.addEventListener("click", onSidebarContextClick, true);
      document.addEventListener(ACTIVATE_EVENT, onOtherPanelActivate);
      var unsubscribe = controller.subscribe(applyActive);
      applyActive();
      return function () {
        document.removeEventListener("click", onSidebarContextClick, true);
        document.removeEventListener(ACTIVATE_EVENT, onOtherPanelActivate);
        activeObserver.disconnect();
        waitObserver.disconnect();
        unsubscribe();
        document.documentElement.removeAttribute(ACTIVE_ATTR);
        if (root) root.unmount();
        root = undefined;
        if (container) container.remove();
        container = undefined;
      };
    }

    // ── cordis client 插件入口 ──────────────────────────────────────────────

    // 依赖声明：底部入口（sidebar.footer.action）与事件流委派行
    // （tool.call.toolview）都走宿主 slots 键控槽，须声明 slots 服务——
    // cordis 护栏下未声明服务的 ctx.slots 取不到（旧代码此处曾是空表，
    // 槽口挂载全部静默折返，入口不显示）。
    var inject = ["slots"];

    function apply(ctx) {
      var controller = createWorkspaceController();
      var manual = []; // ctx.effect 不可用时的保底清理函数累计
      // 优先交给宿主 effect 管生命周期（重载自动清理）；ctx.effect 不可用或
      // 调用失败则直接执行并自行累计清理，保底不炸。
      function track(mount, label) {
        if (ctx && typeof ctx.effect === "function") {
          try {
            ctx.effect(mount, label);
            return;
          } catch (err) { /* 落入手动路径 */ }
        }
        try {
          var dispose = mount();
          if (typeof dispose === "function") manual.push(dispose);
        } catch (err) {
          if (ctx && ctx.logger && typeof ctx.logger.warn === "function") {
            ctx.logger.warn("paoding-config-ui: " + label + " mount failed: " + String((err && err.message) || err));
          }
        }
      }
      track(function () { return mountFooterEntry(ctx, controller); }, "paoding-config-ui: footer entry");
      track(function () { return mountPanel(controller); }, "paoding-config-ui: page overlay");
      track(function () { return mountWorkspaceMenuBridge(controller); }, "paoding-config-ui: workspace menu bridge");
      track(function () { return mountDelegateRows(ctx); }, "paoding-config-ui: delegate rows");
      return function () {
        manual.forEach(function (dispose) {
          try { dispose(); } catch (err) { /* 单个清理失败不阻断其余清理 */ }
        });
      };
    }

    exports.inject = inject;
    exports.apply = apply;

    return module.exports;
  },
});
