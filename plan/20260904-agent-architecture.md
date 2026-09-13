# 2026-09-04 当前 Agent 架构（实装对照）

> 对照原稿：[20260830-plan01.md](20260830-plan01.md) §2、[20260830-plan02-agent-runtime.md](20260830-plan02-agent-runtime.md)。  
> 本文写的是**现在仓库里实际跑着的东西**，不是愿望清单。符文匠不能操控电脑的根因见 §6。

---

## 1. 边界

小镇 OS 不持模型。它只知道：这个 `agentId` 用哪个 provider、哪份 Definition、会话与信封存在哪。

```
src/components/AgentChat.tsx
        │  tRPC sendMessage / retryMessage
        ▼
api/agents.ts          鉴权、落 user 行、调 runtime、写 agent/system 行
        │
        ▼
api/runtime/           纯运行时，不 import 地图 / landmark
  app.ts               单例 getTownRuntime()：hooks + toolsFor
  index.ts             createRuntime().run()：抢锁 → prompt → loop → 释放
  loop.ts              最多 8 步：drain(provider) → beforeTool → execute
  registry.ts          DB 行 + KIND_PRESETS → AgentDefinition
  prompt.ts            身份 / 人设 / 记忆 / A2A / 槽位说明
  providers/           builtin（OpenAI 兼容）· cursor（SDK local）
  tools/               town / memory / a2a / hands
  workspace.ts         每访客每居民 jail + 种子目录
  trajectory.ts        tool/call · tool/result 落库
  hooks/               guards（含 hands）+ memory digest + 占卜归档
  memory/              L1/L2/L3 store · digest · distill
  a2a/                 信封 + worker（depth=1）
```

`api/runtime/**` 只允许碰 `@db/schema`、`api/queries/connection`、`zod`。tRPC 边界在 `api/agents.ts`，不含推理。

---

## 2. 一轮请求

1. 前端 `ChatThread` 调 `agent.sendMessage`（失败条走 `retryMessage`，不重复插入 user 行）。
2. `deliverAgentReply` → `getTownRuntime().run({ agentId, userId, conversationId, userMessage, model, signal })`。
3. `acquireRun` 用 `lockKey = agentId:userId` 单飞；墙钟 60s abort；过期锁按 `wallClockMs` 收割。
4. `beforeTurn`：记忆 digest + session 摘要。
5. `loadTranscript` + `buildSystemPrompt`。
6. `runLoop`：把 town tools 的 JSON Schema 交给 **builtin**；每步先写 `tool/call` 再执行，再写 `tool/result`；**cursor 路径不走这套 tool_call**。
7. `afterTurn`：记忆 hit 回写；占卜 hook 归档。
8. 有溢出则异步 `compressSession`。成功写 agent 行 + notes（含 `tool_trace`）；失败写 `meta.failed` 系统条。
9. 若产生信封，`drainEnvelopes` 异步再跑被问方（`depth=1`，禁止再 Ask）。

墙钟 abort 与 `raceAbort` 见 `api/runtime/abort.ts`：provider  Ignored signal 时，loop 仍能输给 abort，避免按钮永久「加载中」。

---

## 3. Definition 与名册

`KIND_PRESETS`（`registry.ts`）是行为契约：tags、业务工具、L1 槽、self-L1 铁律、默认 provider。  
`TOWN_AGENTS`（`agents.ts`）只决定谁在、叫什么、站哪栋楼。`ensureTownAgents()` 按 slug 幂等补行。

| slug / kind | 居民 | 地标 | 业务工具 | L1 槽 | 默认 provider |
|---|---|---|---|---|---|
| work | 书记官 | town-hall | add_task, list_tasks | profile:work_rhythm | builtin |
| diet | 营养巫师 | coffee | log_meal, lookup_dish | allergy, diet_goal | builtin |
| fitness | 晨练教练 | hotel | log_workout, suggest_plan | injury, fitness_goal | builtin |
| **code** | **符文匠** | **design-lab** | **save_snippet** + **hands** | **无** | **cursor**（无钥匙则 builtin） |
| social | 夜枭酒保 | livehouse | list_events, post_bulletin | nickname, tone | builtin |
| mixology | 调酒师 | livehouse | recommend_drink, lookup_recipe, log_taste | profile:alcohol | builtin |
| study | 禁书塔馆长 | library | search_library, make_reading_plan, log_progress + **hands** | profile:study_goal | builtin |
| divination | 驻塔巫师 | magic-house | draw_tarot, lookup_card, log_reading, list_readings | 无 | builtin |
| custom | 访客自建 | 可选 | 无业务工具 | nickname, tone | builtin（强制） |

