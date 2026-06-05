# MetaPilot

Open-source, AI-powered Meta Ads manager. Wraps Meta's official `meta-ads` CLI in a Claude Code skill so e-commerce operators can manage Meta/Instagram campaigns through natural language instead of Ads Manager or shell commands.

**Status:** Phase 1 (MVP). Read layer, fatigue detection, budget recommendations, daily briefing, and gated writes all in place. Subprocess paths have not been exercised against a live `meta` CLI yet.

**Scope:** Phase 1 is **single-account**. Set `AD_ACCOUNT_ID=act_…` in your environment; every command that touches campaigns/ad sets/ads requires it. Managing multiple accounts in one session is Phase 2.

---

## Why

Meta launched their official Ads CLI in April 2026. It's a developer tool. The operators who could most use it — Shopify merchants spending $2K–50K/mo on ads, agency operators with 10+ accounts, DTC founders making daily budget decisions — will never open a terminal. MetaPilot meets them in Claude (and eventually WhatsApp / Telegram). They ask a question, get an answer. They request a change, MetaPilot stages it and asks for explicit confirmation before doing anything.

---

## Requirements

- [Bun](https://bun.sh) ≥ 1.1
- Python ≥ 3.12 (for Meta's `meta-ads` CLI)
- `uv` or `pipx` to install `meta-ads`
- A Meta Business account with ad-account access

---

## Quickstart

```bash
git clone <repo-url> metapilot
cd metapilot
./scripts/setup.sh
```

`setup.sh` installs `meta-ads` if missing, runs `bun install`, opens the OAuth browser flow if you're not authenticated, and verifies with `metapilot auth-status`.

---

## Usage — Claude Code skill

The skill is defined in [`SKILL.md`](SKILL.md). Once registered with Claude Code, ask in natural language:

- "How are my ads doing this week?"
- "Show me top 3 campaigns by ROAS."
- "Any ads bleeding money?"
- "Pause campaign 12345."
- "Set ad set 67890 daily budget to $40."

For writes, the skill always shows a preview and asks for explicit confirmation before invoking anything that changes campaign state.

---

## Usage — direct CLI

Reads (no confirmation):

```bash
metapilot auth-status
metapilot accounts
metapilot campaigns
metapilot insights                            # account rollup, last 7d
metapilot insights 123456 --kind=campaign
metapilot insights 123456 --breakdowns=age,gender
metapilot insights --since=last_30d
metapilot fatigue                             # last 7d vs prior 7d
metapilot budget-recs                         # winners / bleeders / shifts
metapilot briefing                            # composed report (5 sections)
```

Writes (two-phase: preview, then execute with `--yes`):

```bash
metapilot pause campaign 12345                # preview JSON
metapilot pause campaign 12345 --yes          # execute

metapilot resume campaign 12345
metapilot resume campaign 12345 --yes --confirm-activate

metapilot budget 67890 40.00                  # preview
metapilot budget 67890 40.00 --yes
metapilot budget 67890 100.00 --yes --confirm-large-budget  # > 2× current
```

Run via `bun run src/index.ts <cmd>` or compile to a single binary with `bun run build` and invoke `./metapilot <cmd>`.

---

## Safety

Account bans from ad automation are a real risk. MetaPilot enforces these rules **in TypeScript** (`src/safety.ts`, `src/meta-cli.ts`), not just in skill prompts:

- Every write requires explicit `--yes`. Without it, the binary emits preview JSON and exits.
- Activation requires `--yes --confirm-activate` (double confirmation per spec §4.2).
- Budget changes > 2× current are refused unless `--confirm-large-budget` is set; if the current budget can't be read, the change is treated as large by default (fail closed).
- 10 writes per hour max, 5-second cooldown between consecutive writes. State in `logs/.safety-state.json`.
- Every CLI invocation appended to `logs/audit.jsonl` (append-only, JSON Lines).
- Never deletes campaigns / ad sets / ads — pause only.
- Never reads, logs, or stores OAuth tokens. Meta's CLI owns the token lifecycle.

Full rules in [`CLAUDE.md`](CLAUDE.md) and the spec §4.

---

## Architecture

```
User (NL)
  → Claude Code (SKILL.md intent parsing)
  → metapilot CLI (TypeScript on Bun)
  → src/meta-cli.ts (safety gate + audit log; sole spawner)
  → Bun.spawn("meta", [...]) with --format json
  → Meta Ads CLI → Meta Marketing API
```

Pure analyzers (`fatigue.ts`, `budget-recs.ts`, `briefing.ts`) take already-fetched JSON as input, so they're unit-tested without any subprocess. The single subprocess gateway in `meta-cli.ts` is the only file that spawns `meta` — all rate limiting, auditing, and result normalization lives there.

---

## Development

```bash
bun install
bun test            # 29 tests across analyzers
bunx tsc --noEmit   # typecheck
bun run start <cmd> # run CLI in dev
bun run build       # ./metapilot single-file binary
```

Test files colocated (`src/*.test.ts`); Bun discovers them automatically.

---

## Roadmap

Per spec §8:

- **Phase 1 (current):** Claude Code skill — reads, safe writes, fatigue, budget recs, daily briefing.
- **Phase 2:** Cowork skill, voice I/O, scheduled briefings, multi-account, Telegram bot, WhatsApp Business API.
- **Phase 3:** Public launch, OpenClaw skill directory, Slack / Discord adapters.
- **Phase 4:** Shopify revenue connector (Cloudflare Worker), Google Ads / TikTok Ads support.

---

## Contributing

Early stage. Read [`CLAUDE.md`](CLAUDE.md) first — safety rules in §4 of the spec are non-negotiable. Issues and PRs welcome once the repo is public.

## License

Apache 2.0

---

This was developed for Zalify and to work seamlessly with Zalify's Analytics and Attribution so that there are no blind gaps between first and last click flow.

Visit [Zalify Attribution](https://zalify.com/attribution) to learn more.
