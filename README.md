# AI Sidebar

**English** · [简体中文](README.zh-CN.md)

An open-source, BYOK (bring-your-own-key) AI sidebar for Chromium browsers. ChatGPT-in-the-sidebar, except the key is yours, the model is your choice, and the agent can actually read and operate the page you are looking at.

Built with [WXT](https://wxt.dev) + React 19, running entirely on your machine: API keys and conversations never leave the browser except as requests to the provider you configured.

> `ai-sidebar` is the permanent internal codename. The store name is **AI Sidebar**.

---

## What it does

**Chat that stays out of your way**

- Native `sidePanel` UI: streaming answers, Markdown, syntax-highlighted code (Shiki, light/dark themes), collapsible thinking sections, tool-call cards
- Session history with AI auto-titling, inline rename, Markdown export, and follow-up suggestions
- Composer with slash commands (`/compact`, `/clear`, `/help`), quick prompts, and a per-session draft that follows the session
- Context-window ring so you can see how full the model's window is, plus one-command compaction

**Your providers, your keys**

- Three wire protocols: **OpenAI-compatible Chat Completions**, **OpenAI-compatible Responses**, and **Anthropic Messages**
- Works with OpenAI, DeepSeek, OpenRouter, Kimi, GLM, Ollama, or any custom `baseUrl` + key + model
- Pull model lists from the provider, sync metadata from models.dev, test connections, or add models by hand
- Per-role model assignment: a main model for chat, a lighter one for auxiliary work (titling, quick prompts), each with its own thinking level

**Page context, read on demand**

- Reference tabs are attached to your message as a `<page-refs>` block; the model sees what pages you meant, not their contents
- Pick elements visually — a picked element becomes an inline badge in your message, and the model reads it back when needed
- `read_page` / `read_element` / `search_page` fetch content only when the model asks for it; images can be sent to vision models
- Long pages are windowed: a truncated read tells the model exactly which character range it got and how to read the rest

**Agentic page actions**

- `search_element` lists interactive elements with ARIA role + accessible name, so the model can act without guessing selectors
- `click_element`, `fill_element`, `scroll_page`, `screenshot_page`, `open_page`, `activate_page`, `close_page`
- `execute_js` for the long tail, and `fetch_url` / `search_web` to reach beyond the current tab
- `read_time` answers time-relative questions from the device clock, and `ask_user` lets the model put a structured question to you instead of guessing
- Every privileged action is confirmation-gated by default (or granted for the session), with before/after feedback and structured errors
- Screenshots of background tabs go through CDP, so capturing a tab does not yank your view away

**Search**

- Ten interchangeable web-search sources: DuckDuckGo, SearXNG, Brave, Tavily, Bocha, Serper, Exa, Zhipu, Metaso, Bing — bring your own endpoint/key where required

**Everything local**

- Settings and API keys in `chrome.storage.local`
- Conversations as JSONL records in IndexedDB, aligned with pi's session format (entry ids + linear parent chain)
- Optional WebDAV backup, encrypted client-side (AES-GCM, PBKDF2) before upload

---

## Requirements

- Chromium-based browser, **Chrome 135+** (Edge/Brave equivalent)
- Node.js 20+ and pnpm, for building from source
- An API key for at least one provider (or a local model via Ollama / any OpenAI-compatible endpoint)
- **Chrome 138+**: to use `execute_js`, enable *Allow User Scripts* on the extension's details page (Chrome requires this toggle for user scripts; the extension walks you through it on first launch)

---

## Install

### From source

```bash
pnpm install
pnpm dev          # starts WXT, builds, and launches Chrome with the extension loaded
```

Manual load instead:

```bash
pnpm build        # output in .output/chrome-mv3
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `.output/chrome-mv3`.

### Package a zip

```bash
pnpm zip          # .output/ai-sidebar-<version>-chrome.zip
```

---

## Permissions, and why each one exists

| Permission | Used for |
|---|---|
| `storage`, `unlimitedStorage` | settings, API keys, and the conversation database |
| `sidePanel` | the sidebar itself |
| `scripting` | injecting the content script where declarative injection did not apply |
| `activeTab` | operating on the page you have open, after you invoke the extension |
| `userScripts` | running `execute_js` in the page's own world (Chrome 135+, with the user toggle) |
| `debugger` | a trusted-wheel scroll fallback, and screenshots of background tabs (Chrome shows an "being debugged" banner while attached; the extension detaches after 60s idle) |
| `favicon` | tab favicons in the reference bar |
| `<all_urls>` | reading referenced pages and capturing the visible tab |

Nothing is sent to a server owned by this project — there is no such server. Requests go only to the provider and search endpoints you configure.

---

## How page context works

The extension deliberately does **not** dump the page into every request:

1. Referenced tabs are attached as metadata (`tabId`, title, URL) in a `<page-refs>` block, and picked elements as inline `<picked-element …/>` markers in your message text.
2. The system prompt tells the model these handles exist.
3. When the model needs content, it calls `read_page` / `read_element` / `search_page` / `search_element`, and only that result enters the context window.

Reads are bounded (12,000 characters per window, block-aligned) and a truncated read reports the total length plus the exact offset to continue from, so long articles can be read across several calls instead of being silently cut.

---

## Tech stack

| Area | Choice |
|---|---|
| Framework | WXT 0.21, React 19, TypeScript, pnpm |
| UI | Tailwind v4, shadcn/ui on Base UI primitives, lucide icons |
| State | zustand v5 (single store, explicit IndexedDB persistence) |
| AI | `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` (the agent loop, tool calling, and compaction are upstream, not re-implemented) |
| Storage | IndexedDB via `idb`, JSONL records; Markdown export |
| Extraction | Mozilla Readability + semantic Markdown conversion, ARIA metadata via `dom-accessibility-api` |
| Composer | TipTap 3 (inline reference and element badges) |
| Highlighting | Shiki with the JavaScript regex engine (no WASM, so it survives the MV3 CSP) |

---

## Project layout

```
entrypoints/
  background.ts        opens the side panel from the toolbar
  content.ts           page extraction, element picking, ARIA discovery, page actions
  sidepanel/           the UI (App, store slices, hooks, chat & settings components)
lib/
  agent.ts             pi Agent wiring: session agents, send/continue, event bridge
  sessionRuntime.ts    UI projection layer (agent events to renderable state)
  sessionStore.ts      JSONL session records in IndexedDB
  tools/               one file per tool + the single registry that assembles them
docs/                  decisions, pitfalls, status, regression checklist, test script
fixtures/              local pages for manual testing (long-page, page-actions)
tests/                 node:test suites
```

---

## Development notes

```bash
pnpm compile      # tsc --noEmit
pnpm build        # production build
pnpm zip          # store package

npx tsx --test "tests/*.test.ts"    # test suites (node:test)
```

- After changing `entrypoints/content.ts`, the message protocol, or permissions, **restart `pnpm dev` and reload the target page** — a side-panel hot update does not refresh content scripts.
- The dev browser profile is persisted (`.wxt/chrome-data`), so logins and test data survive restarts.
- Local fixtures: `npx http-server fixtures/page-actions -p 8788` and `npx http-server fixtures/long-page -p 8789`.

---

## Documentation

| File | Contents |
|---|---|
| [docs/decisions.md](docs/decisions.md) | decision log — why things are the way they are |
| [docs/pitfalls.md](docs/pitfalls.md) | UI/React/Tailwind and upstream-library pitfalls, environment notes |
| [docs/status-and-open-issues.md](docs/status-and-open-issues.md) | current stage, backlog, open issues and how to gather evidence for them |
| [docs/regression.md](docs/regression.md) | manual regression checklist and prompts |
| [docs/session-jsonl-format.md](docs/session-jsonl-format.md) | session record format specification |
| [AGENTS.md](AGENTS.md) | project conventions and constraints |

---

## Status

Feature-complete for the planned scope, packaged as `0.2.0`. Manual regression has passed for the tool, performance, i18n and storage paths; open issues and anything still unverified are tracked honestly in [docs/status-and-open-issues.md](docs/status-and-open-issues.md).

## License

[MIT](LICENSE) © 2026 Yueby.
