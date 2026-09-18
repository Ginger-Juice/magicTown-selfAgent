<p align="center">
  <a href="./README.md"><img src="./assets/readme/badge-en-off.svg" height="36" alt="English"></a>
  &nbsp;
  <a href="./README.zh-CN.md"><img src="./assets/readme/badge-zh-on.svg" height="36" alt="中文"></a>
</p>

<h1 align="center">魔法镇</h1>

<p align="center">
  <strong>magictown-selfagent</strong><br>
  一份个人 self-agent 产品：等距小镇是壳，镇上的居民可以真正说话。
</p>

<p align="center">
  <a href="https://github.com/Ginger-Juice/magictown-selfagent"><strong>GitHub →</strong></a>
</p>


<p align="center">
  <img src="./assets/readme/hero.png" width="100%" alt="魔法镇 — 个人 self-agent 的等距小镇壳">
</p>

<p align="center">
  <img src="./assets/readme/showcase.png" width="100%" alt="魔法镇一览：地图壳与镇民对话">
</p>

---

**魔法镇（Magic Town）** 是跑在本地的小镇 OS。地图是大门；`/login` 和 `/agents` 后面是 Hono + tRPC + Drizzle 运行时：八位种好的镇民（带工具和记忆）、一位访客自建代理人，以及完整的模型循环——不是地图站的占位文案。

包名：`magictown-selfagent`。对外品牌：魔法镇 / Magic Town。

### 这是什么

- **小镇壳** — Vite / React 等距地图。`/` 当前挂的是 `DebugMap`（画好的地图 +「编辑布局」），不是访客用的 `TownMap`。导航里仍有登录和代理人。地标文案和大部分地图美术仍是海边小镇遗留，不是本产品的身份。
- **镇民** — `/agents` 上八位种好的代理人。对话是完整的 builtin（OpenAI 兼容）循环。默认厂商是 DeepSeek（见 `.env.example`）。
- **你的代理人** — 有小镇通行证后可以登记一位自定义代理人。
- **小镇 OS** — Hono API（`api/boot.ts`）、tRPC、Drizzle/MySQL、记忆、A2A 信封、jailed 工作区；符文匠在有钥匙时走 Cursor SDK。

地图可以匿名逛。对话和登记代理人必须先 `/login`。

### 技术栈

**壳：** React 19 · TypeScript · Vite · Tailwind CSS · Framer Motion · GSAP · Lenis · Howler · shadcn/ui

**小镇 OS：** Hono · tRPC · Drizzle · MySQL · `@cursor/sdk`

模型 key 写在 `.env.example`。若要重出地图 / README 图，走 Google Gemini（`scripts/art/generate.mjs`），见 `.cursor/rules/art-pipeline.mdc`。

<p align="center">
  <img src="./assets/readme/section-run.png" width="100%" alt="本地运行魔法镇">
</p>

### 运行

地图壳是 Vite SPA。**和代理人聊天需要 Node API 和 MySQL。** `npm run dev` 会一并把两者拉起来（Vite + Hono，端口 3000）。

```bash
git clone https://github.com/Ginger-Juice/magictown-selfagent
cd magictown-selfagent
cp .env.example .env   # 填 DATABASE_URL，以及至少一把厂商 key（默认 DeepSeek）
npm install
npm run dev            # http://localhost:3000
```

```bash
npm run build          # 前端 → dist/public，API 打包 → dist/boot.js
npm start              # 生产 Node 服务（静态文件 + /api）
npm run check          # tsc -b
npm run lint           # eslint
npm test               # vitest
```

GitHub Pages 仍只从 `main` 发布**静态前端**（`dist/public`）。那不是小镇运行时。遗留 Pages 域名仍是 `summertown.summercommences.com`（`CNAME` / `public/CNAME`）；本轮不动 DNS 与部署。

### 路线

