// Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins.
// Entry point: speaks agent-fun/replay/v2 on stdin/stdout via the vendored
// shim; the strategy lives in strategy.ts (Spray-Early: buy every new coin
// the moment the 1% size cap first allows the 0.01 SOL stake; exit on
// take-profit +30%, stop-loss -40%, or a 2-hour timeout; at most 5 open
// positions). Run by the grader as `node /bot/main.ts` (Node 22, type
// stripping, zero dependencies).

import { runBot } from "./vendor/makefun-bot.ts";
import { createSprayEarlyBot } from "./strategy.ts";

await runBot(createSprayEarlyBot());
