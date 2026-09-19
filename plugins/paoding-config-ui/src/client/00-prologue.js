/**
 * paoding-config-ui — DSH Web client bundle (手写，零构建)
 *
 * 加载机制（借鉴 dsh-better-sidebar，DSH 0.1.1-rc.1 实测通过）：
 *  - dsh-client-modules 节点半扫描本包 package.json 的 dsh.client 声明 +
 *    exports["./client"]，把本文件编入 window.__DSH_BOOT__ 并以
 *    /plugins/dsh-paoding/client.js 服务（图行 id = 包名 dsh-paoding）。
 *  - 浏览器内核为 manifest 中每个插件创建 loader 条目并激活，故本文件
 *    必然被拉取执行；__ModuleLoader__.load 的 id 必须等于包名（图行 id）。
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
window.__ModuleLoader__.load({
  id: "dsh-paoding",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;
    var useState = React.useState, useEffect = React.useEffect, useCallback = React.useCallback, useRef = React.useRef;
    var P = require("@deepseek-ai/dsh-client-ui-primitives");

