"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Leaderboard,
  MarketSnapshot,
  fetchLeaderboard,
  fetchMarkets,
  fmtPrice,
} from "@/lib/api";

export default function Landing() {
  const [markets, setMarkets] = useState<MarketSnapshot[]>([]);
  const [board, setBoard] = useState<Leaderboard | null>(null);

  useEffect(() => {
    const load = () => {
      fetchMarkets().then(setMarkets).catch(() => {});
      fetchLeaderboard().then(setBoard).catch(() => {});
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col gap-24 pb-12">
      <Hero />
      <Ticker markets={markets} />
      <Personas />
      <HowItWorks />
      <Features />
      {board && board.total_debates > 0 && <LiveStats board={board} />}
      <FinalCta />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative pt-16 text-center sm:pt-24">
      <div className="glow-orb absolute -top-20 left-[10%] h-72 w-72 rounded-full bg-bull/30" />
      <div
        className="glow-orb absolute -top-10 right-[10%] h-72 w-72 rounded-full bg-bear/30"
        style={{ animationDelay: "3s" }}
      />

      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-full border border-panel-border bg-panel px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-foreground/60">
          <span className="h-2 w-2 animate-pulse rounded-full bg-bull" />
          Live AI debates · Real market data
        </span>

        <h1 className="mt-8 text-6xl font-black leading-none tracking-tighter sm:text-8xl">
          <span className="text-bull drop-shadow-[0_0_30px_rgba(34,197,94,0.35)]">BULL</span>
          <span className="hero-gradient-text mx-3 align-middle text-4xl font-black sm:mx-5 sm:text-6xl">
            vs
          </span>
          <span className="text-bear drop-shadow-[0_0_30px_rgba(239,68,68,0.35)]">BEAR</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-foreground/60 sm:text-xl">
          Two AI personas tear into any crypto asset in real time — armed with
          live prices, streamed word-by-word. You vote. The crowd crowns the
          winner.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/arena"
            className="rounded-xl bg-gradient-to-r from-bull to-bear px-8 py-4 text-lg font-bold text-white shadow-[0_8px_40px_rgba(245,181,10,0.25)] transition hover:scale-[1.03] hover:shadow-[0_8px_50px_rgba(245,181,10,0.4)]"
          >
            Enter the Arena
          </Link>
          <Link
            href="/leaderboard"
            className="rounded-xl border border-panel-border bg-panel px-8 py-4 text-lg font-semibold text-foreground/80 transition hover:border-foreground/30 hover:text-foreground"
          >
            View Leaderboard
          </Link>
        </div>
      </div>
    </section>
  );
}

function Ticker({ markets }: { markets: MarketSnapshot[] }) {
  if (markets.length === 0) return null;
  const items = [...markets, ...markets]; // duplicated for a seamless loop
  return (
    <section className="relative -mx-4 overflow-hidden border-y border-panel-border bg-panel/60 py-3">
      <div className="marquee-track">
        {items.map((m, i) => (
          <div key={`${m.coin_id}-${i}`} className="flex items-center gap-2 px-6">
            <span className="font-bold">{m.symbol}</span>
            <span className="font-mono text-sm text-foreground/80">{fmtPrice(m.price)}</span>
            <span
              className={`text-xs font-semibold ${
                m.change_24h_pct >= 0 ? "text-bull" : "text-bear"
              }`}
            >
              {m.change_24h_pct >= 0 ? "▲" : "▼"} {Math.abs(m.change_24h_pct).toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-background to-transparent" />
    </section>
  );
}

function Personas() {
  return (
    <section className="relative">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="float-slow rounded-3xl border border-bull/30 bg-gradient-to-br from-bull/10 to-transparent p-8">
          <div className="text-5xl">🐂</div>
          <h3 className="mt-4 text-2xl font-bold text-bull">Max Moon</h3>
          <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-foreground/40">
            The Eternal Optimist
          </p>
          <p className="mt-4 leading-relaxed text-foreground/70">
            &ldquo;Down 8% today? That&apos;s not a dip, that&apos;s a discount.
            Volume is conviction, fear is opportunity, and every chart
            eventually points at the moon.&rdquo;
          </p>
        </div>
        <div className="float-slower rounded-3xl border border-bear/30 bg-gradient-to-br from-bear/10 to-transparent p-8 sm:text-right">
          <div className="text-5xl">🐻</div>
          <h3 className="mt-4 text-2xl font-bold text-bear">Dr. Doom</h3>
          <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-foreground/40">
            The Professional Skeptic
          </p>
          <p className="mt-4 leading-relaxed text-foreground/70">
            &ldquo;Hope is not a risk model. That &lsquo;discount&rsquo; is
            price discovery, that volume is exit liquidity, and gravity remains
            undefeated.&rdquo;
          </p>
        </div>
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 sm:block">
        <span className="hero-gradient-text text-5xl font-black">VS</span>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Pick a coin",
    text: "BTC, ETH, SOL, DOGE… choose the battleground and set the number of rounds.",
  },
  {
    n: "02",
    title: "Watch them fight",
    text: "Both AIs pull live price action into their arguments and rebut each other point by point, streamed word-by-word.",
  },
  {
    n: "03",
    title: "Crown the winner",
    text: "Vote on every argument. The sentiment meter shifts live and the crowd declares the victor.",
  },
];

function HowItWorks() {
  return (
    <section>
      <h2 className="text-center text-3xl font-bold tracking-tight">How it works</h2>
      <div className="mt-10 grid gap-6 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div
            key={s.n}
            className="rounded-2xl border border-panel-border bg-panel p-6 transition hover:border-foreground/25 hover:bg-panel/80"
          >
            <span className="hero-gradient-text text-4xl font-black">{s.n}</span>
            <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-foreground/60">{s.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: "⚡",
    title: "Streamed live",
    text: "Every argument arrives word-by-word over a live connection. Every viewer watches the same debate unfold together.",
  },
  {
    icon: "📈",
    title: "Market-aware AI",
    text: "Personas see real-time price, 24h change, volume and ATH distance — and weaponize the numbers mid-debate.",
  },
  {
    icon: "🗳️",
    title: "Crowd-judged",
    text: "Thumbs up or down on every argument. Sentiment shifts in real time and the community calls the winner.",
  },
  {
    icon: "🏆",
    title: "Leaderboard",
    text: "Which coins draw the biggest crowds? Does the Bull or the Bear win more? Every debate counts.",
  },
];

function Features() {
  return (
    <section>
      <h2 className="text-center text-3xl font-bold tracking-tight">Built for the show</h2>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="rounded-2xl border border-panel-border bg-panel p-6 transition hover:-translate-y-1 hover:border-foreground/25"
          >
            <div className="text-3xl">{f.icon}</div>
            <h3 className="mt-3 font-bold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-foreground/60">{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function LiveStats({ board }: { board: Leaderboard }) {
  const votes = board.coins.reduce((sum, c) => sum + c.total_votes, 0);
  const stats = [
    { label: "Debates fought", value: board.total_debates, cls: "" },
    { label: "Bull victories", value: board.bull_wins, cls: "text-bull" },
    { label: "Bear victories", value: board.bear_wins, cls: "text-bear" },
    { label: "Votes cast", value: votes, cls: "text-accent" },
  ];
  return (
    <section className="rounded-3xl border border-panel-border bg-panel p-8">
      <div className="grid grid-cols-2 gap-8 text-center sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <div className={`text-4xl font-black ${s.cls}`}>{s.value}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-foreground/40">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-panel-border bg-panel px-8 py-16 text-center">
      <div className="glow-orb absolute -left-10 top-0 h-60 w-60 rounded-full bg-bull/25" />
      <div
        className="glow-orb absolute -right-10 bottom-0 h-60 w-60 rounded-full bg-bear/25"
        style={{ animationDelay: "2s" }}
      />
      <div className="relative">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          The market never sleeps. Neither do they.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-foreground/60">
          Start a debate on your favorite coin and watch the sparks fly.
        </p>
        <Link
          href="/arena"
          className="mt-8 inline-block rounded-xl bg-gradient-to-r from-bull to-bear px-10 py-4 text-lg font-bold text-white shadow-lg transition hover:scale-[1.03]"
        >
          Start a debate
        </Link>
      </div>
    </section>
  );
}
