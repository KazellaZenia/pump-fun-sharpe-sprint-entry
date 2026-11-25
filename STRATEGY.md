# STRATEGY.md — Spray-Early

## Competition

Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins. One `main.ts` program on
Node 22, paper-trading on a 6-hour pump.fun forward replay. Ranked by hourly
Sharpe ratio (higher better), tie-break earlier receipt. $2 pot, top 3 paid
($1 / $0.60 / $0.40). Guardrails: max 5 open positions; round trips of at
least 0.01 SOL on at least 20 distinct mints; max drawdown 50%; net PnL above
0 to qualify for a prize. Harness pumpfun-replay/v2, capital 10 SOL, max 1%
of real reserves per order, max 16 orders per batch, no shorts, no leverage,
2-slot latency. Fees: protocol 95 bps + creator 30 bps fallback; base 5000 +
priority 100000 lamports per order; 2% failed-tx rate.

## What the dev data showed

The dev dataset (24h, 1,222 creates, all in-universe) is extremely adverse:
after fees, every directional rule tested loses. A coin's entire initial pump
(about 1x to 3.3x) happens inside its creation slot, in 12+ trades — the bot
only ever sees batch-end prices, so the trade#0 price is untransactable (one
slot of entry delay already flips the edge from +8% to −9.7% per trade).
Batch-end entries, dip-bounce, momentum, reversion, graduation rides, basing,
breakouts, seller exhaustion, rising reserves, and second-wave momentum all
test negative per trade.

The best Sharpe-shaped alternative found (dip-grind: buy established coins
after a 20% dip + 2% bounce, TP +10% / stop −6% / 30-min hold) has the best
true dev Sharpe (−0.190) but trades only 27 mints per 24h — about 7 mints in
a 6h window — which FAILS the 20-distinct-mint minimum, a hard gate.

## Why Spray-Early

It is the only tested family that comfortably clears the mint minimum in 6h
(about 26 projected mints) while keeping drawdown tiny (1.07%) and the
absolute loss small (−0.093 SOL on 10 SOL). Its per-trade profile is
lottery-shaped: 28% win rate, average win about +32% of stake, average loss
about −15% of stake. In a fresh 6h window, 2–3 caught pumps swing it
net-positive with a high Sharpe (mostly-flat hours + a few big positive
hours). Sweeps confirmed the parameters are near the local optimum for this
family: shorter timeouts add mints but wreck the Sharpe (30-min timeout →
Sharpe −1.02); trailing stops, partial banks, and tighter stops all test
worse; larger stakes (0.02 SOL) test worse (later entry + same fee drag).

## Parameters

- stake 0.01 SOL (minimum round trip; smallest fee share)
- take-profit +30% (price >= entry * 1.30)
- stop-loss −40% (price <= entry * 0.60)
- timeout 33,600 slots (2 hours; sell at market on the first batch at/after it)
- fresh window 1,000 slots (~3.6 minutes; buy only while the coin is this fresh)
- slippage 1,000 bps (10%) both sides
- max 5 open positions; max 16 orders per batch

## Logic

- Track every mint seen. On each batch, consider only mints with a TradeEvent
  in that batch (the size cap can only cross on a trade). Skip a mint already
  bought once, already open, or with a buy pending; skip graduated/missing
  curves.
- Buy only when the size cap (`maxBuyLamports`) is at least the stake. The
  first batch where the cap allows the stake is the mint's first-cap moment;
  buy only while current slot − first-cap slot <= 1,000. Stale coins are
  skipped forever.
- Buy only if free cash covers stake + one tx fee and a position slot is
  free. One round trip per mint, ever.
- Exits, per open position: sell ALL tokens if price >= entry * 1.30, price
  <= entry * 0.60, or age >= 33,600 slots. Entry price is the TRUE fill
  price (quote lamports spent / tokens received). Positions on completed
  curves are left to the harness. Prices are compared as exact bigint
  rationals (quote reserves over token reserves).
- Fills are processed before new decisions each batch. A rejected/failed buy
  frees the mint for a later retry while still fresh. A filled sell deletes
  the position once zero tokens remain. Stale open records for mints no
  longer held are dropped.
- Deterministic given the replay: no clock, no randomness, no network, no
  file reads. All state lives in the bot closure.

## Dev validation (grade-local, full 24h dev window)

Net PnL −0.0926 SOL, Sharpe −0.459, Sortino −0.432, return −0.93%, max
drawdown 1.07%, win rate 27.9%, 104 round trips, 203 fills, 104 distinct
mints, fees 0.0251 SOL, compliant: true. Comparison on the same window:
dip-grind Sharpe −0.190 / PnL −0.117 / 27 mints (fails the 6h minimum);
spray with a 30-min timeout Sharpe −1.019 / PnL −0.238 / 215 mints.
Spray-early is the best COMPLIANT choice.

The dev numbers are NEGATIVE — this is an honest, near-breakeven,
low-drawdown entry, not a proven winner. Its case rests on: (a) it clears
every guardrail with margin, (b) the 6h final window is fresh data where a
few caught pumps flip it positive, (c) most competing entries are likely
also dev-negative. It does NOT claim to be positive on dev.
