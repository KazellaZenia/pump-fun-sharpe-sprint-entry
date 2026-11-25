// Spray-Early — Pump.fun Sharpe Sprint entry.
//
// Idea: buy every new coin the moment the 1%-of-real-reserves size cap first
// allows the 0.01 SOL stake, then exit on take-profit +30%, stop-loss -40%,
// or a 2-hour timeout. Hold at most 5 positions; recycle a freed slot into
// the next fresh coin immediately.
//
// Why this shape: on the dev window the whole initial pump of a new coin
// happens inside its creation slot, so batch-end entries can never catch it;
// every directional rule tested loses after fees. Spray-early is the only
// family tested that clears the 20-distinct-mint minimum inside a 6-hour
// window (about 26 projected mints) while keeping drawdown tiny (about
// 1%): its per-trade profile is lottery-shaped (roughly 28% wins, average
// win about +32% of stake, average loss about -15%), so in a fresh window
// a couple of caught pumps flip it net-positive with a high hourly Sharpe
// (mostly-flat hours plus a few big positive hours).
//
// The bot is deterministic given the replay: no clock, no randomness, no
// network, no file reads. All state lives in the closure below. Prices are
// compared as exact bigint rationals (quote reserves over token reserves),
// never as floats.

import type { Batch, BotState, Fill, OrderInput } from "./vendor/makefun-bot.ts";

// --- Parameters (exact, from the spec) -------------------------------------

/** Minimum round trip and smallest fee share: 0.01 SOL, in lamports. */
const STAKE_LAMPORTS = 10_000_000n;
/** Take-profit: sell when price >= entry * 13/10 (+30%). */
const TAKE_PROFIT_NUM = 13n;
const TAKE_PROFIT_DEN = 10n;
/** Stop-loss: sell when price <= entry * 6/10 (-40%). */
const STOP_LOSS_NUM = 6n;
const STOP_LOSS_DEN = 10n;
/** Position timeout: 2 hours, in slots. */
const TIMEOUT_SLOTS = 33_600;
/** Freshness window: buy only while current slot - first-cap slot <= 1000. */
const FRESH_SLOTS = 1_000;
/** Max slippage both sides: 10%. */
const SLIPPAGE_BPS = 1_000;
/** Harness cap: never hold more than 5 positions. */
const MAX_POSITIONS = 5;
/** Harness cap: never place more than 16 orders in one batch. */
const MAX_ORDERS_PER_BATCH = 16;

// --- State ------------------------------------------------------------------

interface OpenPosition {
  /** Actual quote lamports spent on the fill (fees included). */
  entryQuote: bigint;
  /** Actual token amount received on the fill. */
  entryTokens: bigint;
  /** Slot the buy filled at. */
  entrySlot: number;
  /** Highest curve price seen since entry, as quote/token reserves. */
  peakQuote: bigint;
  peakTokens: bigint;
}

interface PendingInfo {
  side: "buy" | "sell";
  mint: string;
  /** Curve price (quote/token reserves) at decision time, diagnostics only. */
  decisionQuote: bigint;
  decisionTokens: bigint;
}

export interface SprayEarlyStats {
  buysPlaced: number;
  sellsPlaced: number;
  buysFilled: number;
  sellsFilled: number;
  buysRejected: number;
  roundTrips: number;
}

