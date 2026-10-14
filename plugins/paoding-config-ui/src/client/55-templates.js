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
