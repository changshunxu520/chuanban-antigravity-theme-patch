# 配色、字体与预设切换

## 为什么需要独立样式

原生外观设置不能精确控制侧栏混色、输入框卡片与中缝轮廓、底栏透明度以及分层字体。原方案通过CDP覆盖这些区域，官方预设键仍保持合法名称，避免把自定义名称交给React预设字典导致白屏。

## 三套原配色

| 属性 | 高对比版 | ClaudeDesktop净白 | 复古牛皮纸 |
| --- | --- | --- | --- |
| 名称 | high-contrast | claude-desktop-purewhite | vintage-deep |
| 主背景 | #FCFCFB | #FCFCFB | #FBF9F5 |
| 正文前景 | #1F1E1D | #141413 | #2C2B29 |
| 侧栏 | #F7F5F0 | #FBFBF9 | #F1E8DC |
| 侧栏选中 | #ECE9E1 | #EDECE9 | #E6DCCE |
| 侧栏悬停 | #F2EFE9 | #F3F2EF | #EAE0D2 |
| 侧栏边线 | rgba(0,0,0,.35) | #F0F0EE | #E0D4C3 |
| 强调色 | #D97757 | #D97757 | #D97757 |

高对比输入框底色#F9F7F2、边框rgba(0,0,0,.35)；底部文字/图标#0A0A0A且opacity=1；主按钮轮廓rgba(0,0,0,.32)，竖向分隔rgba(0,0,0,.28)。完整值在theme.css中保留。

Solid Ink保持：侧栏常规450、选中520、小标题500，常规墨色#262422、小标题#7A7670，字距-0.012em，0.2px微阴影；项目目录标题单独450、0.15px阴影；正文行高1.62、字距-0.003em。浅色墨色规则限定Light模式，避免影响官方Dark。

## A/B/C字体分层

- **A（默认）**：UI为Anthropic Sans/Styrene B与系统、更纱UI回退；正文Anthropic Serif/Tiempos Text/Georgia/Cambria与Sarasa Mono Slab SC；代码Anthropic Mono与Sarasa Mono Slab SC；输入独立Sarasa Mono Slab SC。
- **B（全更纱）**：UI Sarasa UI SC；正文Sarasa UI Slab SC；代码和输入Sarasa Mono Slab SC。适合没有Anthropic字体或希望统一更纱的用户。
- **C（Claude原生中文回退）**：UI Anthropic Sans/Styrene B/系统/PingFang SC；正文Anthropic Serif/Tiempos Text/Georgia/PingFang SC/Microsoft YaHei；代码Anthropic Mono与系统等宽；输入使用UI字体。

使用 `--font-scheme A|B|C` 选择，默认A。字体方案不能代替字体安装或实际加载验证。

## 临时切换与持久切换

完整模式保留原方案 `localStorage.setItem('theme-color-flavor', ...)` 热切换与历史别名兼容。当前进程内可用于预览，重启时以config.json为准。持久切换应备份config.json、修改preset/fontScheme，重启补丁服务及客户端；受管升级也可显式传入全部功能开关。

`--preset default-light` 提供明确的原生样式恢复模式，不注入自定义主题/字体CSS，按用户选择仍可保留汉化和指标。完全退出并重开客户端后验收。

**与原文的差异**：不承诺在任意客户端版本“点击官方Default Light即自动100%恢复”。当前客户端的原生设置与网页localStorage不完全相同，原示例也没有可靠覆盖这个行为。改用明确的default-light开关/卸载和原生外观恢复步骤，保留恢复能力而不虚构自动联动。官方原始浅色数值曾为#F9F9F9/#101010/#007ACC，版本或用户原有自定义值可能不同，应恢复安装前记录而非强写这三个常量。
