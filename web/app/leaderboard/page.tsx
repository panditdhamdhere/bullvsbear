"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Leaderboard, fetchLeaderboard } from "@/lib/api";

export default function LeaderboardPage() {
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchLeaderboard().then(setBoard).catch(() => setError(true));
    const t = setInterval(() => {
      fetchLeaderboard().then(setBoard).catch(() => {});
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  if (error) {
    return (
      <div className="py-24 text-center text-foreground/50">
        Backend unreachable. Is the Rust server running on :8080?
      </div>
    );
  }
  if (!board) {
    return <div className="py-24 text-center text-foreground/50">Loading…</div>;
  }

  const decided = board.bull_wins + board.bear_wins;
  const bullRate = decided > 0 ? (board.bull_wins / decided) * 100 : 50;

  return (
    <div className="flex flex-col gap-10">
      <section className="pt-4 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
        <p className="mt-2 text-foreground/60">
          Who&apos;s winning the eternal war — and which coins draw the biggest crowds.
        </p>
      </section>

      {/* Bull vs Bear all-time */}
      <section className="rounded-2xl border border-panel-border bg-panel p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-foreground/50">
          All-time war
        </h2>
        <div className="mb-4 grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
          <BigStat label="Debates" value={board.total_debates} />
          <BigStat label="Bull wins" value={board.bull_wins} cls="text-bull" />
          <BigStat label="Bear wins" value={board.bear_wins} cls="text-bear" />
          <BigStat label="Draws" value={board.draws} cls="text-accent" />
        </div>
        <div className="relative h-4 overflow-hidden rounded-full bg-foreground/10">
          <div
            className="absolute inset-y-0 left-0 bg-bull transition-all duration-700"
            style={{ width: `${bullRate}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-bear transition-all duration-700"
            style={{ width: `${100 - bullRate}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs font-semibold">
          <span className="text-bull">🐂 {bullRate.toFixed(0)}% win rate</span>
          <span className="text-bear">{(100 - bullRate).toFixed(0)}% win rate 🐻</span>
        </div>
      </section>

      {/* Coin engagement */}
      <section className="rounded-2xl border border-panel-border bg-panel p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-foreground/50">
          Hottest battlegrounds
        </h2>
        {board.coins.length === 0 ? (
          <Empty />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-foreground/40">
                <th className="pb-3">#</th>
                <th className="pb-3">Coin</th>
                <th className="pb-3 text-right">Debates</th>
                <th className="pb-3 text-right">Total votes</th>
                <th className="pb-3 text-right">Bull / Bear wins</th>
              </tr>
            </thead>
            <tbody>
              {board.coins.map((c, i) => (
                <tr key={c.coin_id} className="border-t border-panel-border">
                  <td className="py-3 text-foreground/40">{i + 1}</td>
                  <td className="py-3">
                    <span className="font-bold">{c.symbol}</span>{" "}
                    <span className="text-foreground/50">{c.name}</span>
                  </td>
                  <td className="py-3 text-right font-mono">{c.debates}</td>
                  <td className="py-3 text-right font-mono">{c.total_votes}</td>
                  <td className="py-3 text-right font-mono">
                    <span className="text-bull">{c.bull_wins}</span>
                    <span className="text-foreground/40"> / </span>
                    <span className="text-bear">{c.bear_wins}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Top predictors */}
      <section className="rounded-2xl border border-panel-border bg-panel p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-foreground/50">
          Top predictors
        </h2>
        {board.predictors.length === 0 ? (
          <div className="py-8 text-center text-sm text-foreground/40">
            No predictions settled yet — stake points on a live debate to get on the board.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-foreground/40">
                <th className="pb-3">#</th>
                <th className="pb-3">Predictor</th>
                <th className="pb-3 text-right">Points</th>
                <th className="pb-3 text-right">Correct</th>
                <th className="pb-3 text-right">Hit rate</th>
              </tr>
            </thead>
            <tbody>
              {board.predictors.map((u, i) => (
                <tr key={u.id} className="border-t border-panel-border">
                  <td className="py-3 text-foreground/40">{i + 1}</td>
                  <td className="py-3 font-semibold">
                    {i === 0 ? "👑 " : ""}
                    {u.name}
                  </td>
                  <td className="py-3 text-right font-mono text-accent">
                    ◆ {u.points.toLocaleString()}
                  </td>
                  <td className="py-3 text-right font-mono">
                    {u.correct}/{u.predictions}
                  </td>
                  <td className="py-3 text-right font-mono">
                    {((u.correct / u.predictions) * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Recent debates */}
      <section className="rounded-2xl border border-panel-border bg-panel p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-foreground/50">
          Recent debates
        </h2>
        {board.recent.length === 0 ? (
          <Empty />
        ) : (
          <div className="flex flex-col divide-y divide-panel-border">
            {board.recent.map((d) => (
              <Link
                key={d.id}
                href={`/debate/${d.id}`}
                className="flex items-center justify-between py-3 transition hover:bg-foreground/5"
              >
                <div>
                  <span className="font-bold">{d.coin_symbol}</span>{" "}
                  <span className="text-foreground/50">{d.coin_name}</span>
                  <span className="ml-3 text-xs text-foreground/40">
                    {new Date(d.created_at * 1000).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-mono text-foreground/50">{d.total_votes} votes</span>
                  {d.finished ? (
                    <WinnerPill winner={d.winner} />
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-bear">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bear" /> LIVE
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function BigStat({ label, value, cls = "" }: { label: string; value: number; cls?: string }) {
  return (
    <div>
      <div className={`text-3xl font-bold ${cls}`}>{value}</div>
      <div className="text-xs uppercase tracking-wider text-foreground/40">{label}</div>
    </div>
  );
}

function WinnerPill({ winner }: { winner: string | null }) {
  if (winner === "bull")
    return <span className="rounded-full bg-bull/15 px-3 py-1 text-xs font-bold text-bull">🐂 Bull won</span>;
  if (winner === "bear")
    return <span className="rounded-full bg-bear/15 px-3 py-1 text-xs font-bold text-bear">🐻 Bear won</span>;
  return <span className="rounded-full bg-accent/15 px-3 py-1 text-xs font-bold text-accent">Draw</span>;
}

function Empty() {
  return (
    <div className="py-8 text-center text-sm text-foreground/40">
      No debates yet —{" "}
      <Link href="/arena" className="text-accent underline-offset-2 hover:underline">
        start the first one
      </Link>
      .
    </div>
  );
}
