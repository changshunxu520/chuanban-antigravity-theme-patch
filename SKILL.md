---
name: chuanban-antigravity-theme-patch
description: 安装、更新或撤销 Google Antigravity 桌面客户端的暖纸高对比主题、字体分层、局部汉化与实时指标；当用户需要核实真实上下文预算，或明确要求将 Gemini 4 默认总窗口设为 1M 时使用。通过本机 CDP 注入，不修改应用原包。1M 请求增强为独立可选项，不因安装主题而自动启用。
compatibility: macOS；Node.js >=22.5，建议24；Antigravity已安装且本机CDP可用。Windows/Linux需单独适配服务安装。
---

# Antigravity 界面与上下文补丁

在船板原主题方案上整理的维护 fork。使用完整仓库中的脚本与资产；来源、版本见 [references/provenance.md](references/provenance.md)。不是官方扩展，不承诺跨版本永远有效。

## 约束与默认值

- 不改 `.app`、`.asar`、客户端二进制或会话数据库；只连接当前客户端的 `127.0.0.1` 调试目标。
- 指标读取与请求修改是两项功能。安装主题/指标不等于授权改变模型预算。
- 默认高对比版、指标开启、**Gemini 4 1M 关闭**。用户已明确的偏好直接沿用，不重复询问。
- 只读 SQLite；凭证仅用于客户端既有本机认证，不打印、不写入日志或发布。
- 接口200、补丁计数或截图不能单独证明实际预算生效；必须读回调用记录。
- 优先使用随仓库发布的独立 JS/CSS 文件，避免多层模板字符串吞掉正则反斜杠。

## 1. 环境与备份

检查系统、Antigravity版本、Node版本和真实可执行路径。Node需原生WebSocket；指标需 `node:sqlite`。

检查 `~/.antigravity-patch/`、用户LaunchAgents和字体，保护已有修改。读取 `~/Library/Application Support/Antigravity/DevToolsActivePort` 第一行并通过 `/json/list` 核对目标：端口文件可能过期，文件存在不代表客户端在线。

客户端未启动时可正常启动；退出前确认没有执行中的任务。若未开放本机调试端口，先核实该版本支持的启动方式与影响范围，不改原包、不向外网开放端口。

记录安装前原生外观模式（System/Light/Dark）及字体清单。localStorage备份不能替代原生设置备份；客户端端口变化也可能改变网页存储来源。

## 2. 选择功能与字体

配色：`high-contrast`（默认）、`claude-desktop-purewhite`、`vintage-deep`。后者是牛皮纸配色，不等于官方Dark模式。

无需指标时加 `--no-metrics`；明确要求1M时才加 `--gemini-1m`，并先读第4节。不要把未询问的可选功能一并开启。

按 [references/fonts.md](references/fonts.md) 安装用户可使用的字体。安装器不下载字体。核对字体真实内部名称，缺失时明确标记系统回退，不能仅凭CSS字体列表宣称生效。

## 3. 安装或升级

```sh
node --test tests/*.test.mjs
node scripts/install.mjs --help
node scripts/install.mjs --preset high-contrast
```

用户明确要求Gemini 4默认1M时：

```sh
node scripts/install.mjs --preset high-contrast --gemini-1m
```

已有本安装器管理的安装使用 `--upgrade`，先检查完整备份位置，并完整传入本次选择的功能。没有install-manifest.json的旧安装不能直接升级：先核对并停止旧服务，将旧目录和plist完整移到备份，再安装，避免两个守护进程同时注入。`--no-service`仅部署文件，不代表已常驻；可根据控制器帮助手动运行。

安装目录下的 `config.json` 保存 `preset`、`metrics`、`gemini1m`。运行资产在 `assets/`。安装器用真实Node路径生成用户LaunchAgent `com.chuanban.antigravity-theme-patch`，不修改App原包、不自动重启Antigravity、不修改原生主题模式。根据用户选择在原生外观页面切换Light。Node22.5–22.12手动运行控制器需加 `--experimental-sqlite`，服务会自动加该参数，建议Node24。

