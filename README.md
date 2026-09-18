<p align="center">
  <a href="./README.md"><img src="./assets/readme/badge-en-on.svg" height="36" alt="English"></a>
  &nbsp;
  <a href="./README.zh-CN.md"><img src="./assets/readme/badge-zh-off.svg" height="36" alt="中文"></a>
</p>

<h1 align="center">Magic Town</h1>

<p align="center">
  <strong>magictown-selfagent</strong><br>
  A personal self-agent product: an isometric town shell, plus residents you can actually talk to.
</p>

<p align="center">
  <a href="https://github.com/Ginger-Juice/magictown-selfagent"><strong>GitHub →</strong></a>
</p>


<p align="center">
  <img src="./assets/readme/hero.png" width="100%" alt="Magic Town — isometric town shell for personal self-agents">
</p>

<p align="center">
  <img src="./assets/readme/showcase.png" width="100%" alt="Magic Town showcase: map shell and resident chat">
</p>

---

**Magic Town** (魔法镇) is a local town OS. The map is the front door. Behind `/login` and `/agents` sits a Hono + tRPC + Drizzle runtime: eight seeded residents with tools and memory, one visitor-registered agent, and a real model loop — not canned map-site copy.

Package name: `magictown-selfagent`. Human brand: Magic Town / 魔法镇.

### What it is

- **Town shell** — Vite / React isometric map. `/` currently mounts `DebugMap` (painted map + “Edit layout”), not the visitor `TownMap`. Login and agents stay in the nav. Landmark lore and much of the map art are still leftover seaside-town scenery; they are not this product’s identity.
- **Town residents** — eight seeded agents on `/agents`. Chat is a full builtin (OpenAI-compatible) loop. Default vendor is DeepSeek (`.env.example`).
- **Your agent** — after a town pass, you may register one custom agent.
- **Town OS** — Hono API (`api/boot.ts`), tRPC, Drizzle/MySQL, memory, A2A envelopes, jailed workspaces, optional Cursor SDK for the rune wright.

Wander the map anonymously. Conversations and agent registration need `/login`.

### Stack

**Shell:** React 19 · TypeScript · Vite · Tailwind CSS · Framer Motion · GSAP · Lenis · Howler · shadcn/ui

**Town OS:** Hono · tRPC · Drizzle · MySQL · `@cursor/sdk`

Model keys live in `.env.example`. Map/README art, if you regenerate it, is Google Gemini via `scripts/art/generate.mjs` — see `.cursor/rules/art-pipeline.mdc`.

<p align="center">
  <img src="./assets/readme/section-run.png" width="100%" alt="Run Magic Town locally">
</p>

### Run it

The map shell is a Vite SPA. **Agent chat needs the Node API and MySQL.** `npm run dev` starts both (Vite + Hono on port 3000).

```bash
git clone https://github.com/Ginger-Juice/magictown-selfagent
cd magictown-selfagent
cp .env.example .env   # DATABASE_URL plus at least one vendor key (DeepSeek is the default)
npm install
npm run dev            # http://localhost:3000
```

```bash
npm run build          # frontend → dist/public, API bundle → dist/boot.js
npm start              # production Node server (static files + /api)
npm run check          # tsc -b
npm run lint           # eslint
npm test               # vitest
```

GitHub Pages from `main` still publishes **only** the static frontend (`dist/public`). That is not the town runtime. The leftover Pages hostname is still `summertown.summercommences.com` (`CNAME` / `public/CNAME`); this pass does not change DNS or deploy.

### Routes

| Route | What it is |
| --- | --- |
| `/` | Painted map layout workshop (`DebugMap`). Landmark chat exists here; visitor `TownMap` is not mounted. |
| `/login` | Town pass — required to talk or register an agent |
| `/agents` | Seeded residents + your registered agent, chat, memory drawer |
| `/town-admin` | Town admin |
| `/journal` | Passport index, calendar, postcard wall, visitor trail |
| `/visit` | Ferry / stay / etiquette pages (inherited map-shell copy) |
| `/windbell-isle` | Scroll journey (inherited isle shell) |
| `/apple-album` · `/apple-admin` | Apple-a-day album and its admin |

Deep links: `/agents?agent=<id>`, `/agents?memory=<id>`.

<p align="center">
  <img src="./assets/readme/section-agents.png" width="100%" alt="Town residents">
</p>

### Town residents

Seeded by `ensureTownAgents()` in `api/agents.ts`. Behaviour (tools, memory slots, provider) lives in `KIND_PRESETS` (`api/runtime/registry.ts`).

| Kind | Resident | Landmark slot | Tools (plus shared memory / A2A) |
| --- | --- | --- | --- |
| work | 书记官 (clerk) | town-hall | `add_task`, `list_tasks` |
| diet | 营养巫师 (nutritionist) | coffee | `log_meal`, `lookup_dish` |
| fitness | 晨练教练 (coach) | hotel | `log_workout`, `suggest_plan` |
| code | 符文匠 (rune wright) | design-lab | `save_snippet` + jailed hands; Cursor SDK when a key is present |
| social | 夜枭酒保 (barkeeper) | livehouse | `list_events`, `post_bulletin` |
| mixology | 调酒师 (mixologist) | livehouse | `recommend_drink`, `lookup_recipe`, `log_taste` |
| study | 禁书塔馆长 (librarian) | library | `search_library`, `make_reading_plan`, `log_progress` + jailed hands |
| divination | 驻塔巫师 (tower wizard) | magic-house | tarot draw / lookup / log |
| custom | your agent | optional | chat only (always builtin) |

Everyone also gets `propose_memory` / `remember_insight` / `forget_insight` and `ask_agent` / `tell_agent` / `handoff` / `list_town`. Town-native **code** and **study** get `file_read` / `file_write` / `file_patch` / `code_run` against `.data/workspaces/u{userId}/{slug}/` — a jail, not the visitor’s own machine.

<p align="center">
  <img src="./assets/readme/runtime.png" width="100%" alt="Agent runtime loop">
</p>

### Runtime

`sendMessage` is a real loop (`api/runtime/`): lock → prompt → up to 8 tool steps → memory digest → optional A2A. Builtin providers speak OpenAI-compatible `/chat/completions`. Cursor is wired for the rune wright only; without `providerOptions.cursorApiKey` (or `CURSOR_API_KEY`) that resident falls back to builtin.

Still true in this tree: chat is synchronous (not SSE). Cursor local hands need a per-agent key.

### Art pipeline

Map cutouts and README brand frames share one Google Gemini pipeline. Set **only** `GOOGLE_API_KEY` (see `scripts/art/env.example`). Do not also set `GEMINI_API_KEY`.

```bash
npm run art:list
npm run art:readme          # Magic Town README frames → assets/art-preview + assets/readme/
npm run art:generate -- --ids b-townhall
npm run art:punch -- b-townhall.png   # cutouts only; flood-fill into public/
```

Punch is for black-background cutouts. Do not punch README scenes.

### Notes

- Best with a mouse or trackpad (custom cursor + map gestures).
- Sound toggles from the navbar.
- Landmark names and GitHub Pages DNS still carry leftover seaside-map labels. Product chrome already says Magic Town / 魔法镇.

### License

- **Source code** is released under the [MIT License](./LICENSE).
- **Visual assets** under `public/` (map art, landmarks, scenes, logos, cursors) are **not** MIT-licensed. Many were created with AI assistance; please do not reuse them as standalone assets or project branding without permission. See [NOTICE](./NOTICE).

### Made with

- Vibe coding: [Kimi K3 Swarm](https://www.kimi.com/)
- README writing: Cursor Grok 4.6
