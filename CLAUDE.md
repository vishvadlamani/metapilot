# MetaPilot

Open-source, AI-powered Meta Ads manager for e-commerce operators. Wraps Meta's official Ads CLI (`meta`) in a conversational interface so Shopify merchants, agency operators, and DTC founders can manage Meta/Instagram ad campaigns through natural language instead of Ads Manager or shell commands.

**Status:** Early development. Phase 1 / MVP scaffold is in place; most write commands and analysis modules are not yet implemented.

**Full specification:** `specs/MetaPilot_ProductSpec_v1.docx`. The spec is authoritative; this file is a working summary plus engineering conventions. When the two disagree, the spec wins unless updated here with an explicit reason.

---

## Primary deliverable (Phase 1 / MVP)

A **Claude Code skill** (`SKILL.md`) that drives a local `metapilot` TypeScript CLI:
1. Skill takes a natural-language request from the user ("How are my ads doing this week?", "Pause ad set 12345").
2. Skill maps it to one or more `metapilot` subcommands.
3. The `metapilot` binary shells out to Meta's official `meta` CLI with `--format json` and enforces all safety rules (rate limits, audit log, budget caps).
4. For reads: executes, returns JSON to the skill, which formats it for the user.
5. For writes: stages the action, the skill shows a preview, requires explicit user confirmation, then `metapilot` executes and appends to the audit log.

Phase 2+ adds Cowork skill, OpenClaw skill, Telegram bot, WhatsApp Business API bot, voice I/O, scheduled briefings, multi-account. Core engine is shared; only the interface adapter changes per platform.

---

## Tech stack

| Layer | Tech | Notes |
|---|---|---|
| Core CLI + engine | **TypeScript on Bun** | Single language across CLI, adapters, and Cloudflare Worker. Bun for runtime, test runner, and `bun build --compile` for single-binary distribution. |
| Underlying ad API | Meta Ads CLI (Python ≥3.12, PyPI `meta-ads`) | Meta's official tool. CLI-only — no library API exposed. We shell out via `Bun.spawn`. |
| Claude Code skill layer | `SKILL.md` | Markdown skill instructions that drive the `metapilot` binary. |
| Auth | Meta OAuth (browser) | Handled entirely by `meta` CLI. **We never touch, store, or log tokens.** |
| State | Local JSON / JSONL files | `config/benchmarks.json`, `config/preferences.json`, `logs/audit.jsonl`. No database. |
| Bot adapters (Phase 2) | TypeScript libraries | Telegram via `grammY`, WhatsApp via Meta's Cloud API. Same Bun runtime. |
| Cloudflare Worker | TypeScript + Wrangler | Separate sub-project under `cloudflare-worker/`. Shopify OAuth + revenue connector. Deferred. |

**Why TypeScript + Bun:**
- Most of the workload is subprocess orchestration + JSON parsing — TS handles both natively.
- Single language end-to-end (CLI, bot adapters, Cloudflare Worker) reduces context switching.
- `bun build --compile` produces a single-binary distributable when we need one.
- Largest contributor pool for an OSS e-commerce tool.

**Why not Rust:** Workload is I/O-bound (Meta API is the bottleneck); Rust's perf/safety advantages don't apply to subprocess-and-JSON glue. Verbose JSON handling for no payoff.

**Why not Python:** Two-language split would still be needed for the Cloudflare Worker. Keeping everything TS avoids that.

---

## Repo layout

```
metapilot/
  CLAUDE.md                # this file
  SKILL.md                 # Claude Code skill: NL → metapilot subcommands, safety rules
  specs/
    MetaPilot_ProductSpec_v1.docx
  package.json             # Bun + TS deps and scripts
  tsconfig.json
  .gitignore
  src/
    index.ts               # thin dispatcher → src/commands/*
    cli/
      parse.ts             # argv parser, helpers, UsageError
      parse.test.ts
    commands/              # one file per subcommand (run(parsed) → exit code)
      auth-status.ts
      accounts.ts
      campaigns.ts
      insights.ts
      fatigue.ts
      budget-recs.ts
      briefing.ts
      pause.ts
      resume.ts
      budget.ts
    meta-cli.ts            # subprocess gateway — ONLY place that spawns `meta`
    safety.ts              # rate limit, cooldown, budget cap, activation gate
    safety.test.ts
    audit.ts               # append-only logs/audit.jsonl writer
    writes.ts              # preview/execute for pause / resume / budget
    insights.ts            # buildInsightsArgs + fetchInsights wrapper
    config.ts              # load benchmarks.json, preferences.json (w/ defaults)
    time.ts                # nDayWindow, fmtYmd date helpers
    fatigue.ts             # pure fatigue analyzer (spec §3.3)
    fatigue.test.ts
    budget-recs.ts         # winners/bleeders/shift recs (spec §3.4)
    budget-recs.test.ts
    briefing.ts            # daily briefing assembler (spec §3.5)
    briefing.test.ts
    # ↓ to be added as features land
    # format.ts            # JSON → human-readable
    # adapters/            # telegram.ts, whatsapp.ts, slack.ts (Phase 2+)
  config/
    benchmarks.json        # performance thresholds (target CPA, min CTR, fatigue)
    preferences.json       # output prefs, default date range
  logs/
    audit.jsonl            # gitignored, append-only action log
    .safety-state.json     # gitignored, rate-limit state
  scripts/
    setup.sh               # install meta CLI, authenticate, bun install
    daily_briefing.sh      # dispatcher for scheduled briefing
  cloudflare-worker/       # Shopify OAuth + connector (Phase 4, separate workspace)
```

