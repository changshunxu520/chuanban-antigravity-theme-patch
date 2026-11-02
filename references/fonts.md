# 字体准备

仓库不包含字体，也不自动从网盘安装字体。用户可以使用已有字体；缺失时允许系统回退但必须说明。

- 更纱黑体可从 [官方发行页](https://github.com/be5invis/Sarasa-Gothic/releases) 或Homebrew `font-sarasa-gothic` 获取。下载后核对包管理器/发行记录的校验值。
- 原作者列出的 [公开字体资源](https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC) 为第三方分享源，不把它称为字体供应商的官方发布或许可证明。
- 安装用户有权使用的字体到用户字体目录；记录新增文件，保护已有同名字体。

已检查资源中的Anthropic Regular字体实际上包含可变字重，内部名称可能与文件名不同。该版CSS包含已验证的PostScript映射：AnthropicSerifWebWeb-TextLight、AnthropicSansWebVariable-TextRegular、AnthropicMonoWebWeb-Regular。不同字体来源应重新检查，不能强套名称。

Sarasa预期族名包括Sarasa UI SC、Sarasa Mono Slab SC。字体集合可能很大，安装前查看大小，不将整个集合塞进网页base64样式。

字体安装后需要正常重启客户端刷新缓存。用FontFace的local来源实际load，或平台字体信息确认加载，CSS computed font-family中出现名字不能单独证明字体存在。
