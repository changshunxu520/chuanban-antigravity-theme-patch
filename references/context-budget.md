# 真实上下文与1M增强

## 三个层次

模型窗口是服务端模型能力；调用预算是客户端为某次生成配置的输入预算；压缩阈值决定何时整理历史。这些数值不能互换。

在已验证的Antigravity 2.28.2中，模型目录的Gemini 4 Low/Medium/High均报告 `maxTokens=1048576`、`maxOutputTokens=65536`，同时默认checkpointer配置的 `max_token_limit=256000`。因此“模型支持1M”和“某次调用实际按256k管理”可以同时成立。

## 本机数据读取

只读打开 `~/.gemini/antigravity/conversations/<UUID>.db`，观察 `.db` 与 `-wal` 修改时间及大小做缓存失效；不要改写数据库或把内容上传。

`gen_metadata.data` 为CortexStepGeneratorMetadata。字段号：

```text
1 chat_model
  3 model
  4 usage
    2 input_tokens
    3 output_tokens
    5 cache_read_tokens
    9 thinking_tokens
   10 response_tokens
  9 chat_start_metadata
   10 context_window_metadata
      1 estimated_tokens_used
      4 max_context_tokens
 11 time_to_first_token
 12 streaming_duration
```

指标分子是同次usage的新增输入加缓存读取，分母是同次max_context_tokens。estimated_tokens_used属于客户端估算，可能与服务实际计数不同。缺失或schema不匹配时不猜；模型编号和生成序号一并保留用于解释历史归属。

`executor_metadata.data` 中字段10为最终CascadeConfig，字段17为请求覆盖配置。CascadeConfig字段2为CheckpointConfig，字段1为PlannerConfig。已验证的CheckpointConfig字段5是max_token_limit，PlannerConfig字段6为max_output_tokens。只读比对请求值、最终执行值和调用元数据，不能只看请求回显。

可通过下述辅助脚本读取指定会话的最近调用（UUID应来自用户当前会话，而非扫描所有私人会话）：

```sh
node scripts/read-context.mjs <conversation-uuid>
```

## 可用接口与限制

当前本机LanguageServerService提供GetUserStatus与GetAvailableModels。前者可检查 `cascadeModelConfigData.clientModelConfigs[].contextWindowOptions`，后者提供模型窗口及下发的压缩配置。使用客户端当前同源认证，不复制认证值到仓库、终端输出或日志。

选项列表为空只说明当前未提供可选窗口，不代表不存在数据接口。公开CLI文档也提供 [context面板](https://antigravity.google/docs/cli/commands/context/) 和 [statusline上下文字段](https://antigravity.google/docs/cli/statusline/)，但不能将CLI能力直接推断成桌面版设置入口。

内部请求支持 `cascadeConfig.checkpointConfig.maxTokenLimit=1048576`。创建会话的CustomAgentSpec也可携带配置，但只对单个API测试会话生效不满足“普通界面默认”的要求。本fork在正常消息发送处应用默认值，以覆盖新会话和已有会话后续消息。

当前已测试的默认请求经过gRPC-Web JSON：一字节flags、四字节大端长度、JSON payload。改写后必须重算长度；压缩帧不能用明文JSON解析。WebSocket消息用 `type:start`、`procedure`、`payload` 封装。

启用增强前确认模型编号未漂移。只匹配Gemini 4三档；明确非Default窗口优先。请求中其他设置完全保留。该增强不改账号配额、安全授权、模型输出上限，也不解锁服务端拒绝的模型。

## 实测结果与解释

2026-11-02，Antigravity 2.28.2、Node24、macOS：Gemini 4 Medium普通界面请求加入1,048,576后，后台最终max_token_limit与调用max_context_tokens均为983,040；退出客户端重开后，通过首页新建普通会话仍为983,040。

这是总窗口减65,536输出预留的结果，并不是“还剩983k”。预留不等于实际生成量。短消息已验证实际预算，但未进行近百万token请求压力测试；其他账号、版本或后续路由可能不同。