---

## Safety rules (non-negotiable)

From spec §4. Account bans from automation are a real risk; every design decision prioritizes account safety over convenience.

1. **Human-in-the-loop for ALL writes.** Every write shows a preview of what will change and requires an explicit "yes" before executing. No silent actions, ever.
2. **PAUSED by default.** All campaigns/ad sets/ads created through MetaPilot start in `PAUSED` status. Activation is a separate, explicitly confirmed step (double-confirm for activation).
3. **Rate limiting.** Max 10 write operations per hour. 5-second cooldown between consecutive writes. Enforced in `src/safety.ts`, not in the skill prompt.
4. **Budget caps.** A single budget change > 2× current budget requires double confirmation and a warning.
5. **No bulk activation.** Cannot activate multiple campaigns in one command. One at a time, each confirmed.
6. **Audit log.** Every CLI invocation appended to `logs/audit.jsonl` with timestamp, command, mutating flag, status, exit code. Append-only.
7. **Never delete.** Pause only. No campaign/ad set/ad deletion.
8. **OAuth only.** No API keys, no PATs, no credentials in config files. If auth expires, ask the user to re-run `meta ads auth login` — no auto-refresh.
9. **No access to billing, account settings, or permissions.** Read/write campaign objects only.
10. **Never touch tokens.** Meta's CLI owns the token lifecycle. MetaPilot must not read, log, or store them.

When in doubt about whether an action is safe, fail closed and ask the user.

---

## Data flow

**Read path:**
`User (NL)` → `Claude (intent parsing via SKILL.md)` → `metapilot <subcmd>` (TS) → `Bun.spawn("meta", [...])` with `--format json` → JSON to stdout → Claude formats → User

**Write path:** read path plus a confirmation step:
`... → metapilot stages action + emits preview JSON → Claude shows preview → User confirms → metapilot executes via meta CLI → result + confirmation logged to audit.jsonl`

---

## Meta CLI command surface (used by MetaPilot)

Spec §6 has differences from the **real** `meta-ads` CLI (PyPI, Python ≥3.12). Real CLI surface confirmed by inspection:

- **Output flag is global, not per-subcommand:** `meta --output json --no-input <subcommand…>`. Spec said `--format json` — wrong. We always prepend `--output json --no-input`.
- **Auth is top-level:** `meta auth status` / `meta auth login`. NOT `meta ads auth`.
- **Ad accounts: `meta ads adaccount` (singular).** No `set-default` subcommand — account selection is via `AD_ACCOUNT_ID` env var (or `--ad-account-id`).
- **Insights flags:**
  - `--campaign-id` / `--adset-id` / `--ad-id` (hyphen). Spec used underscore.
  - `--since YYYY-MM-DD` + `--until YYYY-MM-DD` for explicit windows. Spec hallucinated `--time-range '<json>'`.
  - `--breakdown <dim>` is **singular and repeatable**. Spec said `--breakdowns age,gender` (csv). Wrong.
  - No `--level` flag. No `--ad-account` flag. Insights default to account scope; filters narrow it.
  - Valid date presets: `today | yesterday | last_3d | last_7d | last_14d | last_30d | last_90d | this_month | last_month`.
- **`campaign list` has no `--status` filter and no `--fields` selector.** We list all, then post-filter in analyzers.
- **Status enum is documented lowercase** (`active | paused | archived`) but examples use `ACTIVE`/`PAUSED` — case-insensitive in practice. We send the spec form (uppercase).
- **`<kind> get <id>` exists** for campaign/adset/ad — confirmed, used by `writes.ts` for preview fetches.
- **`<kind> delete` exists** — never wire it. MetaPilot pauses only.
- **Automation flags:** `--no-input` is top-level. **Do not** use `--force` — MetaPilot's own confirmation layer is the source of truth.

Budgets in Meta CLI are denominated in **cents**. Accept dollars from users at the CLI/skill layer and convert.

---

## Engineering conventions

