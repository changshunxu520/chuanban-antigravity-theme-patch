# Windows与轻量路线

## 只改官方颜色

若用户只需暖色，可在官方Appearance页面调背景、前景和强调色，不安装Node或守护进程。侧栏仍受官方混色公式限制，不能承诺与独立侧栏CSS完全一致。

## 仅字体/颜色的一次性注入

```sh
node scripts/install.mjs --style-only --preset high-contrast --font-scheme B
node ~/.antigravity-patch/controller.mjs apply
```

style-only强制关闭指标、汉化、设置/缩放增强及1M请求包装，不创建常驻项。仅用固定id样式标签和预设DOM属性，重复应用不会叠加标签，不拦截localStorage、不挂巡检。退出重开后效果消失，需要时再次apply。要完整撤销当前页运行时样式，退出重开是最可靠路径。

这与 `--no-service` 不同：后者只是暂不注册后台服务，仍可以手动应用完整功能。`--style-only --gemini-1m` 属于互斥意图，安装器拒绝。

本fork的可执行控制器仍统一要求Node>=22.5，建议24；不保留旧版Node+第三方ws包路线。纯官方颜色设置无需这个依赖。

## Windows原则（尚未提供自动安装器）

- 页面CSS、字体、汉化、预算算法可复用，但需要核对具体客户端DOM和桥接。
- 端口文件通常在 `%APPDATA%\Antigravity\DevToolsActivePort`；以本机实际用户数据目录为准。不可照搬macOS固定路径。
- 会话数据库通常在 `%USERPROFILE%\.gemini\antigravity\conversations\<UUID>.db`，只读并考虑WAL。
- 可通过任务计划程序登录触发或启动文件夹维持Node进程；必须单独实现对应停止、备份与卸载。
- 更纱字体从官方发行页或可信包管理器安装；平台等宽回退将Menlo/Monaco替换为Consolas。
- 本仓库install.mjs自动服务模式只支持macOS，不能以 `--no-service` 成功复制文件就宣称Windows已支持常驻。Linux同样需要适配端口路径和服务管理。