每个常驻再加框架工具（`app.ts` `ALWAYS_ON_TOOLS`）：

- 记忆：`propose_memory` / `remember_insight` / `forget_insight`
- A2A：`ask_agent` / `tell_agent` / `handoff` / `list_town`

镇原生 `code` / `study` 再注入计算机手（`app.ts` `toolsFor`，不写进 `KIND_PRESETS`）：

- `file_read` / `file_write` / `file_patch` / `code_run`
- 工作区：`.data/workspaces/u{userId}/{slug}/`（lazy mkdir + 种子 README）
- `handsGuard` 是第二闸：访客自建或其它 kind 即便脏 `toolIds` 也进不去

`propose_memory` 对无槽 kind（code、divination）会被 policy 拒绝，工具仍挂着，模型能听到原因。

**门禁（`registry.resolveProvider`）**

- 访客自建（`ownerUserId != null`）永远 builtin。
- 镇原生声明 `cursor` 但 `providerOptions.cursorApiKey` 不是字符串 → **退回 builtin**。seed 写的是 `providerOptions: "{}"`。

---

## 4. 两套 Provider

### 4.1 builtin（当前全镇实际在用）

`providers/builtin.ts`：OpenAI 兼容 `POST /chat/completions` + SSE。工具走本进程 function calling，由 `loop.ts` 执行。  
模型目录在 `providers/catalog.ts`，key 来自 `.env` 的厂商变量，**不是** Cursor key。

饮食 / 健身 / 政务 / 占卜仍走记事本工具。符文匠与馆长在 **builtin** 上另有一套 jailed 手：读改工作区文件、在工作区跑 python / powershell。这不是访客本机，也不是通用 `exec`。

### 4.2 cursor（四期文件在，钥匙没插上）

`providers/cursor.ts` 只对 `kind === "code" && isTownNative` 生效。

设计意图（plan01 §2.3）：

- `@cursor/sdk` `Agent.create` + `send`
- `local: { cwd }` —— Cursor local **自带 shell / 读文件**，这才是「会干活的手」
- key 属于**该 agent / 该用户**，禁止一把团队 key 给路人跑 local（local 默认自动批准 shell）
- MCP / customTools 把小镇工具（`save_snippet`、A2A）再暴露进 Cursor
- resume 要重传 MCP

实装现状：

| 设计 | 代码 |
|---|---|
| 只挂符文工坊 | `resolveCursorProvider` 检查 kind + town-native |
| per-agent key | `providerOptions.cursorApiKey`，镇原生可回退 `.env` 的 `CURSOR_API_KEY` |
| local cwd | `cursorCwd` 或访客工作区 `.data/workspaces/u{id}/{slug}/` |
| Cursor 自带工具干活 | `streamRun` 只 yield **assistant 文本**，不把 SDK 工具事件回灌 loop |
| MCP | `providerOptions.mcpServers` + 工作区 `.cursor/mcp.json`（`settingSources: project`） |
| Skills / hooks | 种子 `.cursor/skills`、`.cursor/hooks.json`；可在工作区继续加文件 |
| 小镇工具 | `local.customTools`：save_snippet / 记忆 / A2A（handoff 除外） |
| 持久化 | `JsonlLocalAgentStore` + `Agent.resume`（`.data/cursor-agents/u{id}/{slug}/`） |
| 访客选了模型下拉 | **不再打断** 已配置的 cursor；无钥匙才退回 builtin |

没有钥匙（行上没有 `cursorApiKey`、环境里也没有 `CURSOR_API_KEY`）时，`definition.provider` 仍被改写成 `builtin`。有钥匙时，会话钉的 catalog 模型不再把整轮打回 builtin。

