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
    // latest 为 null 一律不显示新版部分；检测失败（error 非空）改渲染弱化失败行
    // （⚠ 版本检测失败 · 重试，完整原因在 title 悬浮提示），不再整行静默。
    // opts（可省）：busy/busyOp 复用面板级互斥（任何操作进行中都禁用升级，
    // 升级进行中也反过来禁用其他按钮），onUpgrade 为点击回调。