- **Spec is the source of truth.** Re-read the relevant spec section before making feature decisions. Don't infer requirements that aren't there.
- **TS style:** strict mode on. `verbatimModuleSyntax`. Explicit `.ts` extensions in imports (Bun supports natively). No `any` without justification. Use `node:` prefix for built-ins.
- **Subprocess discipline:** all Meta CLI invocations go through `src/meta-cli.ts`. That module enforces rate limiting (via `safety.ts`), logs every command to `audit.jsonl` (via `audit.ts`), and is the only place that calls `Bun.spawn(["meta", ...])`. Use argv arrays — never string-interpolate user input into a shell command.
- **Safety in code, not prompts.** Rate limits, budget caps, PAUSED-by-default, and the audit log are enforced by the binary. The skill prompt may also remind users, but the binary is the gate. A misconfigured prompt must not be able to bypass safety.
- **JSON-first.** Always invoke `meta` with `--format json`. Never scrape the table output.
- **No tokens, ever.** No log line, no error message, no debug output should include OAuth tokens. Audit log records commands but never auth material.
- **Audit log is append-only.** Treat it as immutable. New entries only. No truncation, no rewrites.
- **Open-source posture.** Code will be public. No customer data, no API keys, no test credentials checked into the repo. Be deliberate about dependencies — every package is supply chain.
- **Bun-first.** Use `Bun.spawn`, `Bun.file`, `bun test`, `bun build`. Fall back to `node:` built-ins only when Bun has no first-party equivalent.

---

## Open questions from the spec (§10) — decide during dev, not upfront

- Naming (trademark check before public launch).
- Multi-account support in Phase 1 vs. Phase 2 (**Phase 1 = single account**, enforced via `requireAdAccount()` which mandates `AD_ACCOUNT_ID` env var on every `ads`-scoped command; managing multiple accounts in one session is deferred to Phase 2).
- Scheduling mechanism for daily briefings (Claude scheduling vs. cron vs. dedicated trigger).
- Rate-limit handling: back off + notify, or queue + retry.
- Benchmarks via NL vs. config file.
- Catalog management in MVP vs. Phase 2 (most Shopify merchants manage catalogs in Shopify).

---

## Unverified state (revisit when OAuth + ad account are available)

The following parts of Phase 1 have been validated structurally (argv shape accepted by real `meta-ads` CLI, exit codes propagate, audit log + safety state both record correctly) but have **not** been run against an authenticated session. They depend on Meta OAuth + a default ad account (`AD_ACCOUNT_ID` env var, or via Cloudflare Worker proxy in Phase 4).

| Surface | What's unverified |
|---|---|
| `meta auth login` flow end-to-end | Whether Meta's browser OAuth completes and writes the access token where the CLI reads it |
| `meta ads adaccount list` JSON shape | Whether response is `[…]` or `{data: […]}` — handled by `unwrapArray` either way, but field names per row are unknown |
| `meta ads campaign list` field set | Whether the default response includes `daily_budget`. `analyzeBudgets` and `assembleBriefing` depend on it; missing → analyzer treats budget as unknown (skips shift recs, leaves `daily_budget_usd: null`). |
| Insights JSON row shape | Confirmed field IDs (`spend`, `ctr`, `cpc`, …) per spec §6.2 + meta CLI `--fields` default. Unknown: row key names (`ad_id` vs `id`, `campaign_id` vs `id`, `purchase_roas` numeric vs object). Code defensively handles both via `?? id` fallbacks and string-or-number coercion in analyzers. |
| Ad-level insights without `--level` flag | Real CLI has no `--level`. `fatigue` and `briefing` ask for ad-level fields with no `--ad-id` filter and **hope** the API returns multi-row ad-level data. If it returns one aggregate row, fatigue + ad_leaders sections will be empty. Mitigation TBD: enumerate ads via `ad list` then per-ad `insights get`, but that's an N+1 pattern; defer pending real-CLI behavior. |
| Status enum casing | Real CLI's enum is `[active\|paused\|archived]` lowercase; we send `PAUSED`/`ACTIVE` per spec examples. Likely case-insensitive (click `Choice` with `case_sensitive=False`). Unverified. |
| Budget cents accepted on update | We send integer cents; CLI option is `--daily-budget INTEGER`. Confirmed signature, not roundtrip. |
| `--time-increment` for daily series | Not currently used. Real CLI accepts `daily | weekly | monthly | all_days`. May matter for future fatigue improvements. |

**Re-validation plan when auth is available:**
1. `export AD_ACCOUNT_ID=act_…` then run each read command, capture real JSON, diff against `unwrapArray` assumptions.
2. Stage a paused throwaway campaign + adset + ad. Run `metapilot pause/resume/budget` against real IDs with `--yes` and verify Meta's reported state matches.
3. Run `metapilot briefing` and confirm all 5 sections populate.
4. Add an integration-test layer that boots the real CLI against a sandbox account (when Meta exposes one — currently no Marketing API sandbox).

**Cloudflare Worker note:** The deferred `cloudflare-worker/` sub-project (Phase 4) is for **Shopify** OAuth, not Meta. Meta OAuth is handled by `meta-ads` CLI directly via `meta auth login`. The Worker becomes relevant if/when we proxy Meta calls through a hosted backend instead of running `meta` as a local subprocess.

---

## Sub-project: Cloudflare Worker (OAuth + Shopify)

Not yet started. Will live under `cloudflare-worker/` as a separate Bun + Wrangler workspace. Purpose: handle Shopify OAuth and act as the connector between MetaPilot and Shopify revenue data (Phase 4 ecosystem integration per spec §8). Same TypeScript stack as the core, so types can be shared via a future `packages/shared/` workspace if needed.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