Windows/Linux仅先准备可审查文件，单独适配服务管理；不能直接执行macOS服务步骤或宣称常驻成功。

## 4. 上下文读取与可选1M

详见 [references/context-budget.md](references/context-budget.md)。必须区分模型理论窗口、最近一次调用预算、自动压缩阈值。

### 真实指标：不改变请求

从 `gen_metadata` 最近一次记录读取：

| 数据 | Protobuf字段路径 |
| --- | --- |
| 聊天元数据 | `CortexStepGeneratorMetadata.chat_model`，字段1 |
| 实际输入用量 | `chat_model.usage`字段4：新增输入字段2 + 缓存读取字段5 |
| 同次调用预算 | `chat_model.chat_start_metadata`字段9 → `context_window_metadata`字段10 → `max_context_tokens`字段4 |
| 客户端估算用量 | 同一context_window_metadata的字段1；与实际usage分别标识 |

只用同次调用预算作分母；缺失/无效时只显示已知用量，不填256k或1M、不算百分比、不猜“距压缩剩余量”。缺少usage也不能伪造“实测0”。字段来自已检查版本，schema不符时降级并报告。

文案使用“最近调用上下文预算”。切换模型但尚未新调用时，不把旧调用的预算说成新模型配置。

### 默认1M：改变真实请求，默认关闭

启用前确认当前账号模型目录的Gemini 4窗口至少1,048,576，模型标识与脚本匹配。实测映射Low=1419、Medium=1418、High=1417，对应 `MODEL_PLACEHOLDER_M419/M418/M417`。编号会变化，不能对新版本或所有模型盲用。

脚本只修改同源 `SendUserCascadeMessage` 的匹配请求：

```json
{"cascadeConfig":{"checkpointConfig":{"maxTokenLimit":1048576}}}
```

覆盖普通JSON、Connect JSON、**gRPC-Web JSON（普通界面实测协议）**和WebSocket JSON；保留权限、工具、提示词及其他模型请求。未知帧/压缩格式不猜测改写。未来官方UI明确选择非Default窗口时尊重用户选择。

已实测总窗口1,048,576减输出预留65,536，最终预算983,040。不要强行显示为1M，也不要把预留量说成每次实际输出。1M增强不扩大模型能力、不解除配额，不是官方公开配置。

## 5. 验收

按 [references/verification.md](references/verification.md) 执行：

1. 配色计算值、真实FontFace加载、深浅主题隔离。
2. 导航可翻译，代码/终端/正文/输入区/路径不被修改；运行主包差量扫描，不能承诺新版“零遗漏”。
3. 设置可正常打开，TanStack路由state保留；不重复写相同DOM文本；缺少原生缩放接口时不吞快捷键。
4. 指标来自同次调用；未知预算降级；宽窄布局、会话切换正确。
5. 若启用1M，**从普通聊天界面发短消息**，核对新生成记录的max_context_tokens与最终执行配置；然后完全退出重开，从首页新建会话再测。直接构造API请求不能替代这两步。
6. 验证其他模型不改、1M关闭时不装包装函数，以及服务重启/客户端重启后的状态。

短消息只能证明实际预算配置，不能证明近百万token大输入的质量和所有服务端边界。已测试与未测试项分开写；发布前移除个人路径、会话ID、截图和凭证。

## 6. 恢复与交付

按 [references/recovery.md](references/recovery.md) 区分单独关闭1M、停止常驻、恢复原生外观、恢复上次安装和完整卸载。退出客户端才能清除原进程中残留的运行时包装，不把删文件等同于即时恢复。

交付安装目录、服务标识、功能开关、配色、数据来源、验证结果、未验证项、备份和恢复方法。明确1M适配依赖本地后台服务，客户端升级后需复验。
