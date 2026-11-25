# pump-fun-sharpe-sprint-entry

[![make.fun · u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/KazellaZenia/pump-fun-sharpe-sprint-entry/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/KazellaZenia/pump-fun-sharpe-sprint-entry/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

Paper-trading bot for the make.fun bounty
[Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532).
Ranked by hourly Sharpe ratio on a 6-hour pump.fun forward replay; top 3 paid.

## Strategy: Spray-Early

Buy every new coin the moment the 1%-of-real-reserves size cap first allows
the 0.01 SOL stake, then exit on take-profit +30%, stop-loss −40%, or a
2-hour timeout. Hold at most 5 positions; recycle a freed slot into the
next fresh coin immediately.

Why: on the dev window a coin's whole initial pump happens inside its
creation slot, so batch-end entries can never catch it and every directional
rule tested loses after fees. Spray-early is the only family tested that
clears the 20-distinct-mint minimum inside a 6-hour window (about 26
projected mints) while keeping drawdown tiny (about 1%): its per-trade
profile is lottery-shaped (roughly 28% wins, average win about +32% of
stake, average loss about −15%), so in a fresh window a couple of caught
pumps flip it net-positive with a high hourly Sharpe. Dev validation
(grade-local, full 24h dev window): net PnL −0.093 SOL, Sharpe −0.459,
max drawdown 1.07%, win rate 27.9%, 104 round trips on 104 distinct mints,
compliant. The dev numbers are negative — an honest, near-breakeven,
low-drawdown entry whose case rests on the fresh 6-hour final window.

## Run it

```sh
node main.ts
```

The grader runs `node /bot/main.ts` (Node 22, type stripping, zero
dependencies). The bot speaks `agent-fun/replay/v2` on stdin/stdout via
the vendored shim in `vendor/makefun-bot.ts`. See `STRATEGY.md` for the
full write-up.

---

<sub>Entered on [make.fun](https://make.fun/?ref=kazellazenia)</sub>
