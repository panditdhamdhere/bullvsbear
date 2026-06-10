export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type CoinInfo = {
  id: string;
  symbol: string;
  name: string;
};

export type MarketSnapshot = {
  coin_id: string;
  symbol: string;
  name: string;
  price: number;
  change_24h_pct: number;
  change_7d_pct: number;
  volume_24h: number;
  market_cap: number;
  high_24h: number;
  low_24h: number;
  ath: number;
  ath_change_pct: number;
  live: boolean;
  fetched_at: number;
};

export type Side = "bull" | "bear";

export type Argument = {
  id: string;
  side: Side;
  round: number;
  kind: "opening" | "rebuttal" | "closing";
  text: string;
  token_count: number;
  up: number;
  down: number;
  done: boolean;
};

export type Sentiment = {
  bull: number;
  bear: number;
  total_votes: number;
};

export type DebateState = {
  id: string;
  coin_id: string;
  coin_symbol: string;
  coin_name: string;
  rounds_total: number;
  status: "live" | "finished";
  market: MarketSnapshot;
  arguments: Argument[];
  sentiment: Sentiment;
  winner: string | null;
  created_at: number;
  llm_powered: boolean;
};

export type DebateEvent =
  | { type: "snapshot"; state: DebateState }
  | {
      type: "argument_start";
      argument: { id: string; side: Side; round: number; kind: Argument["kind"] };
    }
  | { type: "token"; argument_id: string; idx: number; text: string }
  | { type: "argument_end"; argument_id: string }
  | {
      type: "votes";
      argument_id: string;
      up: number;
      down: number;
      sentiment: Sentiment;
      winner: string | null;
    }
  | { type: "status"; status: "finished"; winner: string | null; sentiment: Sentiment };

export type CoinStats = {
  coin_id: string;
  symbol: string;
  name: string;
  debates: number;
  total_votes: number;
  bull_wins: number;
  bear_wins: number;
};

export type DebateRecord = {
  id: string;
  coin_id: string;
  coin_symbol: string;
  coin_name: string;
  created_at: number;
  finished: boolean;
  total_votes: number;
  bull_score: number;
  bear_score: number;
  winner: string | null;
};

export type Leaderboard = {
  coins: CoinStats[];
  bull_wins: number;
  bear_wins: number;
  draws: number;
  total_debates: number;
  recent: DebateRecord[];
};

export async function fetchCoins(): Promise<CoinInfo[]> {
  const res = await fetch(`${API_BASE}/api/coins`);
  if (!res.ok) throw new Error("failed to load coins");
  return res.json();
}

export async function fetchMarkets(): Promise<MarketSnapshot[]> {
  const res = await fetch(`${API_BASE}/api/markets`);
  if (!res.ok) throw new Error("failed to load markets");
  return res.json();
}

export async function fetchMarket(coinId: string): Promise<MarketSnapshot> {
  const res = await fetch(`${API_BASE}/api/market/${coinId}`);
  if (!res.ok) throw new Error("failed to load market data");
  return res.json();
}

export async function createDebate(
  coinId: string,
  rounds: number,
): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/api/debates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coin_id: coinId, rounds }),
  });
  if (!res.ok) throw new Error("failed to create debate");
  return res.json();
}

export async function sendVote(
  debateId: string,
  argumentId: string,
  dir: "up" | "down",
): Promise<void> {
  await fetch(`${API_BASE}/api/debates/${debateId}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ argument_id: argumentId, dir }),
  });
}

export async function fetchLeaderboard(): Promise<Leaderboard> {
  const res = await fetch(`${API_BASE}/api/leaderboard`, { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load leaderboard");
  return res.json();
}

export function fmtPrice(p: number): string {
  if (p >= 1000) {
    return `$${p.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (p >= 1) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(6)}`;
}

export function fmtBig(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${(v / 1e3).toFixed(0)}K`;
}
