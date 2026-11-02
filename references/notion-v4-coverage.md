# Notion v4 功能完整性核对

核对日期：2026-11-02。来源：[作者Notion](https://chuanban.notion.site/chuanban-antigravity-theme-patch-db7c5846f37546be9481cd791aed0554)，页面版本2026-11-01 21:25 / v4。本次读取4个数据分块、275个块，包含表格和嵌套列表，分页游标已结束；未只检查初始可见正文。

“覆盖”表示对应说明/实现存在并完成下述验证，不意味着所有客户端版本现场验收通过。原文§7仅提供Windows原则，fork也保留原则而不声称提供Windows安装器。

## 逐项映射

| v4要求 | fork位置 | 核对结果 |
| --- | --- | --- |
| 执行流程、环境检查、配色选择、可选增强、字体、常驻、验收、卸载 | SKILL.md / scripts/install.mjs / references/recovery.md | 保留；已有用户授权不重复询问，旧安装保护更明确 |
| §0 本机CDP，不改App/asar | scripts/controller.mjs | 保留本机目标核对与端口验证 |
| §1 原生外观局限与非法预设白屏原因 | references/appearance.md / preset.js | 补回原因说明；合法预设迁移保留 |
| §2 高对比/净白/复古三套完整配色 | theme.css / references/appearance.md | 所有原配色常量、边框、底栏文字及透明度保留，契约测试通过 |
| §2 官方原生样式恢复 | --preset default-light / recovery.md | 补齐显式恢复模式；不虚称任意版本点击官方Default Light会自动100%还原 |
| §3 默认A方案四层字体 | theme.css | UI、阅读、代码/终端、输入框分层保留，字体内部名作实测修正 |
| §3 备选B全更纱、C原生苹方回退 | --font-scheme B/C / scripts/options.mjs | 0.5.0文档与可选路径不足，本次补齐并测试 |
| §3 Solid Ink六项微调 | theme.css / appearance.md | 450/520/500字重、目录解耦、负字距、墨色、0.2/0.15px阴影、底栏强化保留 |
| §4 主包扫描而非仅DOM扫描 | audit.js | 保留label/description、JSX、aria/title三类扫描；额外适配main.js |
| §4 全量基准词典 | dictionary.js | 与本次Notion代码块SHA-256完全一致；实际341个键 |
| §4 动态正则 | localization.js | 正文实际13类，全部执行用例通过；原更新摘要写11条不据此删减 |
| §4 title/aria标签、MutationObserver | localization.js | 保留，新增相同值不写回与标签保护区检查 |
| §4 代码/终端/正文/输入/路径/指标排除 | localization.js | 保留并扩大保护；不把技术英文全局替换 |
| §5 双通道注入、固定样式id、去重、2500ms自愈 | controller.mjs / options.mjs / preset.js | 保留；正常停止还移除注册，异常强杀后仍须完全退出客户端 |
| §5 Storage合法预设、防白屏、真实底层迁移、热切换 | preset.js | 保留；追加Dark隔离与显式原生模式优先，行为测试通过 |
| §5 设置路由死锁修复，保留history.state | guards.js | 保留，行为测试通过；可--no-fixes关闭 |
| §5 Cmd+-/=/0缩放桥接 | guards.js | 保留实现；原生桥接不存在时跳过，不吞掉快捷键 |
| §5.5 SQLite只读、WAL签名缓存、Protobuf字段 | metrics-server.js | 保留；增加解析边界检查及真实预算字段 |
| §5.5 TPS流式/端到端回退、TTFT、输出量 | metrics-server.js | 原公式保留；不把极短流式耗时造成的虚高TPS当真实值 |
| §5.5 输入/缓存/思考/正文、本轮多步、会话累计 | metrics-server.js | 保留；无usage不伪造0，历史模型/生成编号补充用于归属 |
| §5.5 上下文75%/90%分色 | metrics-server.js / metrics.css | 0.5.0改真实预算时误删，本次恢复；仅对有真实分母的预算分级，不称压缩倒计时 |
| §5.5 左中右、<150px独立第二行、ResizeObserver | metrics-client.js | 与Notion代码块完全一致；隔离浏览器宽/窄布局通过 |
| §5.5 body级fixed悬浮卡、双层阴影、4px/0.12s、两段网格 | metrics-client.js / metrics.css | 保留；隔离浏览器DOM/计算样式通过；补充深色文字对比修正 |
| §5.5 路由监听+Runtime binding即时请求 | metrics-client.js / controller.mjs | 保留400ms路由监听与绑定推送；不承诺端到端<5ms |
| §5.5 1200ms指标刷新 | options.mjs / controller.mjs | 0.5.0曾合并为2500ms，本次恢复独立1200ms与串行防重叠 |
| §6 全项验收 | references/verification.md | 保留并扩展实际预算、普通界面、重启、关闭开关验证 |
| §7 Windows原则 | references/platforms-lite.md | 补回端口/数据库路径、任务计划、字体和Consolas回退说明，自动安装仍未实现 |
| §8 官方颜色轻量路线 | references/platforms-lite.md | 补回，无需安装守护或Node |
| §8 仅字体/CSS一次注入 | --style-only / controller apply/restore | 0.5.0只有no-service，不能等同纯样式；本次补齐无Storage hook、无监听、无巡检模式 |
| 执行流程中的汉化/修复开关 | --no-localization / --no-fixes | 本次补齐独立选择，旧配置缺省保持原默认开启 |

## 有意保留的修正

1. 固定256000、压缩剩余量改为同次调用真实预算；无数据不猜。
2. Gemini 4默认1M为fork新增且默认关闭，不是v4主题安装的隐含步骤。
3. 不承诺“100%零遗漏”“切换<5ms”或“卸载字体和原生设置也自动100%恢复”；提供可核对的实际行为和恢复范围。
4. 字体文件不分发，不将第三方网盘称为官方许可证明；按真实内部名称加载。
5. 运行包统一Node>=22.5，不保留旧Node+ws依赖路线；纯原生颜色操作不需要Node。

## 本次证据

- 341词条源码完全一致；13类动态汉化执行用例全部通过。
- 原palette/墨色值、预设热切换、非法值迁移、Dark隔离、路由state保护、缩放桥接降级已测试。
- 浏览器合成界面：宽栏middle且指标位于模型与发送之间；窄栏bottom且物理位于控制行之后；tooltip在body下、fixed、两段标题、双阴影、0.12s过渡。
- 浏览器合成深色界面：指标/数值文字rgb(229,229,229)，卡片背景rgb(36,39,58)。这不替代目标客户端完整现场测试。
- 新功能开关、A/B/C、纯样式无Storage/监听、恢复与1200/2500ms调度由离线测试覆盖。

当前用户机器正在运行的旧补丁未被这次核对重新部署。发布版安装器与旧现场版本的能力边界应区分；目标机器安装后仍需按验收清单检查字体、窗口和客户端兼容性。
