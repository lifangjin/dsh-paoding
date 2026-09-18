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
