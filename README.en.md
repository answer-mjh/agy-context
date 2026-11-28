# Antigravity Context

[中文](README.md) · **English**

A context insights plugin for **Google Antigravity**. It puts per-request context composition, token accounting, timeline evolution, file & command activity, and multi-agent fleets into a single panel.

- Zero third-party dependencies, zero build step — runs on Antigravity's bundled Node.js runtime
- Bilingual UI (EN / 中文) and automatic light / dark / high-contrast theming
- Reads only local data under `~/.gemini/antigravity`; no network, no uploads
- Derived from [dsh-context](https://github.com/bowenliang123/dsh-context) (Apache-2.0, see [NOTICE](NOTICE))

![Context insights](docs/screenshots/insights.png?v=2)

## Features

### 1. Context Insights

Full-width `Context Insights` page (sidebar) and the same tab in the aux pane.

- **Weekly Quota window (`Weekly Quota`)**: queries Antigravity `RetrieveUserQuotaSummary` for real `[resetTime - 7d, resetTime)` cycles using 5-minute + model-pool (`Gemini` / `Claude & GPT`) slices, displaying remaining quota %, reset countdowns, and pool filter chips (falls back to local calendar week when the LS is unavailable)
- **KPIs**: billable tokens, estimated cost, weighted cache hit rate (including `cacheCreationTokens` and excluding `CHECKPOINT` compaction overhead), active sessions & turns, tool executions, active time
- **7-day usage & cost** chart, **8-week heatmap** (click a day to filter sessions)
- **Rankings**: skills loaded, tool calls, command programs — click to filter
- **Billing composition** donut plus sortable session cards (recent / tokens / context size / cost)

### 2. Context panel

The right-hand aux pane, scoped to the current conversation.

- **Session isolation & instant switching**: reads the host-injected `conversationId`, polls every 3s with `rev` short-circuiting (skipping payloads & DOM rebuilds when unchanged), and switches top-level tabs instantaneously from memory cache with background revalidation
- **Stats**: Context (turns / steps / tools / commands / billing), Token (billable total, category split, official cache hit; tool definitions listed separately), Timing (official streaming decode tok/s for latest request + weighted average + TTFT tooltip, model wait / tool execution / overhead)
- **Model & Orchestrator Usage**: localized model/effort labels, top route pill (`Planner → Executor`), and collapsible **Orchestrator vs Executor** (or per-model **Model Usage**) card with cold-switch & compaction cost tracking
- **Current context**: official language-service snapshot with dual baselines (effective 512k vs native 1M), composition bar, immediate post-`/compact` reset, and per-category breakdown
- **Timeline**: Step/Turn × Total/Delta/Overview, event markers (compaction, skill, model switch, error, slowest, largest growth), hover sync, step brief
- **Recent Calls (collapsible paginated table)**: 11-column per-request official telemetry ledger (`Time`, `Actual Model` with two-pass `Plan` / `Exec` role badges, `Input`, `Net Δ`, `Output` with explicit/implicit `Think %`, `Cache Hit` with `Warm` / `Partial` / `Cold` / `Switch Cold`, `Cost`, `TTFT`, `Total`, `Speed` with `Short` sample guard, `Status`); supports `10 / 20 / 50` page sizes, filters, and row click to jump to timeline & browser
- **Context Browser & DNA**: slim list payload with ~94% smaller `/api/step`, on-demand single-item detail loading (`?itemId=`) + backend full-text search (`?q=`), zero-lag in-place category/item/Raw-Markdown toggles, sorting, `vs Prev Turn/Step` deltas, image thumbnails, and a read-order **DNA strip**
- **Events, File Activity, Command Executions**: all collapsible in-place (plus per-file expansion) and linked to the selected step

### 3. Fleet

- Fleet summary (agents, running, work items, messages, family tokens & cost)
- **Agent network**: one live card per agent (type, model, context usage, composition, steps, requests, active time, billing); hover to highlight the lineage, click to open that conversation
- **Cross-agent collaboration** swimlanes, delegation **task cards** with final reports, and a filterable event inspector

## Screenshots

| Context panel | Fleet |
| --- | --- |
| ![Context panel](docs/screenshots/context.png?v=2) | ![Fleet](docs/screenshots/fleet.png?v=2) |

<p align="center">
  <img src="docs/screenshots/aux-pane.png?v=2" width="360" alt="480px aux pane">
</p>

## Install

Requires the Antigravity App with at least one conversation. Tested on **Windows + Antigravity App**; other platforms can copy manually.

```powershell
# Windows
git clone https://github.com/answer-mjh/agy-context.git
cd agy-context
powershell -ExecutionPolicy Bypass -File .\scripts\install-plugin.ps1
```

```bash
# macOS / Linux
git clone https://github.com/answer-mjh/agy-context.git
mkdir -p ~/.gemini/config/plugins
cp -R agy-context ~/.gemini/config/plugins/agy-context
```

Then open **Customizations → agy-context**, enable the plugin and the **Antigravity Context** sidecar, and open the panel from **Plugins → Context Insights** (sidebar) or **`+` → Context** (aux pane).

## Usage

- `Context panel` → how much context the current conversation uses; `Token stats` is the billing view, `Current context` is the official snapshot view
- `Context Browser` → find what eats the context: expand a category, sort by size, filter `Thinking / Tools / Answer`, compare against the previous turn/step
- `Timeline` → switch to `Delta` to see how the context grew, with compaction and model-switch markers
- `Context Insights` → cross-session cost, rankings, and session cards
- `Fleet` → parent/child agents, collaboration swimlanes, delegation reports

## Changelog

### v0.1.3
- **Orchestrator vs Executor / Model Usage card & route pill**: localized model/effort labels, cold-switch tracking, 0ms folding, and left-aligned Tool Calls layout.
- **Unified pricing & compaction reconciliation**: aligned official dated rates and included `CHECKPOINT` compaction costs so cards match top billing totals.

### v0.1.2
- **Recent Calls collapsible paginated table**: 11-column per-call telemetry table with Plan/Exec role attribution, thinking share, Cold/Partial/Warm cache badges, short-sample speed guard, retry/error states, pagination (`10 / 20 / 50`), filters, and step jump links.
- **0ms in-place folding & performance overhaul**: added card-level in-place collapse toggles to Recent Calls, Events, Files, and Commands; slimmed `/api/step` by ~94% with on-demand item loading (`?itemId=`) and backend full-text search (`?q=`); added `rev` poll short-circuiting, stale-while-revalidate tab switching, and `content-visibility: auto`.

### v0.1.1
- **Weekly Quota Insights view**: added `Weekly Quota` range backed by `RetrieveUserQuotaSummary`, 5-minute + model-pool slicing, and calendar-week fallback; aligned streaming decode tok/s and cache hit rate with official telemetry plus immediate post-`/compact` context reset.

### v0.1.0
- Initial release: cross-session insights, Context dashboard, Context Browser & DNA view, Events/Files/Commands tracking, and multi-agent Fleet view.

## Compared with dsh-context

Reference: [dsh-context](https://github.com/bowenliang123/dsh-context) 0.87. See [docs/parity-with-dsh-context.md](docs/parity-with-dsh-context.md).

| Capability | dsh-context | agy-context |
| --- | :---: | :---: |
| Cross-session insights | ✅ | ✅ |
| Per-session context dashboard | ✅ | ✅ |
| Official snapshot + dual window | ✅ | ✅ (when LS is available) |
| Timeline Step/Turn × Total/Delta/Overview | ✅ | ✅ |
| Context Browser / DNA / deltas | ✅ | ✅ |
| Events / file activity / commands | ✅ | ✅ |
| Multi-agent fleet & collaboration timeline | ✅ | ✅ (inferred) |
| Jump back into a specific conversation | ✅ | ❌ no stable host API |
| Pin / Lock to Main Agent | ✅ | ❌ host extension API |
| `/context` slash command | ✅ | ❌ host-fixed slash list |
| System prompt prefix / suffix | ✅ | ❌ cannot rewrite host prompt |
| Inline attachment preview (PDF / Office) | ✅ | ⚠️ images only |

## Known limitations

- No “chat” jump: the sidecar can only toggle panes, not open a specific conversation
- Insights and per-session pages differ by ~9% because `toolDefs` is not available in cached cross-session projections
- Sub-agent lineage is inferred from `conversation_summaries` and `transcript.jsonl`, not authoritative host data
- First Fleet load parses full family transcripts (a few seconds); later loads hit the cache
- Without `ANTIGRAVITY_LS_ADDRESS` (standalone mode) there is no official snapshot and windows fall back to estimates
- Attachments: images only (`/api/attachment`)

## How it works

- **L1 metadata**: read-only `conversation_summaries.db` (`node:sqlite`, directory-scan fallback)
- **L2 incremental projection cache**: updated by `transcript.jsonl` `mtimeMs + size`
- **L3 on-demand details**: stream `transcript_full.jsonl` per step, LRU cache of 4 sessions
- **Official snapshot & quota**: `GetCascadeTrajectoryGeneratorMetadata` and `RetrieveUserQuotaSummary` via `ANTIGRAVITY_LS_ADDRESS` / `ANTIGRAVITY_CSRF_TOKEN`, with on-demand `/api/step?itemId=`, backend search (`?q=`), and `rev` short-circuit polling
- **Checkpoints**: `CHECKPOINT` steps reset the cumulative context and are recorded as compaction events

## Development

```bash
node sidecars/context_panel/main.mjs --standalone-port 17846   # standalone (no LS snapshot)
node tests/verify.mjs                                          # backend self-check
```

## License

[Apache-2.0](LICENSE).

This project is a derivative work of [dsh-context](https://github.com/bowenliang123/dsh-context) (Copyright 2025 bowenliang123, Apache-2.0): its context-insight feature set and UI information architecture were ported to the Antigravity sidecar runtime with a zero-build implementation. See [NOTICE](NOTICE) for the list of modifications.
