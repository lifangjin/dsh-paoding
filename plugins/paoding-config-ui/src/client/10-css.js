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

