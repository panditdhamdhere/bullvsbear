"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  API_BASE,
  Argument,
  DebateEvent,
  DebateState,
  Side,
  Stake,
  fetchMyStake,
  fmtBig,
  fmtPrice,
  placeStake,
  sendVote,
} from "@/lib/api";
import { notifyPointsChanged, useUser } from "@/lib/user";

export default function DebatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [debate, setDebate] = useState<DebateState | null>(null);
  const [connError, setConnError] = useState(false);
  const tokensSeen = useRef<Map<string, number>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/debates/${id}/stream`);

    es.onmessage = (msg) => {
      const ev: DebateEvent = JSON.parse(msg.data);
      setConnError(false);

      if (ev.type === "snapshot") {
        for (const a of ev.state.arguments) {
          tokensSeen.current.set(a.id, a.token_count);
        }
        setDebate(ev.state);
        return;
      }

      setDebate((prev) => {
        if (!prev) return prev;
        switch (ev.type) {
          case "argument_start": {
            if (prev.arguments.some((a) => a.id === ev.argument.id)) return prev;
            const arg: Argument = {
              ...ev.argument,
              text: "",
              token_count: 0,
              up: 0,
              down: 0,
              done: false,
            };
            return { ...prev, arguments: [...prev.arguments, arg] };
          }
          case "token": {
            const seen = tokensSeen.current.get(ev.argument_id) ?? 0;
            if (ev.idx < seen) return prev; // already included in snapshot
            tokensSeen.current.set(ev.argument_id, ev.idx + 1);
            return {
              ...prev,
              arguments: prev.arguments.map((a) =>
                a.id === ev.argument_id ? { ...a, text: a.text + ev.text } : a,
              ),
            };
          }
          case "argument_end":
            return {
              ...prev,
              arguments: prev.arguments.map((a) =>
                a.id === ev.argument_id ? { ...a, done: true } : a,
              ),
            };
          case "votes":
            return {
              ...prev,
              sentiment: ev.sentiment,
              winner: ev.winner ?? prev.winner,
              arguments: prev.arguments.map((a) =>
                a.id === ev.argument_id ? { ...a, up: ev.up, down: ev.down } : a,
              ),
            };
          case "status":
            return {
              ...prev,
              status: ev.status,
              voting_ends_at: ev.voting_ends_at,
              sentiment: ev.sentiment,
            };
          case "stake":
            return { ...prev, pools: ev.pools };
          case "settled":
            return {
              ...prev,
              status: "finished",
              winner: ev.winner,
              sentiment: ev.sentiment,
              pools: ev.pools,
            };
          default:
            return prev;
        }
      });
    };

    es.onerror = () => setConnError(true);
    return () => es.close();
  }, [id]);

  useEffect(() => {
    if (debate?.status === "live") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [debate?.arguments]);

  const vote = useCallback(
    (argumentId: string, dir: "up" | "down") => {
      sendVote(id, argumentId, dir);
    },
    [id],
  );

  if (!debate) {
    return (
      <div className="py-24 text-center text-foreground/50">
        {connError ? "Debate not found or backend offline." : "Entering the arena…"}
      </div>
    );
  }

  const m = debate.market;
  const rounds = groupByRound(debate.arguments);

  return (
    <div className="flex flex-col gap-6">
      {/* Market ticker */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-panel-border bg-panel px-5 py-4">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-bold">{debate.coin_name}</span>
          <span className="font-mono text-xl font-bold">{fmtPrice(m.price)}</span>
          <span
            className={`font-semibold ${m.change_24h_pct >= 0 ? "text-bull" : "text-bear"}`}
          >
            {m.change_24h_pct >= 0 ? "▲" : "▼"} {Math.abs(m.change_24h_pct).toFixed(2)}%
          </span>
        </div>
        <Stat label="Vol 24h" value={fmtBig(m.volume_24h)} />
        <Stat label="Mcap" value={fmtBig(m.market_cap)} />
        <Stat label="From ATH" value={`${m.ath_change_pct.toFixed(1)}%`} />
        <div className="ml-auto flex items-center gap-2 text-xs">
          {debate.status === "live" ? (
            <span className="flex items-center gap-1.5 rounded-full bg-bear/15 px-3 py-1 font-semibold text-bear">
              <span className="h-2 w-2 animate-pulse rounded-full bg-bear" /> LIVE
            </span>
          ) : debate.status === "voting" ? (
            <span className="flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 font-semibold text-accent">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> VOTING OPEN
            </span>
          ) : (
            <span className="rounded-full bg-foreground/10 px-3 py-1 font-semibold text-foreground/60">
              FINISHED
            </span>
          )}
          {!debate.llm_powered && (
            <span
              className="rounded-full bg-foreground/10 px-3 py-1 text-foreground/50"
              title="Set OPENAI_API_KEY on the server for LLM-generated debates"
            >
              persona engine
            </span>
          )}
        </div>
      </div>

      {/* Sentiment meter */}
      <SentimentMeter debate={debate} />

      {/* Voting window countdown */}
      {debate.status === "voting" && (
        <VotingCountdown endsAt={debate.voting_ends_at} />
      )}

      {/* Winner banner */}
      {debate.status === "finished" && <WinnerBanner debate={debate} />}

      {/* Prediction market */}
      <StakePanel debate={debate} />

      {/* Fighters */}
      <div className="grid grid-cols-2 gap-4 text-center text-sm">
        <div className="rounded-xl border border-bull/30 bg-bull/5 py-3">
          <span className="text-xl">🐂</span>
          <div className="font-bold text-bull">Max Moon</div>
          <div className="text-xs text-foreground/50">Eternal optimist · &quot;It&apos;s going up&quot;</div>
        </div>
        <div className="rounded-xl border border-bear/30 bg-bear/5 py-3">
          <span className="text-xl">🐻</span>
          <div className="font-bold text-bear">Dr. Doom</div>
          <div className="text-xs text-foreground/50">Professional skeptic · &quot;It&apos;s going down&quot;</div>
        </div>
      </div>

      {/* Debate feed */}
      <div className="flex flex-col gap-8">
        {rounds.map(([round, args]) => (
          <section key={round}>
            <div className="mb-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-panel-border" />
              <span className="text-xs font-semibold uppercase tracking-widest text-foreground/40">
                Round {round} of {debate.rounds_total}
              </span>
              <div className="h-px flex-1 bg-panel-border" />
            </div>
            <div className="flex flex-col gap-4">
              {args.map((a) => (
                <ArgumentCard
                  key={a.id}
                  arg={a}
                  onVote={vote}
                  votingOpen={debate.status !== "finished"}
                />
              ))}
            </div>
          </section>
        ))}
        {debate.arguments.length === 0 && (
          <div className="py-12 text-center text-foreground/40">
            The fighters are reviewing the charts…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {debate.status === "finished" && (
        <div className="flex justify-center gap-4 pb-8">
          <Link
            href="/arena"
            className="rounded-xl border border-panel-border bg-panel px-6 py-3 font-semibold transition hover:border-foreground/30"
          >
            New debate
          </Link>
          <Link
            href="/leaderboard"
            className="rounded-xl border border-panel-border bg-panel px-6 py-3 font-semibold transition hover:border-foreground/30"
          >
            Leaderboard
          </Link>
        </div>
      )}
    </div>
  );
}

function groupByRound(args: Argument[]): [number, Argument[]][] {
  const map = new Map<number, Argument[]>();
  for (const a of args) {
    const list = map.get(a.round) ?? [];
    list.push(a);
    map.set(a.round, list);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <span className="mr-1.5 text-xs text-foreground/40">{label}</span>
      <span className="font-mono font-semibold text-foreground/80">{value}</span>
    </div>
  );
}

function SentimentMeter({ debate }: { debate: DebateState }) {
  const { bull, bear, total_votes } = debate.sentiment;
  return (
    <div className="rounded-2xl border border-panel-border bg-panel px-5 py-4">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-widest text-foreground/40">
        <span>Crowd sentiment</span>
        <span>{total_votes} votes</span>
      </div>
      <div className="relative h-5 overflow-hidden rounded-full bg-foreground/10">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-bull/80 to-bull transition-all duration-700"
          style={{ width: `${bull}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-gradient-to-l from-bear/80 to-bear transition-all duration-700"
          style={{ width: `${bear}%` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-background transition-all duration-700"
          style={{ left: `${bull}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-sm font-bold">
        <span className="text-bull">🐂 {bull.toFixed(0)}%</span>
        <span className="text-bear">{bear.toFixed(0)}% 🐻</span>
      </div>
    </div>
  );
}

function WinnerBanner({ debate }: { debate: DebateState }) {
  const w = debate.winner;
  const cfg =
    w === "bull"
      ? { text: "🐂 The crowd sides with the Bull — Max Moon takes it!", cls: "border-bull/40 bg-bull/10 text-bull" }
      : w === "bear"
        ? { text: "🐻 The crowd sides with the Bear — Dr. Doom takes it!", cls: "border-bear/40 bg-bear/10 text-bear" }
        : { text: "🤝 Dead even — the crowd calls it a draw.", cls: "border-accent/40 bg-accent/10 text-accent" };
  return (
    <div className={`rounded-2xl border px-5 py-4 text-center text-lg font-bold ${cfg.cls}`}>
      {cfg.text}
      <div className="mt-1 text-xs font-normal text-foreground/50">
        Verdict locked by the crowd vote. Stakes have been settled.
      </div>
    </div>
  );
}

function VotingCountdown({ endsAt }: { endsAt: number | null }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = Math.max(0, (endsAt ?? 0) - now);
  return (
    <div className="rounded-2xl border border-accent/40 bg-accent/10 px-5 py-4 text-center">
      <span className="font-bold text-accent">
        Final votes! Verdict locks in {remaining}s
      </span>
      <div className="mt-1 text-xs text-foreground/50">
        Vote on the arguments below — then the winner is declared and stakes pay out.
      </div>
    </div>
  );
}

const STAKE_AMOUNTS = [25, 50, 100, 250];

function StakePanel({ debate }: { debate: DebateState }) {
  const { user, setUser } = useUser();
  const [myStake, setMyStake] = useState<Stake | null>(null);
  const [side, setSide] = useState<Side>("bull");
  const [amount, setAmount] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const settled = debate.status === "finished";

  useEffect(() => {
    if (!user) return;
    fetchMyStake(debate.id, user.id).then(setMyStake);
  }, [user?.id, debate.id]);

  // Refetch after settlement to learn the payout, and refresh the points badge.
  useEffect(() => {
    if (!settled || !user) return;
    fetchMyStake(debate.id, user.id).then((s) => {
      setMyStake(s);
      if (s) notifyPointsChanged();
    });
  }, [settled, user?.id, debate.id]);

  if (!user) return null;

  async function submit() {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await placeStake(debate.id, user.id, side, amount);
      setMyStake({ side, amount, payout: null, won: null });
      setUser({ ...user, points: res.points });
      notifyPointsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "stake failed");
    } finally {
      setBusy(false);
    }
  }

  const { bull, bear, stakers } = debate.pools;
  const total = bull + bear;

  return (
    <div className="rounded-2xl border border-accent/30 bg-panel px-5 py-4">
      <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-widest text-foreground/40">
        <span>Prediction market</span>
        <span>
          pool ◆ {total.toLocaleString()} · {stakers} staker{stakers === 1 ? "" : "s"}
        </span>
      </div>

      {/* Pool split */}
      {total > 0 && (
        <div className="mb-4 flex items-center gap-3 text-xs font-semibold">
          <span className="text-bull">◆ {bull.toLocaleString()}</span>
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-foreground/10">
            <div
              className="absolute inset-y-0 left-0 bg-bull transition-all duration-500"
              style={{ width: `${total > 0 ? (bull / total) * 100 : 50}%` }}
            />
            <div
              className="absolute inset-y-0 right-0 bg-bear transition-all duration-500"
              style={{ width: `${total > 0 ? (bear / total) * 100 : 50}%` }}
            />
          </div>
          <span className="text-bear">◆ {bear.toLocaleString()}</span>
        </div>
      )}

      {myStake ? (
        <StakeResult stake={myStake} settled={settled} winner={debate.winner} />
      ) : debate.status === "live" ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <button
              onClick={() => setSide("bull")}
              className={`rounded-lg border px-4 py-2 text-sm font-bold transition ${
                side === "bull"
                  ? "border-bull bg-bull/15 text-bull"
                  : "border-panel-border text-foreground/50 hover:border-bull/50"
              }`}
            >
              🐂 Bull
            </button>
            <button
              onClick={() => setSide("bear")}
              className={`rounded-lg border px-4 py-2 text-sm font-bold transition ${
                side === "bear"
                  ? "border-bear bg-bear/15 text-bear"
                  : "border-panel-border text-foreground/50 hover:border-bear/50"
              }`}
            >
              🐻 Bear
            </button>
          </div>
          <div className="flex gap-1.5">
            {STAKE_AMOUNTS.map((a) => (
              <button
                key={a}
                onClick={() => setAmount(a)}
                disabled={a > user.points}
                className={`rounded-lg border px-3 py-2 font-mono text-xs font-bold transition disabled:opacity-30 ${
                  amount === a
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-panel-border text-foreground/50 hover:border-foreground/30"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          <button
            onClick={submit}
            disabled={busy || amount > user.points}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-bold text-background transition enabled:hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Staking…" : `Stake ◆${amount}`}
          </button>
          <span className="text-xs text-foreground/40">
            Winners split the losing pool. Locks when arguments end.
          </span>
          {error && <span className="w-full text-xs text-bear">{error}</span>}
        </div>
      ) : (
        <div className="text-sm text-foreground/50">
          {settled
            ? "Staking closed — this market has settled."
            : "Staking closed — waiting for the verdict."}
        </div>
      )}
    </div>
  );
}

function StakeResult({
  stake,
  settled,
  winner,
}: {
  stake: Stake;
  settled: boolean;
  winner: string | null;
}) {
  const sideLabel = stake.side === "bull" ? "🐂 Bull" : "🐻 Bear";

  if (!settled || stake.payout === null) {
    return (
      <div className="text-sm">
        You staked <span className="font-bold text-accent">◆{stake.amount}</span> on{" "}
        <span className={`font-bold ${stake.side === "bull" ? "text-bull" : "text-bear"}`}>
          {sideLabel}
        </span>
        {" — "}
        <span className="text-foreground/50">good luck.</span>
      </div>
    );
  }

  if (stake.won === null || winner === "draw") {
    return (
      <div className="text-sm">
        Draw — your <span className="font-bold text-accent">◆{stake.amount}</span> stake was
        refunded.
      </div>
    );
  }

  return stake.won ? (
    <div className="text-sm font-bold text-bull">
      You called it! {sideLabel} won — paid out ◆{stake.payout.toLocaleString()} (
      +{(stake.payout - stake.amount).toLocaleString()} profit).
    </div>
  ) : (
    <div className="text-sm font-bold text-bear">
      Wrong call — {sideLabel} lost. ◆{stake.amount} gone. Better luck next debate.
    </div>
  );
}

function ArgumentCard({
  arg,
  onVote,
  votingOpen,
}: {
  arg: Argument;
  onVote: (id: string, dir: "up" | "down") => void;
  votingOpen: boolean;
}) {
  const isBull = arg.side === "bull";
  const [pop, setPop] = useState<"up" | "down" | null>(null);

  function handleVote(dir: "up" | "down") {
    onVote(arg.id, dir);
    setPop(dir);
    setTimeout(() => setPop(null), 300);
  }

  return (
    <div className={`flex ${isBull ? "justify-start" : "justify-end"}`}>
      <div
        className={`w-full max-w-2xl rounded-2xl border p-5 ${
          isBull
            ? "rounded-tl-sm border-bull/30 bg-bull/5"
            : "rounded-tr-sm border-bear/30 bg-bear/5"
        }`}
      >
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span>{isBull ? "🐂" : "🐻"}</span>
          <span className={`font-bold ${isBull ? "text-bull" : "text-bear"}`}>
            {isBull ? "Max Moon" : "Dr. Doom"}
          </span>
          <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/50">
            {arg.kind}
          </span>
        </div>
        <p
          className={`leading-relaxed text-foreground/90 ${!arg.done ? "typing-caret" : ""}`}
        >
          {arg.text}
        </p>
        {arg.done && (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => handleVote("up")}
              disabled={!votingOpen}
              className={`flex items-center gap-1.5 rounded-full border border-panel-border bg-background/50 px-3 py-1.5 text-sm transition enabled:hover:border-bull/50 enabled:hover:bg-bull/10 disabled:opacity-50 ${
                pop === "up" ? "vote-pop" : ""
              }`}
            >
              👍 <span className="font-mono text-xs">{arg.up}</span>
            </button>
            <button
              onClick={() => handleVote("down")}
              disabled={!votingOpen}
              className={`flex items-center gap-1.5 rounded-full border border-panel-border bg-background/50 px-3 py-1.5 text-sm transition enabled:hover:border-bear/50 enabled:hover:bg-bear/10 disabled:opacity-50 ${
                pop === "down" ? "vote-pop" : ""
              }`}
            >
              👎 <span className="font-mono text-xs">{arg.down}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
