# chuanban-antigravity-theme-patch

Antigravity桌面客户端的暖纸主题、字体分层、局部汉化与实时指标技能。通过本机CDP注入，不修改应用原包。

这是 [Anarcadia原仓库](https://github.com/Anarcadia/chuanban-antigravity-theme-patch) 的维护fork，基于原主题方案和 [Notion v4](https://chuanban.notion.site/chuanban-antigravity-theme-patch-db7c5846f37546be9481cd791aed0554) 整理可复用安装器。原作者：船板 / Anarcadia；本fork维护与验证：徐长顺。

## 本fork的变化

- **真实上下文**：从每次调用记录读取预算，替代固定256k；未知时不猜。
- **Gemini 4默认1M**：独立可选项，默认关闭；改变真实发送参数，覆盖普通界面的gRPC-Web JSON。
- **可运行安装资产**：分文件维护主题、词典、指标和请求增强，提供备份、服务与恢复流程。
- **可核实验收**：区分API测试、普通界面发送、完整重启；以后台调用记录为准。
- **v4完整性复核**：保留341词条及13类动态规则，补齐A/B/C字体、纯样式轻量路线、独立开关、1200ms指标刷新和真实预算分级颜色，见逐项覆盖表。

## 使用

将完整仓库交给执行端Agent，按 [SKILL.md](SKILL.md) 操作。不要只复制SKILL.md而丢失scripts、assets和references。

```sh
git clone https://github.com/changshunxu520/chuanban-antigravity-theme-patch.git
cd chuanban-antigravity-theme-patch
node --test tests/*.test.mjs
node scripts/install.mjs --help
node scripts/install.mjs --preset high-contrast
```

需要Gemini 4默认1M时显式加 `--gemini-1m`；已有安装使用 `--upgrade`，先查看备份。要求macOS、Node.js >=22.5（建议24）、可用的本机CDP。安装器不自动下载字体或切换原生外观模式。Windows/Linux服务安装尚未实现。

## 三种不同的数值

| 项目 | 含义 |
| --- | --- |
| 模型窗口 | 模型服务提供的能力上限 |
| 最近调用预算 | 客户端为那一次调用记录的预算，指标分母来自这里 |
| 压缩阈值 | 另一项配置，不能仅从窗口或百分比推断 |

在Antigravity 2.28.2的Gemini 4 Medium上验证过：默认预算256,000；请求1,048,576总窗口后，扣除65,536输出预留，实际预算为 **983,040**。普通聊天发送和重启后新会话均得到此值。这不是对所有版本、账号的承诺。

## 文档

- [上下文字段与1M参数](references/context-budget.md)
- [验证流程和证据边界](references/verification.md)
- [关闭、卸载与恢复](references/recovery.md)
- [字体检查](references/fonts.md)
- [来源与改动记录](references/provenance.md)
- [Notion v4逐项覆盖与有意差异](references/notion-v4-coverage.md)
- [配色与A/B/C字体选择](references/appearance.md)
- [轻量路线与Windows原则](references/platforms-lite.md)

1M增强依赖补丁服务，长会话可能增加延迟和额度消耗；不改变安全权限或账号配额。尚未做近百万tokens输入压力测试，客户端升级后应重新验证。

字体、用户数据库、账号信息和本机验收截图不随仓库分发。本fork保留上游来源说明，不为上游内容或第三方字体另行授予许可。
