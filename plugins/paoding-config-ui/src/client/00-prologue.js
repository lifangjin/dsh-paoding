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

