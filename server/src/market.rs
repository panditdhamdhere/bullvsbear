use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize)]
pub struct CoinInfo {
    pub id: &'static str,
    pub symbol: &'static str,
    pub name: &'static str,
}

pub const COINS: &[CoinInfo] = &[
    CoinInfo { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
    CoinInfo { id: "ethereum", symbol: "ETH", name: "Ethereum" },
    CoinInfo { id: "solana", symbol: "SOL", name: "Solana" },
    CoinInfo { id: "ripple", symbol: "XRP", name: "XRP" },
    CoinInfo { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
    CoinInfo { id: "cardano", symbol: "ADA", name: "Cardano" },
    CoinInfo { id: "avalanche-2", symbol: "AVAX", name: "Avalanche" },
    CoinInfo { id: "chainlink", symbol: "LINK", name: "Chainlink" },
    CoinInfo { id: "polkadot", symbol: "DOT", name: "Polkadot" },
    CoinInfo { id: "uniswap", symbol: "UNI", name: "Uniswap" },
    CoinInfo { id: "litecoin", symbol: "LTC", name: "Litecoin" },
    CoinInfo { id: "pepe", symbol: "PEPE", name: "Pepe" },
];

pub fn coin_by_id(id: &str) -> Option<&'static CoinInfo> {
    COINS.iter().find(|c| c.id == id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketSnapshot {
    pub coin_id: String,
    pub symbol: String,
    pub name: String,
    pub price: f64,
    pub change_24h_pct: f64,
    pub change_7d_pct: f64,
    pub volume_24h: f64,
    pub market_cap: f64,
    pub high_24h: f64,
    pub low_24h: f64,
    pub ath: f64,
    pub ath_change_pct: f64,
    /// false when CoinGecko was unreachable and simulated data is shown
    pub live: bool,
    pub fetched_at: u64,
}

#[derive(Debug, Deserialize)]
struct GeckoMarket {
    id: String,
    symbol: String,
    name: String,
    current_price: Option<f64>,
    price_change_percentage_24h: Option<f64>,
    #[serde(rename = "price_change_percentage_7d_in_currency")]
    price_change_percentage_7d: Option<f64>,
    total_volume: Option<f64>,
    market_cap: Option<f64>,
    high_24h: Option<f64>,
    low_24h: Option<f64>,
    ath: Option<f64>,
    ath_change_percentage: Option<f64>,
}

struct CacheEntry {
    snapshot: MarketSnapshot,
    fetched: Instant,
}

pub struct MarketClient {
    http: reqwest::Client,
    cache: RwLock<HashMap<String, CacheEntry>>,
}

const CACHE_TTL: Duration = Duration::from_secs(60);

/// Rough baseline prices used only when CoinGecko is unreachable,
/// so the demo still works offline.
fn baseline_price(id: &str) -> f64 {
    match id {
        "bitcoin" => 67000.0,
        "ethereum" => 3200.0,
        "solana" => 150.0,
        "ripple" => 0.52,
        "dogecoin" => 0.14,
        "cardano" => 0.45,
        "avalanche-2" => 28.0,
        "chainlink" => 14.0,
        "polkadot" => 6.5,
        "uniswap" => 8.0,
        "litecoin" => 75.0,
        "pepe" => 0.0000115,
        _ => 1.0,
    }
}

impl MarketClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .user_agent("crypto-debate-arena/0.1")
                .timeout(Duration::from_secs(10))
                .build()
                .expect("reqwest client"),
            cache: RwLock::new(HashMap::new()),
        }
    }

    pub async fn snapshot(&self, coin: &CoinInfo) -> MarketSnapshot {
        {
            let cache = self.cache.read().await;
            if let Some(entry) = cache.get(coin.id) {
                if entry.fetched.elapsed() < CACHE_TTL {
                    return entry.snapshot.clone();
                }
            }
        }

        let snapshot = match self.fetch(coin.id).await {
            Ok(s) => s,
            Err(_) => {
                // Fall back to last cached value (even if stale) or simulated data.
                let cache = self.cache.read().await;
                if let Some(entry) = cache.get(coin.id) {
                    let mut s = entry.snapshot.clone();
                    s.live = false;
                    return s;
                }
                drop(cache);
                simulated_snapshot(coin)
            }
        };

        let mut cache = self.cache.write().await;
        cache.insert(
            coin.id.to_string(),
            CacheEntry { snapshot: snapshot.clone(), fetched: Instant::now() },
        );
        snapshot
    }

    /// Snapshots for all supported coins via a single CoinGecko request.
    pub async fn snapshot_all(&self) -> Vec<MarketSnapshot> {
        {
            let cache = self.cache.read().await;
            let fresh: Vec<MarketSnapshot> = COINS
                .iter()
                .filter_map(|c| cache.get(c.id))
                .filter(|e| e.fetched.elapsed() < CACHE_TTL)
                .map(|e| e.snapshot.clone())
                .collect();
            if fresh.len() == COINS.len() {
                return fresh;
            }
        }

        let ids: Vec<&str> = COINS.iter().map(|c| c.id).collect();
        let fetched = self.fetch_many(&ids.join(",")).await.unwrap_or_default();
        let mut by_id: HashMap<String, MarketSnapshot> =
            fetched.into_iter().map(|s| (s.coin_id.clone(), s)).collect();

        let mut cache = self.cache.write().await;
        let mut out = Vec::with_capacity(COINS.len());
        for coin in COINS {
            let snapshot = if let Some(s) = by_id.remove(coin.id) {
                cache.insert(
                    coin.id.to_string(),
                    CacheEntry { snapshot: s.clone(), fetched: Instant::now() },
                );
                s
            } else if let Some(entry) = cache.get(coin.id) {
                let mut s = entry.snapshot.clone();
                s.live = false;
                s
            } else {
                simulated_snapshot(coin)
            };
            out.push(snapshot);
        }
        out
    }

    async fn fetch_many(&self, ids: &str) -> Result<Vec<MarketSnapshot>, reqwest::Error> {
        let url = format!(
            "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids={ids}&price_change_percentage=24h,7d&per_page=250"
        );
        let rows: Vec<GeckoMarket> = self.http.get(&url).send().await?.error_for_status()?.json().await?;
        Ok(rows.into_iter().map(gecko_to_snapshot).collect())
    }

    async fn fetch(&self, id: &str) -> Result<MarketSnapshot, reqwest::Error> {
        let url = format!(
            "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids={id}&price_change_percentage=24h,7d"
        );
        let rows: Vec<GeckoMarket> = self.http.get(&url).send().await?.error_for_status()?.json().await?;
        match rows.into_iter().next() {
            Some(g) => Ok(gecko_to_snapshot(g)),
            None => Ok(simulated_snapshot(coin_by_id(id).expect("known coin"))),
        }
    }
}