| 路线 | 内容 |
| --- | --- |
| `/` | 画好地图的布局工坊（`DebugMap`）。这里有地标对话；访客 `TownMap` 没有挂上。 |
| `/login` | 小镇通行证 — 说话或登记代理人必须先登录 |
| `/agents` | 镇内居民 + 你登记的代理人、对话、记忆抽屉 |
| `/town-admin` | 小镇管理 |
| `/journal` | 护照索引、日历、明信片墙、造访足迹 |
| `/visit` | 渡轮 / 住宿 / 礼仪（继承来的地图壳文案） |
| `/windbell-isle` | 滚动旅程（继承来的小岛壳） |
| `/apple-album` · `/apple-admin` | 每日一苹果相册及其后台 |

深链接：`/agents?agent=<id>`，`/agents?memory=<id>`。

<p align="center">
  <img src="./assets/readme/section-agents.png" width="100%" alt="镇民">
</p>

### 镇民

由 `api/agents.ts` 里的 `ensureTownAgents()` 种下。行为（工具、记忆槽、provider）在 `KIND_PRESETS`（`api/runtime/registry.ts`）。

| 类型 | 居民 | 地标槽 | 工具（另加共享记忆 / A2A） |
| --- | --- | --- | --- |
| work | 书记官 | town-hall | `add_task`、`list_tasks` |
| diet | 营养巫师 | coffee | `log_meal`、`lookup_dish` |
| fitness | 晨练教练 | hotel | `log_workout`、`suggest_plan` |
| code | 符文匠 | design-lab | `save_snippet` + jailed 手；有钥匙时走 Cursor SDK |
| social | 夜枭酒保 | livehouse | `list_events`、`post_bulletin` |
| mixology | 调酒师 | livehouse | `recommend_drink`、`lookup_recipe`、`log_taste` |
| study | 禁书塔馆长 | library | `search_library`、`make_reading_plan`、`log_progress` + jailed 手 |
| divination | 驻塔巫师 | magic-house | 塔罗抽取 / 查牌 / 记录 |
| custom | 你的代理人 | 可选 | 只聊天（永远 builtin） |

每位再加 `propose_memory` / `remember_insight` / `forget_insight`，以及 `ask_agent` / `tell_agent` / `handoff` / `list_town`。镇原生的 **code** 和 **study** 另有 `file_read` / `file_write` / `file_patch` / `code_run`，工作区在 `.data/workspaces/u{userId}/{slug}/` — 这是小镇划的 jail，不是访客自己的电脑。

<p align="center">
  <img src="./assets/readme/runtime.png" width="100%" alt="代理人运行时循环">
</p>

### 运行时

`sendMessage` 是完整循环（`api/runtime/`）：抢锁 → 拼 prompt → 最多 8 步工具 → 记忆 digest → 可选 A2A。builtin provider 走 OpenAI 兼容的 `/chat/completions`。Cursor 只挂在符文匠上；没有 `providerOptions.cursorApiKey`（或 `CURSOR_API_KEY`）时退回 builtin。

当前仓库里对话仍是同步的（不是 SSE）。Cursor local 手需要按代理人配钥匙。

### 出图管线

地图抠图和 README 品牌图共用 Google Gemini 管线。只设 `GOOGLE_API_KEY`（见 `scripts/art/env.example`）。不要同时设 `GEMINI_API_KEY`。

```bash
npm run art:list
npm run art:readme          # 魔法镇 README 图 → assets/art-preview + assets/readme/
npm run art:generate -- --ids b-townhall
npm run art:punch -- b-townhall.png   # 只用于抠图；flood-fill 进 public/
```

Punch 只用于黑底建筑。README 场景不要 punch。

### 说明

- 更适合鼠标或触控板（自定义光标 + 地图手势）。
- 声音可在导航栏开关。
- 地标名和 GitHub Pages 域名仍带着海边地图的遗留标签。产品壳已经叫魔法镇 / Magic Town。

### 许可

- **源代码** 采用 [MIT License](./LICENSE) 发布。
- **`public/` 下的视觉素材**（地图、地标、场景、logo、光标等）**不适用** MIT。其中多数借助 AI 生成；请勿在未获许可的情况下，将其作为独立素材或其他项目品牌使用。详见 [NOTICE](./NOTICE)。

### 制作工具

- 氛围编程（vibe coding）：[Kimi K3 Swarm](https://www.kimi.com/)
- README 文案：Cursor Grok 4.6