export function createSprayEarlyBot(): {
  onBatch(state: BotState, batch: Batch): OrderInput[];
  onDone(state: BotState): void;
  stats: SprayEarlyStats;
} {
  /** Mints bought once, ever (one round trip per mint). */
  const boughtOnce = new Set<string>();
  /** First slot where the size cap first allowed the stake, per mint. */
  const firstCapSlot = new Map<string, number>();
  /** Open positions, by mint. */
  const open = new Map<string, OpenPosition>();
  /** Orders sent and not yet resolved, by client_id. */
  const pending = new Map<string, PendingInfo>();
  /** Mints with a buy currently in flight. */
  const pendingBuys = new Set<string>();
  /** Mints with a sell currently in flight. */
  const pendingSells = new Set<string>();
  let orderCounter = 0;

  const stats: SprayEarlyStats = {
    buysPlaced: 0,
    sellsPlaced: 0,
    buysFilled: 0,
    sellsFilled: 0,
    buysRejected: 0,
    roundTrips: 0,
  };

  // Price comparisons on exact rationals. A price is quote/token reserves.
  // current >= entry * num/den  <=>  den * curQ * entryT >= num * entryQ * curT
  function priceAtLeast(
    curQ: bigint,
    curT: bigint,
    refQ: bigint,
    refT: bigint,
    num: bigint,
    den: bigint,
  ): boolean {
    return den * curQ * refT >= num * refQ * curT;
  }
  function priceAtMost(
    curQ: bigint,
    curT: bigint,
    refQ: bigint,
    refT: bigint,
    num: bigint,
    den: bigint,
  ): boolean {
    return den * curQ * refT <= num * refQ * curT;
  }

  function processFills(state: BotState, batch: Batch): void {
    for (const fill of batch.fills) {
      const info = pending.get(fill.client_id);
      if (fill.side === "buy") {
        pendingBuys.delete(fill.mint);
        if (info !== undefined) pending.delete(fill.client_id);
        if (fill.status === "filled") {
          // Entry price is the TRUE fill price: quote spent over tokens got.
          const tokens = BigInt(fill.token_amount);
          if (tokens > 0n) {
            const quote = BigInt(fill.quote_lamports);
            open.set(fill.mint, {
              entryQuote: quote,
              entryTokens: tokens,
              entrySlot: fill.slot,
              peakQuote: quote,
              peakTokens: tokens,
            });
            stats.buysFilled++;
          }
        } else {
          // Rejected or failed: let a later batch retry it while still fresh.
          boughtOnce.delete(fill.mint);
          stats.buysRejected++;
        }
      } else {
        // Sell fill, including the harness's own closes (_complete_/_flatten_).
        pendingSells.delete(fill.mint);
        if (info !== undefined) pending.delete(fill.client_id);
        if (fill.status === "filled") {
          stats.sellsFilled++;
          if (!state.positions.has(fill.mint)) {
            open.delete(fill.mint);
            stats.roundTrips++;
          }
        }
      }
    }
    // Stale-state cleanup: drop open records for mints no longer held with
    // no buy pending (e.g. closed by the harness on graduation).
    for (const mint of [...open.keys()]) {
      if (!state.positions.has(mint) && !pendingBuys.has(mint)) {
        open.delete(mint);
      }
    }
  }

  function decideExits(state: BotState, orders: OrderInput[]): void {
    for (const [mint, pos] of open) {
      if (orders.length >= MAX_ORDERS_PER_BATCH) break;
      if (pendingSells.has(mint)) continue;
      const holding = state.positions.get(mint);
      if (holding === undefined || holding.token_amount <= 0n) continue;
      const curve = state.curves.get(mint);
      // Never trade a completed curve; the harness closes/flattens it.
      if (curve === undefined || curve.complete) continue;
      const q = curve.virtual_quote_reserves;
      const t = curve.virtual_token_reserves;
      if (t <= 0n) continue;
      // Track the peak (diagnostics; no trailing stop in this strategy).
      if (q * pos.peakTokens > pos.peakQuote * t) {
        pos.peakQuote = q;
        pos.peakTokens = t;
      }
      const takeProfit = priceAtLeast(
        q, t, pos.entryQuote, pos.entryTokens, TAKE_PROFIT_NUM, TAKE_PROFIT_DEN,
      );
      const stopLoss = priceAtMost(
        q, t, pos.entryQuote, pos.entryTokens, STOP_LOSS_NUM, STOP_LOSS_DEN,
      );
      const timedOut = state.slot - pos.entrySlot >= TIMEOUT_SLOTS;
      if (!takeProfit && !stopLoss && !timedOut) continue;
      orderCounter++;
      const clientId = `s${orderCounter}`;
      pending.set(clientId, {
        side: "sell",
        mint,
        decisionQuote: q,
        decisionTokens: t,
      });
      pendingSells.add(mint);
      orders.push({
        side: "sell",
        client_id: clientId,
        mint,
        token_amount: holding.token_amount,
        max_slippage_bps: SLIPPAGE_BPS,
      });
      stats.sellsPlaced++;
    }
  }

  function decideEntries(state: BotState, batch: Batch, orders: OrderInput[]): void {
    // Only mints with a TradeEvent in THIS batch: the size cap can only
    // cross on a trade.
    const traded = new Set<string>();
    for (const event of batch.events) {
      if (event.event === "TradeEvent") traded.add(event.mint);
    }
    for (const mint of traded) {
      if (orders.length >= MAX_ORDERS_PER_BATCH) break;
      if (boughtOnce.has(mint) || open.has(mint) || pendingBuys.has(mint)) {
        continue;
      }
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      // First batch where the cap allows the stake is the first-cap moment.
      if (state.maxBuyLamports(mint) < STAKE_LAMPORTS) continue;
      const firstCap = firstCapSlot.get(mint);
      if (firstCap === undefined) {
        firstCapSlot.set(mint, state.slot);
      } else if (state.slot - firstCap > FRESH_SLOTS) {
        // Stale: its pump already happened; skip forever.
        continue;
      }
      // No slot can free inside this batch (the count only grows as we
      // place buys), so once full, no later mint can be bought either.
      if (state.committedPositionCount() >= MAX_POSITIONS) break;
      // Free cash likewise only shrinks inside a batch as buys are placed.
      if (state.freeCashLamports() < STAKE_LAMPORTS + state.txFeeLamports()) {
        break;
      }
      orderCounter++;
      const clientId = `b${orderCounter}`;
      pending.set(clientId, {
        side: "buy",
        mint,
        decisionQuote: curve.virtual_quote_reserves,
        decisionTokens: curve.virtual_token_reserves,
      });
      pendingBuys.add(mint);
      boughtOnce.add(mint);
      orders.push({
        side: "buy",
        client_id: clientId,
        mint,
        quote_lamports: STAKE_LAMPORTS,
        max_slippage_bps: SLIPPAGE_BPS,
      });
      stats.buysPlaced++;
    }
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      // Fills first, before any new decision.
      processFills(state, batch);
      const orders: OrderInput[] = [];
      decideExits(state, orders);
      decideEntries(state, batch, orders);
      return orders;
    },

    onDone(state: BotState): void {
      console.error(
        `[spray-early] done: buys placed ${stats.buysPlaced} filled ${stats.buysFilled} ` +
          `rejected ${stats.buysRejected}, sells placed ${stats.sellsPlaced} filled ` +
          `${stats.sellsFilled}, round trips ${stats.roundTrips}, ` +
          `open at end ${open.size}, cash ${state.cash} lamports`,
      );
    },

    stats,
  };
}
