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

    function statusRow(cls, iconNode, text) {
      return h("div", { className: cls, role: cls === "omd-statusError" ? "alert" : undefined },
        iconNode ? h("span", { className: "omd-statusIcon" }, iconNode) : null,
        h("span", { className: "omd-statusText" }, text));
    }

    // projBadge（可选）：项目级技能角标文案（如「项目」），仅技能项在
    // 工作区视角下、该技能来自工作区项目根时传入；其余网格不传不渲染。
    function toolItem(tool, tag, checked, disabled, onChange, key, projBadge) {
      return h("label", { key: key, className: "omd-toolItem", title: tool },
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

    // 「可续」选中时的行内成本提示（定稿文案）。
    var ROLE_BG_CONTINUABLE_HINT =
      "可续会话跨轮保留子代理上下文：产出不满可用 send_message 就地续修；" +
      "无自动清理，落盘与 token 成本随轮次累积，建议仅多轮打磨类角色开启。";

    // persistence 后端缺失时的警告（定稿文案；只警示不拦截，预览 / 应用照常）。
    var ROLE_BG_PERSISTENCE_WARN =
      "未检测到会话持久化后端（sessionPersistence）。可续模式在委派时会直接报错 " +
      "PERSISTENCE_UNAVAILABLE：需在 ~/.dsh/cordis.patch.yml 挂 " +
      "@deepseek-ai/dsh-session-persistence-jsonl（host 层、机器级改动，详见 docs/orchestration.md）。";


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
        "运行时识别不可用，已回退文件扫描（" + err + "）");
    }

    // 版本号展示归一：tag 缺前缀 v 时补上（服务端原样透传 GitHub tag_name，
    // 通常自带 v，本地版本号则来自 package.json 不带 v，显示口径统一为 vX.Y.Z）。
    function versionTagOf(tag) {
      var s = String(tag || "");
      return /^v/i.test(s) ? s : "v" + s;
    }

    // 版本提示（渲染在页头标题旁，由 PageShell 持有）：常态版本号不进正文；
    // updateAvailable 时这里渲染醒目提示卡：releaseUrl 新标签页打开 release 页、
    // 「升级」按钮走 onUpgrade（一键 dsh plugin update 自升级），并保留当前版本号。
    // latest 为 null（含检测失败 error 的情况）一律不显示新版部分——检测失败
    // 时服务端也只回 200 + error 字段，这里整行静默。
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
            throw err;
          }
          if (!d) throw new Error("HTTP " + r.status + "（响应不是 JSON）");
          return d;
        });
      }).catch(function (err) {
        if (ctrl && err && err.name === "AbortError") throw new Error("请求超时（" + (PAODING_API_TIMEOUT_MS / 1000) + "s 无响应）");
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
    function versionRowOf(v, opts) {
      if (!v || typeof v.current !== "string" || !v.current) return null;
      if (!(v.updateAvailable && v.latest)) return null;
      var busy = !!opts && !!opts.busy;
      var note = (opts && opts.note) || "";
      var error = (opts && opts.error) || "";
      return h("div", { className: "omd-versionRow omd-versionNew" },
        h("span", { className: "omd-versionIcon" }, "🆙"),
        h("span", { className: "omd-versionText" },
          "新版本 " + versionTagOf(v.latest) + " 可用 · ",
          // 只信 https://github.com/ 的 release 链接；其余取值一律不渲染 <a>。
          v.releaseUrl && /^https:\/\/github\.com\//.test(v.releaseUrl)
            ? h("a", {
                className: "omd-versionLink",
                href: v.releaseUrl,
                target: "_blank",
                rel: "noreferrer",
              }, "查看更新")
            : null),
        typeof (opts && opts.onUpgrade) === "function"
          ? h("button", {
              type: "button",
              className: "omd-upgradeBtn",
              disabled: busy,
              onClick: opts.onUpgrade,
            }, busy ? "升级中…" : "升级")
          : null,
        busy ? h("span", { className: "omd-upgradeHint" }, "下载安装中，最长约 2 分钟") : null,
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
              "aria-label": "关闭提示",
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
      // 文案照实：模型缺失（只配 provider，后端会忽略）时按约定不带空格接全角括号
      var label = model
        ? "当前配置：" + (provider || "（跟随主 agent 路由）") + " · " + model
        : "当前配置：" + (provider || "（跟随主 agent 路由）") + " ·（无模型，后端忽略）";
      return {
        value: rtValue,
        extra: { value: rtValue, label: label },
      };
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

    // 三态 → 标签文案（中文，与 tooltip 口径一致）
    function wsTagTextOf(kind) {
      return kind === "project" ? "项目" : kind === "pending" ? "待应用" : "全局";
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
        (row.sessionCount != null ? " · " + row.sessionCount + " 会话" : "") +
        (kind === "project"
          ? " · 项目配置（预设 " + (m && m.presetId) + "）"
          : kind === "pending"
            ? " · 已保存项目配置、预设未生成（点「保存并应用」生效）"
            : " · 跟随全局配置");
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
              confirmText: opts.confirmText || "确认",
              cancelText: opts.cancelText || "取消",
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
            h("button", { type: "button", className: "pd-modalClose", "aria-label": "关闭", onClick: close },
              h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
          h("div", { className: "pd-modalBody" },
            h("div", { className: "pd-modalText", id: "pd-confirmBody" }, req.body)),
          h("div", { className: "pd-modalFooter" },
            // 焦点默认落在确认钮（危险操作落在取消钮）：开窗即可 Enter 确认 /
            // 取消，与原生 confirm 的键盘习惯对齐；danger 反向落焦是让破坏性
            // 操作多一道显式点击的门槛。弹窗关闭即整体卸载，重开重新自动聚焦。
            h(P.Button, { variant: "outline", size: "md", autoFocus: !!req.danger, onClick: close },
              req.cancelText || "取消"),
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
            }, req.confirmText || "确认"))));
    }

    // ── 主面板 ─────────────────────────────────────────────────────────────

    function ConfigPanel(props) {
      var _s = useState(null), data = _s[0], setData = _s[1];
      var _e = useState(null), error = _e[0], setError = _e[1];
      var _a = useState(null), assign = _a[0], setAssign = _a[1];
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      var _op = useState(null), busyOp = _op[0], setBusyOp = _op[1];
      var _p = useState(null), preview = _p[0], setPreview = _p[1];
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
      var _ws = useState(null), activeWs = _ws[0], setActiveWs = _ws[1]; // 当前配置对象：null = 全局默认；否则工作区绝对路径
      // 视角切换计数：switchWorkspace 每次自增，拼进全部未受控（defaultValue）
      // 编辑器的 key——否则切 tab 不重挂，旧工作区输入框里未提交的文本会在
      // blur 时写进新工作区的 assign（串台）。现有各 rev 只覆盖「校验失败 /
      // 恢复默认」重挂，不覆盖切视角，故统一再加这一维。
      var _swr = useState(0), switchRev = _swr[0], setSwitchRev = _swr[1];
      var _wsl = useState([]), wsList = _wsl[0], setWsList = _wsl[1]; // 宿主工作区列表（GET /api/paoding/workspaces；失败降级为空数组，pill 由配置文件键兜底）
      var _wslt = useState(false), wsListTried = _wslt[0], setWsListTried = _wslt[1]; // 列表请求尘埃落定标记（成败均置位）：pendingOpenWs 消费条件用
      var _wsao = useState(false), wsAddOpen = _wsao[0], setWsAddOpen = _wsao[1]; // 「添加工作区」弹窗开合态（旧版是 tab 条下方的内联展开行）
      var _wsap = useState(""), wsAddPath = _wsap[0], setWsAddPath = _wsap[1];
      var _wsae = useState(""), wsAddErr = _wsae[0], setWsAddErr = _wsae[1];
      var _rao = useState(false), roleAddOpen = _rao[0], setRoleAddOpen = _rao[1]; // 「新建自定义 agent 角色」弹窗开合态（原原生 prompt 改模态框）
      var _ran = useState(""), roleAddName = _ran[0], setRoleAddName = _ran[1];
      var _radn = useState(""), roleAddDispName = _radn[0], setRoleAddDispName = _radn[1]; // 弹窗第二字段「显示名」（可选；残值语义同 roleAddName，成功提交才清）
      var _rabm = useState("one-shot"), roleAddBgMode = _rabm[0], setRoleAddBgMode = _rabm[1]; // 弹窗第三字段「会话模式」：'one-shot' | 'continuable'（残值语义同上，成功提交才复位）
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
        }).catch(function (err) { setError(err.message); });
      }, [api, buildTargetAssignments]);

      useEffect(load, [load]);

      // 工作区列表：面板加载时拉一次宿主注册表（与 state 并行）。失败降级为
      // 空列表——workspaceRowsOf 会用 state.existing.workspaces 的键兜底出 pill，
      // 绝不阻塞面板。
      var loadWorkspaces = useCallback(function () {
        api("workspaces").then(function (d) {
          if (!d || d.ok !== true || !Array.isArray(d.items)) throw new Error("工作区列表响应格式异常");
          setWsList(d.items);
          setWsListTried(true);
        }).catch(function () {
          setWsList([]); // 静默降级：只用配置文件里已有的工作区键
          setWsListTried(true);
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
        else toast.warn("工作区 " + target + " 不在列表里，未切换 tab");
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
          setWsSkillsErr(cached ? "" : "该工作区技能列表拉取失败，技能网格已回退用户级技能");
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
          setWsSkillsErr("该工作区技能列表拉取失败，技能网格已回退用户级技能");
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
            toast.ok((r.created === false ? "工作区已在列表里：" : "已注册工作区：") + wsPath + "；配置后点「保存并应用」生成专属预设");
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
          if (!d || d.ok !== true || !groups) throw new Error("模型目录响应格式异常");
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
        if (!/^[a-z][a-z0-9_-]{1,31}$/.test(name)) { setRoleAddErr("角色名须为 2-32 位小写字母/数字/下划线/连字符"); return; }
        // 内置名不可经「新建」再造：已删除（不在 roles、在 roles_remove）的
        // 内置名在此拦截并引导走恢复区，避免同一内置名同时出现在卡片流与
        // 「已删除的内置角色」恢复区；仍正常存在的内置名由下方「已存在」命中。
        if (DEFAULT_ROLES.indexOf(name) !== -1) { setRoleAddErr('内置角色不可新建（"' + name + '"如已删除，请在下方「已删除的内置角色」区恢复）'); return; }
        // 已存在检查从 setAssign updater 挪到外层：报错要走弹窗内错误行，
        // setState 副作用不能塞进 updater；闭包 assign 与点击时刻一致，双击
        // 极端场景下重复创建也只是同形状覆盖，幂等无害。
        if (assign.roles[name]) { setRoleAddErr('角色 "' + name + '" 已存在'); return; }
        // 显示名校验与 roleTitleBlock 的 commitRoleName 同源（不含 \r \n、
        // trim 后 ≤60、空 = null）：新建时就把显示名写进出厂形状，省得建完
        // 再去卡片里补一枪。报错走弹窗内错误行（不 toast）——此刻弹窗还开着，
        // 错误行就贴在输入框下面，比 toast 更贴输入现场。
        var dispRaw = String(roleAddDispName == null ? "" : roleAddDispName);
        if (/[\r\n]/.test(dispRaw)) { setRoleAddErr("显示名不能包含换行（\\r / \\n）"); return; }
        var dispTrim = dispRaw.trim();
        if (dispTrim.length > 60) { setRoleAddErr("显示名过长：trim 后最多 60 字符"); return; }
        var disp = dispTrim === "" ? null : dispTrim; // 空 / 纯空白 = null：事件流标题回落 toolName
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          // 新角色全字段出厂形状：与 buildAssignments / restoreBuiltinRole 条目一致
          //（model/provider 置 null = 跟随主 agent 当前模型；background_mode
          // 用弹窗单选值，字面量 'one-shot' | 'continuable'）。name 是可选
          // 显示名（null = 用 toolName 当标题），不再恒 null。
          next.roles[name] = {
            persona: null,
            name: disp,
            model: null,
            provider: null,
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
        setRoleAddErr("");
        toast.ok('已新建角色 "' + name + '"，记得「保存并应用」');
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
        if (!/^[a-z][a-z0-9_-]{1,31}$/.test(v)) { setRoleRenameErr("角色名须为 2-32 位小写字母/数字/下划线/连字符"); return; }
        if (DEFAULT_ROLES.indexOf(v) !== -1) { setRoleRenameErr('不可改成内置角色名 "' + v + '"'); return; }
        // 已存在检查从 setAssign updater 挪到外层（与 submitRoleAdd 同款）：
        // 报错要走弹窗内错误行，setState 副作用不能塞进 updater；闭包 assign
        // 与点击时刻一致。
        if (assign.roles[v]) { setRoleRenameErr('角色 "' + v + '" 已存在'); return; }
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
        toast.ok('已重命名 "' + name + '" → "' + v + '"，记得「保存并应用」');
      }

      function removeRole(name) {
        // 原原生 confirm 改通用确认弹窗：删除属破坏性操作，danger 红底确认钮。
        confirmCtrl.ask({
          title: "删除自定义角色",
          body: "删除自定义角色 \"" + name + "\"？",
          danger: true,
          confirmText: "确认删除",
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
          title: "删除内置角色",
          body: "删除内置角色 \"" + name + "\"？\n该角色的委派工具、工具面、persona 与主 agent 的委派指引将一并移除；\n可在下方「已删除的内置角色」区一键恢复。",
          danger: true,
          confirmText: "确认删除",
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
      // 不保留删前的模型固定配置。background_mode 置 'one-shot'（出厂缺省）。
      function restoreBuiltinRole(name) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.roles_remove = (next.roles_remove || []).filter(function (r) { return r !== name; });
          var defTools = (data && data.blocks && data.blocks[name]) || [];
          next.roles[name] = { persona: null, name: null, model: null, provider: null, background_mode: "one-shot", tools: defTools.slice() };
          return next;
        });
      }

      function doPreview() {
        if (!assign) return;
        var reqAssign = assign;
        setBusy(true);
        setBusyOp("preview");
        setPreview(null);
        // workspace 透传当前配置对象（null = 全局默认），服务端据此选生成落点。
        api("preview", { assignments: reqAssign, workspace: activeWsRef.current }).then(function (r) {
          if (assignRef.current !== reqAssign) return; // 生成期间配置已改：结果过期，不挂旧预览
          setPreview(r);
          setScrollReq("preview"); // 预览成功后自动滚动定位到预览生成区
        }).catch(function (err) { toast.err(err.message); }).finally(function () {
          setBusy(false);
          setBusyOp(null);
        });
      }

      // 预览时效：assign 一变即作废已挂出的预览——预览文本对应生成时刻的目标
      // 配置，继续挂着「✅ 生成成功」只会误导（switchWorkspace 自带
      // setPreview(null) 只覆盖切视角，这里兜住其余一切编辑路径；生成中的
      // 请求由 doPreview 里的 assignRef 快照比对作废）。
      useEffect(function () {
        setPreview(null);
      }, [assign]);

      function doApply() {
        if (!assign) return;
        var wsPath = activeWsRef.current;
        // 确认文案按配置对象分流（语义原样保留）：全局覆盖共享的 orchestrator
        // 预设（现状文案）；工作区落独立预设、只并进 workspaces 段，全局预设
        // 不受影响。写预设非破坏性操作，danger 不置位（主色确认钮）。
        var applyMsg = wsPath
          ? "确认应用当前配置？将为该工作区生成专属预设（orchestrator-<slug>）并保存到 dsh-paoding.config.yml 的 workspaces 段，全局 orchestrator 预设不受影响。"
          : "确认应用当前配置？将写入 preset 并覆盖 ~/.dsh/.agent-presets/orchestrator，且保存到 dsh-paoding.config.yml。";
        confirmCtrl.ask({
          title: "保存并应用",
          body: applyMsg,
          danger: false,
          confirmText: "确认应用",
          onConfirm: function () {
            setBusy(true);
            setBusyOp("apply");
            api("apply", { assignments: assign, workspace: wsPath }).then(function (r) {
              var notes = (r.roleResults || []).map(function (x) {
                return x.role + ": " + x.intent.length + " → " + x.kept.length;
              });
              var summary = notes.join("；") + "。";
              if (wsPath) {
                // 工作区应用：点明生成的 preset id，提示去预设选择器选用（工作区
                // 预设不会自动成为默认，须在新建会话时显式选择）。
                toast.ok("已生成预设 " + (r.presetId || "orchestrator-<slug>") + "：" + summary + "新建会话时在预设选择器选它。" + (r.staleNote ? " ⚠️ patch 较新，重新应用后生效。" : ""));
                // 服务端 apply 后已重刷状态缓存：静默拉一次，让 workspaceMeta /
                // existing.workspaces 跟上（全局路径保持旧交互，不额外拉取）。
                api("state").then(function (d) {
                  setData(d);
                  setAssign(buildTargetAssignments(d, activeWsRef.current));
                }).catch(function () { /* 静默：落盘已成功，仅展示层暂旧 */ });
              } else {
                toast.ok("已安装：" + summary + (r.staleNote ? " ⚠️ patch 较新，重启后生效。" : " 重启 DSH 或新建会话后生效。"));
              }
              // 显示名 / 角色名单可能变了：事件流委派行键控注册跟着刷新（行组件
              // 标题读 delegateMeta，刷新即可见，无需重开会话）。
              refreshDelegateRows();
            }).catch(function (err) { toast.err(err.message); }).finally(function () {
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
          // 回调参数 d 即重扫后的新 state，直接报数字，补回原徽标条的信息量
          toast.ok("已重新检测：" + (d.inventory || []).length + " 个 MCP / 插件工具 · " + (d.skills || []).length + " 个技能");
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
          title: "全局默认：写入共享的 orchestrator 预设",
          onClick: function () { switchWorkspace(null); },
        }, h("span", { className: "omd-tabText" }, "全局默认"))];
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
            row.sessionCount != null ? h("span", { className: "omd-tabCount" }, row.sessionCount + " 会话") : null);
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
            title: "其余 " + hidden.length + " 个工作区",
            "aria-haspopup": "listbox",
            "aria-expanded": wsMenuOpen ? "true" : "false",
            onClick: function () { setWsMenuOpen(!wsMenuOpen); },
          },
            h("span", { className: "omd-tabText" }, "更多"),
            h("span", { className: "omd-tabMoreCount" }, String(hidden.length))));
        }
        // 末尾「＋ 添加工作区」：与 tab 同尺寸的弱化按钮（ghost），点击打开输入弹窗。
        tabs.push(h("button", {
          key: "__add__",
          type: "button",
          className: "omd-tab omd-tabAdd",
          title: "注册新的工作区目录",
          disabled: busy,
          onClick: function () { setWsAddOpen(true); setWsAddErr(""); },
        },
          h("span", { className: "omd-groupIcon" }, ic(P.IconPlusOutline16, 14)),
          h("span", { className: "omd-tabText" }, "添加工作区")));
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
          h("div", { className: "omd-tabs", role: "tablist", "aria-label": "配置对象", ref: tabsRowRef }, tabs),
          // 宽度测量层：常驻渲染（不随 wsFitCount 变），挪出视口且不可见，只把
          // 各 tab 的自然宽度喂给装填算法。「更多」原型计数固定写 99 按两位数
          // 算宽，与装填里的 SAFETY 余量搭配。
          h("div", { className: "omd-tabsMeasure", ref: tabsMeasureRef, "aria-hidden": "true" },
            measureTabOf("__global__", "全局默认"),
            order.map(function (row) {
              var m = meta[row.path];
              var mk = wsTagOf(existingWs, meta, row.path);
              return h("button", { key: row.path, type: "button", "data-ws-key": row.path, className: "omd-tab", tabIndex: -1 },
                h("span", { className: "omd-tabText" }, wsLabelOf(row)),
                h("span", { className: "omd-tabTag omd-tabTag" + mk.charAt(0).toUpperCase() + mk.slice(1) },
                  wsTagTextOf(mk)),
                row.sessionCount != null ? h("span", { className: "omd-tabCount" }, row.sessionCount + " 会话") : null);
            }),
            h("button", { type: "button", "data-ws-key": "__more__", className: "omd-tab omd-tabMore", tabIndex: -1 },
              h("span", { className: "omd-tabText" }, "更多"),
              h("span", { className: "omd-tabMoreCount" }, "99")),
            h("button", { type: "button", "data-ws-key": "__add__", className: "omd-tab omd-tabAdd", tabIndex: -1 },
              h("span", { className: "omd-groupIcon" }, ic(P.IconPlusOutline16, 14)),
              h("span", { className: "omd-tabText" }, "添加工作区"))),
          // 「更多」下拉：菜单项信息结构与 tab 同款（小圆点 / 名称 / 会话数，
          // title 拼法也一致），点击直接切过去。role=listbox/option 表达
          // 「从清单里选一个配置对象」的语义，aria-selected 标当前项。
          wsMenuOpen && hidden.length > 0
            ? h("div", { className: "omd-tabMenu", role: "listbox", "aria-label": "更多工作区" },
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
                    row.sessionCount != null ? h("span", { className: "omd-tabCount" }, row.sessionCount + " 会话") : null);
                }))
            : null),
          h("div", { className: "omd-hint" },
            "「全局默认」写入共享的 orchestrator 预设；选中某个工作区后，预览 / 应用会生成该工作区专属预设（orchestrator-<目录名>），两者互不影响。"));
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
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": "添加工作区" },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, "添加工作区"),
              h("button", { type: "button", className: "pd-modalClose", "aria-label": "关闭", onClick: closeWsModal },
                h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              h("label", { className: "pd-modalLabel" }, "工作区目录绝对路径"),
              h("div", { className: "omd-wsSuggestWrap" },
                h("input", {
                  type: "text",
                  className: "omd-nameInput omd-wsAddInput",
                  value: wsAddPath,
                  placeholder: "输入工作区目录绝对路径，如 /Users/me/code/project-a",
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
              h("div", { className: "omd-hint" }, "目录需已存在；已注册的目录重复提交幂等返回。")),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", disabled: busy, onClick: closeWsModal }, "取消"),
              h(P.Button, {
                variant: "primary",
                size: "md",
                disabled: busy || String(wsAddPath).trim() === "",
                onClick: submitWorkspace,
              }, busyOp === "wsadd" ? "添加中…" : "确认添加"))));
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
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": "新建自定义 agent 角色" },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, "新建自定义 agent 角色"),
              h("button", { type: "button", className: "pd-modalClose", "aria-label": "关闭", onClick: closeRoleAddModal },
                h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              h("label", { className: "pd-modalLabel" }, "角色 toolName（主 agent 的委派调用名）"),
              h("input", {
                type: "text",
                className: "omd-nameInput",
                value: roleAddName,
                placeholder: "输入英文小写角色名，如 reviewer",
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
              h("label", { className: "pd-modalLabel" }, "显示名（可选）"),
              h("input", {
                ref: roleAddDispRef,
                type: "text",
                className: "omd-nameInput",
                value: roleAddDispName,
                // 占位语义与 roleTitleBlock 的 subject=toolName 一致：留空 = 事件流标题回落 toolName
                placeholder: "如 代码评审，留空 = 用 toolName",
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
              h("label", { className: "pd-modalLabel" }, "会话模式"),
              h("div", { className: "omd-nameRow" },
                h("label", { className: "omd-toolItem" },
                  h("input", {
                    type: "radio",
                    className: "omd-check",
                    name: "pd-bgm-roleadd",
                    checked: roleAddBgMode !== "continuable",
                    onChange: function () { setRoleAddBgMode("one-shot"); },
                  }),
                  h("span", { className: "omd-toolName" }, "一次性（one-shot）")),
                h("label", { className: "omd-toolItem" },
                  h("input", {
                    type: "radio",
                    className: "omd-check",
                    name: "pd-bgm-roleadd",
                    checked: roleAddBgMode === "continuable",
                    onChange: function () { setRoleAddBgMode("continuable"); },
                  }),
                  h("span", { className: "omd-toolName" }, "可续（continuable）"))),
              roleAddBgMode === "continuable"
                ? h("div", { className: "omd-hint" }, ROLE_BG_CONTINUABLE_HINT)
                : null,
              roleAddBgMode === "continuable" && data && data.persistenceAvailable === false
                ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), ROLE_BG_PERSISTENCE_WARN)
                : null,
              roleAddErr ? statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), roleAddErr) : null,
              h("div", { className: "omd-hint" },
                "角色名须为 2-32 位小写字母/数字/下划线/连字符，小写字母开头；内置名不可新建。显示名可选，不能换行，trim 后最多 60 字符，留空用 toolName 当标题。新角色工具面默认放开全部检测到的工具，可在卡片里再收窄。会话模式缺省一次性（one-shot），选「可续」后仍可在角色卡里改。")),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", onClick: closeRoleAddModal }, "取消"),
              h(P.Button, {
                variant: "primary",
                size: "md",
                disabled: String(roleAddName).trim() === "",
                onClick: submitRoleAdd,
              }, "确认新建"))));
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
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": "重命名自定义角色" },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, "重命名自定义角色"),
              h("button", { type: "button", className: "pd-modalClose", "aria-label": "关闭", onClick: closeRoleRenameModal },
                h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              h("label", { className: "pd-modalLabel" }, "新 toolName（主 agent 的委派调用名）"),
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
                "2-32 位小写字母/数字/下划线/连字符，小写字母开头；不可改成内置名或已存在的名字。skills 里的引用自动迁移；改名后需重启 / 新会话生效。")),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", onClick: closeRoleRenameModal }, "取消"),
              h(P.Button, {
                variant: "primary",
                size: "md",
                // 空值 / 与旧名相同都禁用确认：后者点确认只会空转收窗，禁用
                // 让按钮状态与「确实改了名」对齐。
                disabled: String(roleRenameVal).trim() === "" || String(roleRenameVal).trim() === roleRenameFor,
                onClick: submitRoleRename,
              }, "确认重命名"))));
      }

      if (!data || !assign) {
        // 面板没起来（含 state 加载失败）才走这条整页分支：失败渲染常驻错误行，
        // 不进 toast——此刻页面还没有内容可依托，错误必须一直可见。
        return h("div", { className: "pd-page" },
          error
            ? statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), error)
            : h("div", { className: "omd-loading" },
                h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16)),
                h("span", null, "加载检测状态…")));
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
          activeWs !== null ? "用户级 + 该工作区项目级技能" : "仅用户级技能");
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
            h("span", null, "persona（可选，覆盖默认角色说明）"),
            h("span", { className: "omd-personaEdit" }, ic(P.IconEditOutline16, 14))),
          open ? h("div", { className: "omd-personaBody" },
            h("textarea", {
              key: "omd-persona-" + name + "-" + switchRev, // 切视角重挂：defaultValue 显示新目标的 persona
              className: "omd-textarea",
              defaultValue: assign.roles[name].persona || "",
              placeholder: "输入该角色的 persona 说明…",
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
            h("div", { className: "omd-hint" }, "技能引导会自动追加到 persona 末尾；自定义角色必填此说明。"))
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
            h("span", null, "人设追加（主 agent 提示词尾部，可编辑）"),
            h("span", { className: "omd-personaEdit" }, ic(P.IconEditOutline16, 14))),
          extraOpen ? h("div", { className: "omd-personaBody" },
            h("textarea", {
              key: "omd-extra-" + extraRev + "-" + switchRev,
              className: "omd-textarea omd-extraArea",
              defaultValue: val,
              placeholder: "留空并保存 = 不追加任何内容（默认 codegraph 规则将被移除）…",
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
              }, "恢复默认"),
              h("span", { className: "omd-extraHint" },
                "保存并应用时按此追加到主 agent persona 末尾（顺序：SRC 本体 → 技能行 → 此处）。改动需重启 GUI / 新会话生效。")),
            h("div", { className: "omd-hint" }, "清空保存 = 移除默认 codegraph 规则（配置键 main_agent_persona_extra 记为 ''）。"))
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
            toast.warn("主 agent 显示名（仅 preset 显示名）不能包含换行（\\r / \\n），未保存");
            setDisplayNameRev(displayNameRev + 1); // 重挂 input，回到上次生效值
            return;
          }
          var v = s.trim();
          if (s !== "" && v === "") {
            toast.warn("主 agent 显示名（仅 preset 显示名）不能为纯空白（清空字段或点「恢复默认」= 默认显示名），未保存");
            setDisplayNameRev(displayNameRev + 1);
            return;
          }
          if (v.length > 60) {
            toast.warn("主 agent 显示名（仅 preset 显示名）过长：trim 后最多 60 字符，未保存");
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
          h("div", { className: "omd-glabel" }, "主 agent 显示名（仅 preset 显示名）"),
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
            h("button", { type: "button", className: "omd-extraRestore", disabled: busy, onClick: restoreMainDisplayName }, "恢复默认")),
          h("div", { className: "omd-hint" },
            "仅替换预设显示名，persona 身份行（You are the …）不动；留空 = 默认「编排模式 (Orchestrator)」（工作区预设用派生名）。改动需重启 GUI / 新会话生效。"));
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
            toast.warn('角色 "' + name + '" 显示名不能包含换行（\\r / \\n），未保存');
            bumpRoleNameRev(name); // 重挂 input，回到上次生效值
            return;
          }
          var v = s.trim();
          if (v.length > 60) {
            toast.warn('角色 "' + name + '" 显示名过长：trim 后最多 60 字符，未保存');
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
            isCustom ? "角色显示名（事件流委派行标题；不动 toolName / persona）" : "角色显示名（persona 身份句主语 + 事件流委派行标题；不动工具名/调用名）"),
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
              ? '留空 = 事件流显示 toolName（' + name + '）；保存并应用后生效（仅 GUI 展示，不影响生成产物与调用名）。'
              : '留空 = 默认身份（如 "You are the ' + subject + ' agent."）；已为该角色自定义 persona 时仅作事件流标题。'));
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
          function labelOf(key) { return key === "provider" ? "provider" : "专用模型"; }
          function commitRoleModel(key, raw) {
            var s = String(raw == null ? "" : raw);
            if (/[\r\n]/.test(s)) {
              toast.warn('角色 "' + name + '" ' + labelOf(key) + "不能包含换行（\\r / \\n），未保存");
              bumpRoleModelRev(name); // 重挂 input，回到上次生效值
              return;
            }
            var v = s.trim();
            if (v.length > 120) {
              toast.warn('角色 "' + name + '" ' + labelOf(key) + "过长：trim 后最多 120 字符，未保存");
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
              toast.warn('角色 "' + name + '"：provider 仅在同时配置模型时生效（后端将忽略），已保存');
            }
            if (v === "") bumpRoleModelRev(name); // 清空 = 跟随主 agent：重挂显示占位
          }
          return h("div", { className: "omd-mainName" },
            h("div", { className: "omd-glabel" }, "专用模型（可选；留空 = 跟随主 agent 当前模型）"),
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
                placeholder: "provider（留空=跟随主 agent）",
                spellCheck: false,
                disabled: busy,
                onBlur: function (e) { commitRoleModel("provider", e.target.value); },
              })),
            h("div", { className: "omd-hint" },
              "模型目录不可用（" + (modelGroupsErr || "未知错误") + "），已回退手输。写入该角色委派块的 agentOptions；含冷恢复在内，子 agent 固定用该模型。provider 需与模型成对（如 deepseek-official）。"));
        }

        // ── 下拉模式：选项来自 /api/paoding/models ────────────────────────
        var options = modelOptionsOf(modelGroups);
        var sel = roleModelSelectionOf(options, role.provider || null, role.model || null);
        var children = [h("option", { key: "follow", value: "" }, "跟随主 agent 当前模型")];
        options.forEach(function (opt) {
          children.push(h("option", { key: opt.value, value: opt.value },
            opt.modelName + "（" + opt.providerName + "）"));
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
          h("div", { className: "omd-glabel" }, "专用模型（可选；留空 = 跟随主 agent 当前模型）"),
          h("div", { className: "omd-nameRow" },
            h("select", {
              key: "omd-roleModel-" + name, // 每角色独立实例；模式 / 选项集切换可整体重挂
              className: "omd-nameInput",
              disabled: busy,
              value: sel.value,
              onChange: function (e) { commitRoleModelOption(e.target.value); },
            }, children)),
          h("div", { className: "omd-hint" },
            "选项来自 DSH 已注册的模型路由；留空 = 跟随主 agent，主 agent 换模型时未固定的角色跟着变。"));
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
          h("div", { className: "omd-glabel" }, "会话模式"),
          h("div", { className: "omd-nameRow" },
            bgOption("one-shot", "一次性（one-shot）", !continuable, false),
            bgOption("continuable", "可续（continuable）", continuable, true)),
          continuable ? h("div", { className: "omd-hint" }, ROLE_BG_CONTINUABLE_HINT) : null,
          continuable && data.persistenceAvailable === false
            ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), ROLE_BG_PERSISTENCE_WARN)
            : null);
      }

      function roleCard(name) {
        var isMain = name === "__main__";
        var display = isMain ? "主 agent" : name;
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
            h("span", { className: "omd-roleBadge" }, isMain ? "固定" : (isCustom ? "自定义" : "内置")),
            h("span", { className: "omd-roleCount" },
              (isMain ? ((data.restrictBase || []).length + a.main_agent_extra.length - (a.main_agent_remove || []).length) : a.roles[name].tools.length) + " 个工具")),
          // 自定义角色改名按钮：toolName 是身份键（委派调用名 / skills 引用），
          // 与内置角色的「显示名」不是一回事——那个只改 persona 主语。
          isCustom
            ? h("button", {
                type: "button",
                className: "omd-roleEdit",
                title: '重命名角色 "' + name + '"（toolName = 委派调用名）',
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
                title: isCustom ? '删除角色 "' + name + '"' : '删除内置角色 "' + name + '"（可在下方恢复）',
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
          body.push(h("div", { className: "omd-glabel" }, "基础工具（取消勾选即从主 agent 移除——写入 main_agent_remove）"));
          body.push(h("div", { className: "omd-toolGrid" },
            (data.restrictBase || []).map(function (t) {
              return toolItem(t, "base", (a.main_agent_remove || []).indexOf(t) === -1, busy,
                function (e) { setMainRemove(t, e.target.checked); }, t);
            })));
          // host 检测库存按角色卡同口径拆两组：mcp__ 前缀 → 「MCP 工具」，
          // 其余（mnemon_* 等插件直注册工具）→ 「插件工具」。勾选逻辑不变，
          // 都写入 main_agent_extra。
          var mainInv = data.inventory || [];
          var mainMcpTools = mainInv.filter(function (t) { return hostTool(t); });
          var mainPluginTools = mainInv.filter(function (t) { return !hostTool(t); });
          body.push(h("div", { className: "omd-glabel" }, "MCP 工具（可加入主 agent）"));
          body.push(h("div", { className: "omd-toolGrid" },
            mainMcpTools.length
              ? mainMcpTools.map(function (t) {
                  return toolItem(t, "mcp", a.main_agent_extra.indexOf(t) !== -1, busy,
                    function (e) { setMainExtra(t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "未检测到 MCP 工具")));
          body.push(h("div", { className: "omd-glabel" }, "插件工具（可加入主 agent）"));
          body.push(h("div", { className: "omd-toolGrid" },
            mainPluginTools.length
              ? mainPluginTools.map(function (t) {
                  return toolItem(t, "plugin", a.main_agent_extra.indexOf(t) !== -1, busy,
                    function (e) { setMainExtra(t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "未检测到插件工具")));
          body.push(h("div", { className: "omd-glabel" }, "技能分配（read 按需：勾选 = persona 写入技能行，主 agent 用 read 加载正文）", skillScopeNote()));
          body.push(gridSkills.length
            ? h("div", null,
                h("div", { className: "omd-toolGrid" }, gridSkills.map(function (s) {
                  return toolItem(s, "read按需", a.main_agent_skills.indexOf(s) !== -1, busy,
                    function (e) { setMainSkill(s, e.target.checked); }, s + "s",
                    gridProj && gridProj.has(s) ? "项目" : null);
                })),
                h("div", { className: "omd-glabel" }, "内联全文（硬生效，每轮固定 persona 开销，适合 caveman 等风格技能）"),
                h("div", { className: "omd-toolGrid" }, gridSkills.map(function (s) {
                  return toolItem(s, "内联全文", a.main_agent_skills_inline.indexOf(s) !== -1, busy,
                    function (e) { setMainSkillInline(s, e.target.checked); }, s + "i",
                    gridProj && gridProj.has(s) ? "项目" : null);
                })))
            : h("div", { className: "omd-empty" }, "未检测到技能目录"));
          body.push(mainPersonaExtraBlock());
        } else {
          // 模型行位置：内置角色卡在「显示名」之后、工具面区之前；自定义角色卡
          // 在 body 顶部（其无默认显示名可换，不加 builtinNameBlock）。两个场景
          // 通用同一 roleModelBlock——下拉模式成对写 provider + model（不存在
          // 「只配 provider」）；目录不可用降级双 input 时才可能出现该状态（后端
          // warn 并忽略）。留空 = 跟随主 agent 当前模型。
          // 「会话模式」单选紧随模型行（内置 / 自定义通用）：缺省一次性，
          // 选可续时行内给成本提示 + persistence 缺失警告（如有）。
          body.push(roleTitleBlock(name, isCustom));
          body.push(roleModelBlock(name));
          body.push(roleBgModeBlock(name));
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
          body.push(h("div", { className: "omd-glabel" }, "基础工具"));
          body.push(h("div", { className: "omd-toolGrid" },
            baseTools.length
              ? baseTools.map(function (t) {
                  return toolItem(t, "base", checked.indexOf(t) !== -1, busy,
                    function (e) { setRoleTools(name, t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "无")));
          body.push(h("div", { className: "omd-glabel" }, "MCP 工具"));
          body.push(h("div", { className: "omd-toolGrid" },
            mcpTools.length
              ? mcpTools.map(function (t) {
                  return toolItem(t, "mcp", checked.indexOf(t) !== -1, busy,
                    function (e) { setRoleTools(name, t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "未检测到 MCP 工具")));
          body.push(h("div", { className: "omd-glabel" }, "插件工具"));
          body.push(h("div", { className: "omd-toolGrid" },
            pluginTools.length
              ? pluginTools.map(function (t) {
                  return toolItem(t, "plugin", checked.indexOf(t) !== -1, busy,
                    function (e) { setRoleTools(name, t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "未检测到插件工具")));
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
            gridProj && gridProj.has(s) ? h("span", { className: "omd-skillProj" }, "项目") : null,
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
        return rows.length ? rows : h("div", { className: "omd-empty" }, "未检测到技能目录");
      }

      var customRoles = Object.keys(assign.roles).filter(function (n) { return DEFAULT_ROLES.indexOf(n) === -1; });

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
      }, busyOp === "apply" ? "处理中…" : "保存并应用");

      var previewBtn = h(P.Button, {
        variant: "outline",
        size: "md",
        disabled: busy,
        onClick: doPreview,
        icon: busyOp === "preview"
          ? h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16))
          : ic(P.IconCordisPluginOutline14, 14),
      }, busyOp === "preview" ? "生成中…" : "预览生成");

      var rescanBtn = h(P.Button, {
        variant: "ghost",
        size: "md",
        disabled: busy,
        onClick: doRescan,
        icon: busyOp === "rescan"
          ? h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16))
          : ic(P.IconRefreshOutline16, 16),
      }, busyOp === "rescan" ? "检测中…" : "重新检测");

      return h("div", { className: "pd-page", ref: rootRef },
        // 运行时识别降级：持续状态（不是事件），内联一行小字贴标签行上方，
        // 平时（runtimeOk 正常）零占位
        runtimeNoteOf(data),

        // persistence 警告横幅：仅当前视角确有可续角色且 host 层持久化后端
        // 缺失时出现（判定见上方 persistenceWarn），其余场合零占位
        persistenceWarn
          ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), ROLE_BG_PERSISTENCE_WARN)
          : null,

        // 配置对象（全局默认 / 各工作区，标签页）
        workspaceBarOf(),

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
            h("span", null, "角色与工具"),
            h("span", { className: "omd-count" }, Object.keys(assign.roles).length)),
          roleCard("__main__"),
          // 内置角色卡只渲染 assign.roles 里存在的（roles_remove 中的已删名不重建、不渲染）
          DEFAULT_ROLES.filter(function (n) { return !!assign.roles[n]; }).map(function (n) { return roleCard(n); }),
          customRoles.map(function (n) { return roleCard(n); }),
          // 已删除的内置角色恢复区（仅删除过内置角色时出现）
          (assign.roles_remove || []).length
            ? h("div", { className: "omd-restoreRow" },
                h("div", { className: "omd-restoreTitle" }, "已删除的内置角色"),
                h("div", { className: "omd-chips" }, (assign.roles_remove || []).map(function (n) {
                  return h("button", {
                    type: "button",
                    key: n,
                    className: "omd-restorePill",
                    title: '恢复内置角色 "' + n + '"（工具面重建为内置默认 allow）',
                    onClick: function () { restoreBuiltinRole(n); },
                  }, "恢复 " + n);
                })),
                h("div", { className: "omd-hint" },
                  "恢复后卡片回到上方内置列表；工具面取内置默认（不沿用删前自定义配置）。"))
            : null,
          h("button", { type: "button", className: "omd-addRole", onClick: openRoleAddModal },
            h("span", { className: "omd-addRoleIcon" }, ic(P.IconPlusOutline16, 16)),
            h("span", null, "新建自定义 agent 角色"))),

        // 技能分配
        h("div", { className: "omd-group" },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconSkillOutline16, 14)),
            h("span", null, "技能分配（软约束：写入对应 agent 的 persona 引导）"),
            skillScopeNote(),
            h("span", { className: "omd-count" }, gridSkills.length)),
          // 工作区技能拉取失败的降级提示（一句话）：此刻网格数据源已回落用户级。
          activeWs !== null && wsSkillsErr
            ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), wsSkillsErr)
            : null,
          skillsBlock()),

        // 预览生成（预览成功后才出现）
        preview ? h("div", { className: "omd-group", ref: previewRef },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconDataOutline16, 14)),
            h("span", null, "预览生成")),
          h("div", { className: "omd-previewSummary" },
            "✅ 生成成功（未写盘）" +
            (preview.presetId ? " · 预设 " + preview.presetId : "") +
            (preview.roleResults || []).map(function (r) {
              return " · " + r.role + ": " + r.intent.length + " → " + r.kept.length;
            }).join("")),
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
        useEffect(function () {
          return controller.subscribe(function () { setOpenState(controller.getSnapshot().open); });
        }, []);
        return h("button", {
          type: "button",
          className: "pd-footerBtn" + (wide ? "" : " pd-footerRail"),
          "data-active": open ? "true" : undefined,
          "aria-label": "庖丁配置",
          "aria-haspopup": "dialog",
          "aria-expanded": open ? "true" : "false",
          title: wide ? undefined : "庖丁配置",
          onClick: function () { controller.toggle(); },
        },
          h(P.IconSkillOutline16, { size: wide ? 16 : 18 }),
          wide ? h("span", { className: "pd-footerLabel" }, "庖丁配置") : null);
      };
    }

    function mountFooterEntry(ctx, controller) {
      if (typeof document === "undefined") return function () {};
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function" || typeof ctx.slots.register !== "function") {
        return function () {}; // 槽口不可用（老宿主）：静默不挂，面板仅失去底部入口
      }
      var Entry = makeFooterEntry(controller);
      var dispose = ctx.slots.inject("sidebar.footer.action", function () {
        return ctx.slots.register({ name: "sidebar.footer.action", id: "paoding-config", order: 10, label: "庖丁配置" }, Entry);
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
    var DELEGATE_TITLE_FALLBACK = {
      search_external: "外部检索",
      design: "设计",
      implement: "实现",
      search_internal_deep: "深搜",
    };
    // 静态委派工具：不在 roles 键里（无条目、不可删不可改名），恒注册。
    var DELEGATE_STATIC_TOOLS = ["search_internal_deep"];

    function buildDelegateMeta(d) {
      var cfg = globalConfigOf(d) || (d && d.suggested) || {};
      var roles = (cfg && typeof cfg.roles === "object" && cfg.roles) || {};
      var removed = Array.isArray(cfg.roles_remove) ? cfg.roles_remove : [];
      var titles = {};
      var tools = DELEGATE_STATIC_TOOLS.slice();
      DELEGATE_STATIC_TOOLS.forEach(function (n) { titles[n] = DELEGATE_TITLE_FALLBACK[n] || n; });
      Object.keys(roles).forEach(function (n) {
        if (removed.indexOf(n) !== -1) return; // 已删内置角色：委派工具不存在，键命中不了，不注册
        if (tools.indexOf(n) === -1) tools.push(n);
        var nm = roles[n] && typeof roles[n].name === "string" ? roles[n].name.trim() : "";
        titles[n] = nm !== "" ? nm : (DELEGATE_TITLE_FALLBACK[n] || n);
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
      var title = delegateMeta.titles[toolName] || DELEGATE_TITLE_FALLBACK[toolName] || toolName;
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
        mine.setAttribute("aria-label", "庖丁配置");
        mine.setAttribute("title", "打开庖丁配置并切到该工作区");
        var walker = document.createTreeWalker(mine, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
          var t = node.nodeValue;
          if (t.indexOf("重命名") !== -1 || t.toLowerCase().indexOf("rename") !== -1) {
            node.nodeValue = t.replace(/重命名|Rename/gi, "庖丁配置");
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
              toast.warn("宿主工作区「" + title + "」还没在庖丁注册，已打开全局默认");
            }
          }).catch(function () {
            controller.open();
            toast.warn("工作区列表拉取失败，已打开全局默认");
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
    // POST /api/paoding/upgrade，服务端 spawn `dsh plugin --profile <profile>
    // update dsh-paoding` 原地换版本，分钟级操作。确认弹窗（原原生 confirm
    // 改通用确认弹窗，confirmCtrl 单例见 70 片段）文案按挂载形态分流：
    // dev link 直连形态（layout 由服务端 version 路由按包根 .git 判定）无法
    // 就地升级，把手动切换命令说在前头；installed（registry 版）原地换版本，
    // 从简。反馈（成功 note / 失败 err，含子进程输出尾部）都收在卡内，不与
    // 面板的 toast 反馈混流。升级非破坏性操作，danger 不置位；弹窗本体由
    // PageShell 末尾的 ConfirmLayer 渲染（页头与面板发起的确认共用一层）。
    function runUpgradeFlow(verInfo, setVerInfo, setUpgBusy, setUpgNote, setUpgErr) {
      if (!verInfo || !verInfo.latest) return;
      var isDev = verInfo.layout === "dev";
      var msg = isDev
        ? "当前为开发 link 直连形态：无法就地升级，请手动执行 dsh plugin add dsh-paoding@latest 切换到 registry 版本。仍要继续尝试吗？"
        : "确定升级到 " + versionTagOf(verInfo.latest) + "？升级将通过 dsh plugin update 原地换版本，完成后需重启 DSH 生效。";
      confirmCtrl.ask({
        title: "升级 dsh-paoding",
        body: msg,
        danger: false,
        confirmText: "升级",
        onConfirm: function () {
          setUpgBusy(true);
          setUpgNote("");
          setUpgErr("");
          paodingApi("upgrade", {}).then(function (r) {
            if (r && r.upToDate) { setUpgNote("已是最新版本"); return; }
            var done = versionTagOf((r && r.version) || verInfo.latest);
            setUpgNote((r && r.message) || ("✅ 已升级到 " + done + "，重启 DSH 后新版本生效（preset 会自动按新版重生成）"));
            // 重拉版本信息：服务端有 1 小时缓存且本进程挂的还是旧代码，重启前
            // 更新卡可能仍在（重启后自然消失），以此处的生效提示为准。
            paodingApi("version").then(function (d) {
              if (d && typeof d.current === "string" && d.current) setVerInfo(d);
            }).catch(function () { /* 静默：升级已完成，重拉失败不打扰 */ });
          }).catch(function (err) {
            // 失败要醒目：截服务端透传的子进程输出尾部 ~300 字符并入 err，方便
            // 定位 pnpm 缓存权限（EPERM）之类环境问题，不用翻服务端日志。
            var tail = typeof err.output === "string" && err.output ? "：" + err.output.slice(-300) : "";
            setUpgErr(err.message + tail);
          }).finally(function () {
            setUpgBusy(false);
          });
        },
      });
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

      // 一键升级逻辑在共享的 runUpgradeFlow（页头更新卡统一走这一份）。
      function doUpgrade() {
        runUpgradeFlow(verInfo, setVerInfo, setUpgBusy, setUpgNote, setUpgErr);
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
              h("h1", { className: "pd-pageTitle" }, "庖丁配置",
                verInfo && typeof verInfo.current === "string" && verInfo.current
                  ? h("span", { className: "pd-versionTag" }, versionTagOf(verInfo.current))
                  : null),
              versionRowOf(verInfo, { busy: upgBusy, onUpgrade: doUpgrade, note: upgNote, error: upgErr })),
            h("p", { className: "pd-pageSubtitle" },
              "为主 agent 与子 agent 编排工具、技能与角色，预览并应用生成的 agent.cordis.yml。")),
          h("button", {
            type: "button",
            className: "pd-closeBtn",
            "aria-label": "关闭庖丁配置",
            title: "关闭（Esc）",
            onClick: function () { if (typeof onClose === "function") onClose(); },
          }, h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
        h(ConfigPanel, { setVerInfo: setVerInfo }),
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
