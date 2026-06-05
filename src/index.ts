#!/usr/bin/env bun
import { SafetyError } from "./safety.ts";
import { UsageError, parseArgs, type ParsedArgs } from "./cli/parse.ts";

import * as authStatus from "./commands/auth-status.ts";
import * as accounts from "./commands/accounts.ts";
import * as campaigns from "./commands/campaigns.ts";
import * as insights from "./commands/insights.ts";
import * as fatigue from "./commands/fatigue.ts";
import * as budgetRecs from "./commands/budget-recs.ts";
import * as briefing from "./commands/briefing.ts";
import * as pause from "./commands/pause.ts";
import * as resume from "./commands/resume.ts";
import * as budget from "./commands/budget.ts";

const USAGE = `usage: metapilot <command> [args...]

reads:
  auth-status                              check Meta auth state
  accounts                                 list accessible ad accounts
  campaigns                                list campaigns
  insights [<id>] [--kind=...] [--since=...] [--fields=...]
           [--breakdowns=...]
  fatigue                                  flag fatigued ads (last 7d vs prior 7d)
  budget-recs                              winners/bleeders + shift recommendations
  briefing                                 daily briefing (pacing + perf + fatigue)

writes (preview without --yes, execute with --yes):
  pause  <campaign|adset|ad> <id> [--yes]
  resume <campaign|adset|ad> <id> [--yes --confirm-activate]
  budget <adset-id> <usd> [--yes] [--confirm-large-budget] [--first-budget]
`;

type CommandFn = (parsed: ParsedArgs) => Promise<number>;

const COMMANDS: Record<string, CommandFn> = {
  "auth-status": () => authStatus.run(),
  accounts: () => accounts.run(),
  campaigns: () => campaigns.run(),
  insights: (p) => insights.run(p),
  fatigue: () => fatigue.run(),
  "budget-recs": () => budgetRecs.run(),
  briefing: () => briefing.run(),
  pause: (p) => pause.run(p),
  resume: (p) => resume.run(p),
  budget: (p) => budget.run(p),
};

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === "--help" || cmd === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    const pkg = await Bun.file("package.json").json();
    process.stdout.write(`metapilot ${pkg.version}\n`);
    return 0;
  }

  const handler = COMMANDS[cmd];
  if (!handler) {
    process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}`);
    return 2;
  }

  try {
    return await handler(parseArgs(rest));
  } catch (err) {
    if (err instanceof SafetyError) {
      process.stderr.write(`safety: ${err.message}\n`);
      return 3;
    }
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    process.stderr.write(
      `error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

process.exit(await main());