fn gecko_to_snapshot(g: GeckoMarket) -> MarketSnapshot {
    MarketSnapshot {
        coin_id: g.id,
        symbol: g.symbol.to_uppercase(),
        name: g.name,
        price: g.current_price.unwrap_or(0.0),
        change_24h_pct: g.price_change_percentage_24h.unwrap_or(0.0),
        change_7d_pct: g.price_change_percentage_7d.unwrap_or(0.0),
        volume_24h: g.total_volume.unwrap_or(0.0),
        market_cap: g.market_cap.unwrap_or(0.0),
        high_24h: g.high_24h.unwrap_or(0.0),
        low_24h: g.low_24h.unwrap_or(0.0),
        ath: g.ath.unwrap_or(0.0),
        ath_change_pct: g.ath_change_percentage.unwrap_or(0.0),
        live: true,
        fetched_at: now_secs(),
    }
}

fn simulated_snapshot(coin: &CoinInfo) -> MarketSnapshot {
    let base = baseline_price(coin.id);
    let jitter = (rand::random::<f64>() - 0.5) * 0.06; // +/- 3%
    let change = (rand::random::<f64>() - 0.5) * 12.0; // +/- 6%
    let price = base * (1.0 + jitter);
    MarketSnapshot {
        coin_id: coin.id.to_string(),
        symbol: coin.symbol.to_string(),
        name: coin.name.to_string(),
        price,
        change_24h_pct: change,
        change_7d_pct: change * 1.8,
        volume_24h: price * 1_000_000.0,
        market_cap: price * 19_000_000.0,
        high_24h: price * 1.04,
        low_24h: price * 0.95,
        ath: base * 1.6,
        ath_change_pct: -((1.0 - price / (base * 1.6)) * 100.0),
        live: false,
        fetched_at: now_secs(),
    }
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