---

## 5. Prompt 与记忆

`buildSystemPrompt` 顺序（前缀缓存友好）：

1. 身份 + 不变约束（没调用工具不许声称办成了）+ `selfCanon`
2. persona
3. self 记忆块
4. 命中的 skills（目前 `definition.skills` 恒为 `[]`）
5. user 记忆块
6. A2A 规矩（正文 @ 无效）
7. 手的规矩（仅镇原生 code / study：工作区相对路径、无结果不声称）
8. 占卜归档规则（仅 divination）
9. L1 槽说明，或「你没有提议铁律的权限」

记忆主体 × 层级仍按 plan02：用户记忆跨 agent 共享，靠 `topics × capabilityTags` 收敛。code / divination 不能提议 L1。

---

## 6. 符文匠现在有什么手，还缺什么

访客问「硬盘还有多少」——**仍然摸不到访客自己的电脑**。能摸的是小镇给这对「访客 × 居民」划出的工作区。

```
现在（builtin + hands）
  镇原生 符文匠 / 馆长
    → file_read / file_write / file_patch / code_run
    → .data/workspaces/u{userId}/{slug}/
    → jail：拒绝 ..、盘符、symlink 逃逸
    → 配额：8MB / 200 文件 / 单文件 256KB；code_run 15s / 10k 输出
    → 每步 tool_events 先 call 后 result；聊天气泡有 tool_trace

仍不是（四期 Cursor local）
  seed providerOptions = {}
  → 没有 per-agent Cursor key
  → cursor 适配器不把 SDK 工具事件回灌 loop
  → 不能探测 / 改访客本机任意路径
```

`save_snippet` 仍只收抽屉。工作区文件不是铁律、不是 L1。

安全边界：

1. **只有镇原生 `code` / `study`**。`toolsFor` 不注入，`handsGuard` 再挡一层，工具内部 `mayUseHands` 第三闸。
2. **访客 `custom` 没有工作区、没有手。** 也不给 cursor。
3. **`code_run` 环境抽掉 API key**，cwd 钉死工作区。
4. **不要**再加通用 `exec` 或给其它 kind 开手。

Cursor 四期：MCP / skill / hook / resume 已接在访客工坊上。hands 仍是 builtin 上的替代手。local 默认自动跑工具，靠工作区 hook + `autoReview` 收一收，不是把 shell 发给 `custom`。

---

## 7. 若还要对齐 Cursor 原设计

builtin 工坊已经有 jailed 手。Cursor 仍是另一条路：

1. **给符文匠插一把本机 key**（仅镇原生、仅本机 dev）：`providerOptions.cursorApiKey`，或 `.env` 的 `CURSOR_API_KEY`。不要进游客登记表。
2. **`index.resolveProvider` 已修好**：有钥匙的 cursor 不再被会话模型钉死。
3. **MCP / skill / hook / 记忆**：工作区 `.cursor/` + `customTools` 已接；inline MCP 写在 `providerOptions.mcpServers`。
4. **不要**把 hands 扩成通用 `exec`，也不要给 `custom` / 其它 kind。

未决：Cursor cwd 用工作区根还是另开目录；改工作区要不要先让访客点头；本机 key 怎么存。

---

## 8. 分期对照

| 期 | 计划 | 2026-09-04 |
|---|---|---|
| 一 | schema + builtin + sendMessage 真跑 | 已落地 |
| 二 | 工具 + hook + L1/L2 + 抽屉 | 已落地 |
| 三 | L3 distill + A2A + 交接纸条 | 已落地（虚空持球 hook 仍薄） |
| 四 | cursor 只挂符文匠 | **文件在，钥匙与 MCP 未接；builtin 上已有 jailed hands** |
| 五 | SSE 页面内聊聊 | 仍是同步阻塞整轮返回 |

相关近期补丁（不改分层）：占卜归档、Markdown 气泡、失败条可重试、墙钟 abort 防挂死、每访客工作区 hands、`tool_events` 轨迹、Cinzel + Noto Serif SC。
