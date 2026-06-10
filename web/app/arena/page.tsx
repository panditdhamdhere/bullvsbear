"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CoinInfo,
  MarketSnapshot,
  createDebate,
  fetchCoins,
  fetchMarket,
  fmtPrice,
} from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [coins, setCoins] = useState<CoinInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [rounds, setRounds] = useState(3);
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCoins()
      .then(setCoins)
      .catch(() => setError("Backend unreachable. Is the Rust server running on :8080?"));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setMarket(null);
    fetchMarket(selected).then(setMarket).catch(() => {});
  }, [selected]);

  const selectedCoin = useMemo(
    () => coins.find((c) => c.id === selected) ?? null,
    [coins, selected],
  );

  async function start() {
    if (!selected || starting) return;
    setStarting(true);
    try {
      const { id } = await createDebate(selected, rounds);
      router.push(`/debate/${id}`);
    } catch {
      setError("Failed to start debate.");
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="pt-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">The Arena</h1>
        <p className="mx-auto mt-4 max-w-xl text-foreground/60">
          Choose a coin, set the rounds, and let{" "}
          <span className="font-semibold text-bull">Max Moon</span> and{" "}
          <span className="font-semibold text-bear">Dr. Doom</span> settle it live.
        </p>
      </section>

      {error && (
        <div className="rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">
          {error}
        </div>
      )}

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-foreground/50">
          1 · Pick your battleground
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {coins.map((coin) => (
            <button
              key={coin.id}
              onClick={() => setSelected(coin.id)}
              className={`rounded-xl border px-4 py-4 text-left transition ${
                selected === coin.id
                  ? "border-accent bg-accent/10 shadow-[0_0_20px_rgba(245,181,10,0.15)]"
                  : "border-panel-border bg-panel hover:border-foreground/30"
              }`}
            >
              <div className="font-semibold">{coin.symbol}</div>
              <div className="text-xs text-foreground/50">{coin.name}</div>
            </button>
          ))}
          {coins.length === 0 && !error && (
            <div className="col-span-full py-8 text-center text-sm text-foreground/40">
              Loading coins…
            </div>
          )}
        </div>
      </section>

      {selectedCoin && (
        <section className="rounded-2xl border border-panel-border bg-panel p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-foreground/50">
            2 · Live market context
          </h2>
          {market ? (
            <div className="flex flex-wrap items-center gap-x-10 gap-y-3">
              <div>
                <div className="text-xs text-foreground/50">{market.name} price</div>
                <div className="text-2xl font-bold">{fmtPrice(market.price)}</div>
              </div>
              <div>
                <div className="text-xs text-foreground/50">24h</div>
                <div
                  className={`text-lg font-semibold ${
                    market.change_24h_pct >= 0 ? "text-bull" : "text-bear"
                  }`}
                >
                  {market.change_24h_pct >= 0 ? "+" : ""}
                  {market.change_24h_pct.toFixed(2)}%
                </div>
              </div>
              <div>
                <div className="text-xs text-foreground/50">7d</div>
                <div
                  className={`text-lg font-semibold ${
                    market.change_7d_pct >= 0 ? "text-bull" : "text-bear"
                  }`}
                >
                  {market.change_7d_pct >= 0 ? "+" : ""}
                  {market.change_7d_pct.toFixed(2)}%
                </div>
              </div>
              <div>
                <div className="text-xs text-foreground/50">From ATH</div>
                <div className="text-lg font-semibold text-foreground/80">
                  {market.ath_change_pct.toFixed(1)}%
                </div>
              </div>
              {!market.live && (
                <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent">
                  simulated data — CoinGecko unreachable
                </span>
              )}
            </div>
          ) : (
            <div className="text-sm text-foreground/40">Fetching live data…</div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-foreground/50">
          3 · Set the stakes
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((r) => (
              <button
                key={r}
                onClick={() => setRounds(r)}
                className={`h-10 w-10 rounded-lg border text-sm font-semibold transition ${
                  rounds === r
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-panel-border bg-panel text-foreground/60 hover:border-foreground/30"
                }`}
              >
                {r}
              </button>
            ))}
            <span className="ml-1 text-sm text-foreground/50">rounds</span>
          </div>
          <button
            onClick={start}
            disabled={!selected || starting}
            className="rounded-xl bg-gradient-to-r from-bull to-bear px-8 py-3 font-bold text-white shadow-lg transition enabled:hover:scale-[1.02] enabled:hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? "Summoning the fighters…" : "Start the debate"}
          </button>
        </div>
      </section>
    </div>
  );
}
