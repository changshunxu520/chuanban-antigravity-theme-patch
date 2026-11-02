# 来源与变更记录

## 维护版0.5.2（2026-11-02）

修复真实遥测包含合法uint64元数据时被过严校验整体拒绝的问题，并保留对实际展示token字段的安全检查。修复新建会话环境/分支栏透出边框灰色的问题：输入框外壳使用卡片底色，轮廓改为1px内描边，不再把边框色当整块背景。新增对应回归测试。

## 上游

- 作者：船板 / [Anarcadia](https://github.com/Anarcadia)
- 仓库：[chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)
- 本fork起点：`a8241fa`，上游GitHub的2026-10-19 v2说明。
- 更新参考：[Notion安装说明](https://chuanban.notion.site/chuanban-antigravity-theme-patch-db7c5846f37546be9481cd791aed0554)，读取版本为2026-11-01 v4。

Notion采用滚动/分块加载。只读取初始DOM可能只得到介绍与执行流程，不能据此断言正文缺失。GitHub与Notion版本也可能不一致，应实际核对。

## 维护版0.5.0（2026-11-02）

后续维护版0.5.1对Notion v4全部275个内容块重新核对，补齐A/B/C字体选项、纯样式路线、独立汉化/修复开关、原生样式恢复入口、1200ms指标刷新和预算分级色；详见 [逐项覆盖表](notion-v4-coverage.md)。词典与指标布局脚本均和当日v4源码核对，未减少原有词条或布局能力。

维护与验证：徐长顺。

- 整理主题、词典、指标为独立运行文件，提供无第三方npm依赖的macOS安装器。
- 根据实际遥测读取同次调用预算，替代固定256000和猜测的剩余压缩容量。
- Gemini 4 1M请求增强独立可选、默认关闭；覆盖gRPC-Web JSON普通界面发送，并验证完整重启后的新会话。
- 原方案局部调整：阻止不变词条重复DOM写入、扩展汉化保护区、浅色墨色覆盖限定在Light模式、缩放接口不存在时跳过、字体名称按实际PostScript映射。
- 增加合成数据与临时目录测试、版本边界、备份和恢复说明；不发布真实用户数据。

原始Git历史保留。上游仓库未提供单独LICENSE文件；本fork不为上游文本、代码或第三方字体额外授予许可，不将其重新声明为MIT等协议。
