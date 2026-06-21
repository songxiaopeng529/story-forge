# AgentLoop 架构图

```mermaid
flowchart TD
    START([run 开始]) --> INIT[初始化 messages 副本<br/>记录 startedAt<br/>创建 AbortController]
    INIT --> EMIT_START[emit: runtime.started]
    EMIT_START --> LOOP{"主循环 while(true)"}

    LOOP --> PREFLIGHT["🛑 前置检查 getStopReason()<br/>• user-stopped (外部信号)<br/>• time-limit (超时)<br/>• step-limit (步数上限)"]
    PREFLIGHT -->|触发停止| FINISH_STOP[finish 对应 stopReason]
    PREFLIGHT -->|通过| STEP_INC["steps += 1"]

    STEP_INC --> BUILD_REQ["构建 ModelRequest<br/>• trimMessagesToContext (80% 窗口)<br/>• tools.schemas()"]
    BUILD_REQ --> EMIT_MODEL["emit: model.request<br/>(仅 inspect 开启时)"]

    EMIT_MODEL --> CHOOSE_MODE{"responseMode?"}

    CHOOSE_MODE -->|"smooth / 无streamChat"| SMOOTH["requestSmoothResponse<br/>→ provider.chat()<br/>→ emit: message.delta (smooth)"]
    CHOOSE_MODE -->|"live"| STREAM["requestStreamingResponse<br/>→ provider.streamChat()<br/>→ emit: message.delta (live)"]
    CHOOSE_MODE -->|"auto"| AUTO["尝试 streamChat<br/>✅ 成功 → live 流式<br/>❌ 失败且无内容 → 降级 smooth<br/>❌ 失败且有内容 → 报错"]

    SMOOTH --> APPEND_MSG
    STREAM --> APPEND_MSG
    AUTO --> APPEND_MSG

    APPEND_MSG["追加 AssistantChatMessage<br/>(content + reasoningContent + toolCalls)"]

    APPEND_MSG --> HAS_TOOLS{"有 toolCalls?"}

    HAS_TOOLS -->|"❌ 无"| CP_FINAL["checkpoint → finish('completed')"]
    CP_FINAL --> FINISH_COMPLETE([返回 AgentLoopResult])

    HAS_TOOLS -->|"✅ 有"| FOR_EACH["遍历每个 toolCall"]

    FOR_EACH --> CHECK_REPEAT{"同签名重复 ≥3 次?"}
    CHECK_REPEAT -->|是| SKIP_REPEAT["跳过剩余 tools<br/>finish('repeated-tool-call')"]
    CHECK_REPEAT -->|否| TOOL_PREFLIGHT["🛑 再次检查停止条件"]

    TOOL_PREFLIGHT -->|触发| SKIP_STOP["跳过剩余 tools<br/>finish 对应原因"]
    TOOL_PREFLIGHT -->|通过| EMIT_TOOL["emit: tool.call<br/>(callId, name, input)"]

    EMIT_TOOL --> EXEC["tools.execute(name, input)"]
    EXEC --> APPEND_RESULT["追加 tool result message<br/>(ok → output / fail → error)"]
    APPEND_RESULT --> EMIT_RESULT["emit: tool.result<br/>(ok, output/error)"]

    EMIT_RESULT --> CHECK_FAIL{"连续失败 ≥5 次?"}
    CHECK_FAIL -->|是| SKIP_FAIL["跳过剩余 tools<br/>finish('consecutive-tool-failures')"]
    CHECK_FAIL -->|否| NEXT_TOOL{"还有 toolCall?"}

    NEXT_TOOL -->|是| FOR_EACH
    NEXT_TOOL -->|否| CP_LOOP["checkpoint → 回到主循环"]

    CP_LOOP --> LOOP

    FINISH_STOP --> DONE([返回 AgentLoopResult])
    SKIP_REPEAT --> DONE
    SKIP_STOP --> DONE
    SKIP_FAIL --> DONE

    %% 异常处理
    LOOP -.->|exception| CATCH{"异常类型?"}
    CATCH -->|"signal.aborted"| USER_STOP["finish('user-stopped')"]
    CATCH -->|"timeLimitReached"| TIME_STOP["finish('time-limit')"]
    CATCH -->|其他| ERR_STOP["emit: runtime.error<br/>finish('unrecoverable-error')"]
    USER_STOP --> DONE
    TIME_STOP --> DONE
    ERR_STOP --> DONE

    style START fill:#4CAF50,color:#fff
    style DONE fill:#4CAF50,color:#fff
    style FINISH_COMPLETE fill:#4CAF50,color:#fff
    style LOOP fill:#2196F3,color:#fff
    style HAS_TOOLS fill:#FF9800,color:#fff
    style CHOOSE_MODE fill:#9C27B0,color:#fff
    style CATCH fill:#f44336,color:#fff
```

## 核心数据结构

| 概念 | 类型 | 说明 |
|------|------|------|
| `AgentLoopOptions` | `{ provider, tools, maxSteps?, maxDurationMs?, now? }` | 构造参数 |
| `AgentLoopRunInput` | `{ sessionId, turnId, responseMode?, messages, signal?, onEvent?, onCheckpoint? }` | 每次 run 的输入 |
| `AgentLoopResult` | `{ messages, stopReason, steps }` | 运行结果 |
| `AgentStopReason` | `'completed' \| 'user-stopped' \| 'time-limit' \| 'step-limit' \| 'repeated-tool-call' \| 'consecutive-tool-failures' \| 'unrecoverable-error'` | 停止原因 |
| `ResponseMode` | `'auto' \| 'live' \| 'smooth'` | 响应模式 |

## 关键设计决策

1. **上下文窗口管理** — `trimMessagesToContext` 从后往前保留完整对话轮次，最多使用 80% 上下文窗口
2. **流式降级** — `auto` 模式下，流式失败且未发送任何内容时自动降级到 `smooth`
3. **无限循环保护** — 默认最大 1000 步 / 2 小时，重复工具调用 3 次停止，连续失败 5 次停止
4. **事件驱动** — 通过 `onEvent` 回调实时推送 `runtime.started`、`model.request`、`tool.call`、`tool.result`、`message.delta`、`runtime.completed` 等事件
5. **检查点** — 每轮工具执行完毕后通过 `onCheckpoint` 保存消息快照
