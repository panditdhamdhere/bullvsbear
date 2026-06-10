use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebateRecord {
    pub id: String,
    pub coin_id: String,
    pub coin_symbol: String,
    pub coin_name: String,
    pub created_at: u64,
    pub finished: bool,
    pub total_votes: u64,
    pub bull_score: i64,
    pub bear_score: i64,
    pub winner: Option<String>, // "bull" | "bear" | "draw"
}

pub const STARTING_POINTS: i64 = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,
    pub name: String,
    pub points: i64,
    pub predictions: u64,
    pub correct: u64,
    pub created_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct StoreData {
    debates: HashMap<String, DebateRecord>,
    #[serde(default)]
    users: HashMap<String, UserProfile>,
}

pub struct Store {
    path: PathBuf,
    data: Mutex<StoreData>,
}

impl Store {
    pub fn load(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        let data = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { path, data: Mutex::new(data) }
    }

    pub fn upsert(&self, record: DebateRecord) {
        let mut data = self.data.lock().unwrap();
        data.debates.insert(record.id.clone(), record);
        self.persist(&data);
    }

    fn persist(&self, data: &StoreData) {
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(data) {
            let _ = std::fs::write(&self.path, json);
        }
    }

    pub fn create_user(&self, id: String, created_at: u64) -> UserProfile {
        let mut data = self.data.lock().unwrap();
        let user = data
            .users
            .entry(id.clone())
            .or_insert_with(|| UserProfile {
                name: format!("anon-{}", &id[..4.min(id.len())]),
                id,
                points: STARTING_POINTS,
                predictions: 0,
                correct: 0,
                created_at,
            })
            .clone();
        self.persist(&data);
        user
    }

    pub fn get_user(&self, id: &str) -> Option<UserProfile> {
        self.data.lock().unwrap().users.get(id).cloned()
    }

    pub fn set_user_name(&self, id: &str, name: String) -> Option<UserProfile> {
        let mut data = self.data.lock().unwrap();
        let user = data.users.get_mut(id)?;
        user.name = name;
        let out = user.clone();
        self.persist(&data);
        Some(out)
    }

    /// Atomically deducts points; returns the updated profile or None if
    /// the user is unknown or has insufficient balance.
    pub fn deduct_points(&self, id: &str, amount: i64) -> Option<UserProfile> {
        let mut data = self.data.lock().unwrap();
        let user = data.users.get_mut(id)?;
        if user.points < amount {
            return None;
        }
        user.points -= amount;
        let out = user.clone();
        self.persist(&data);
        Some(out)
    }

    /// Applies stake settlement results: payout of 0 = lost stake.
    pub fn settle_users(&self, results: &[(String, i64, bool)]) {
        let mut data = self.data.lock().unwrap();
        for (id, payout, won) in results {
            if let Some(user) = data.users.get_mut(id) {
                user.points += payout;
                user.predictions += 1;
                if *won {
                    user.correct += 1;
                }
            }
        }
        self.persist(&data);
    }

    /// Refunds stakes (draw or aborted settlement) without counting a prediction.
    pub fn refund_users(&self, refunds: &[(String, i64)]) {
        let mut data = self.data.lock().unwrap();
        for (id, amount) in refunds {
            if let Some(user) = data.users.get_mut(id) {
                user.points += amount;
            }
        }
        self.persist(&data);
    }

    pub fn leaderboard(&self) -> Leaderboard {
        let data = self.data.lock().unwrap();
        let mut by_coin: HashMap<String, CoinStats> = HashMap::new();
        let mut bull_wins = 0u64;
        let mut bear_wins = 0u64;
        let mut draws = 0u64;

        for rec in data.debates.values() {
            let stats = by_coin.entry(rec.coin_id.clone()).or_insert_with(|| CoinStats {
                coin_id: rec.coin_id.clone(),
                symbol: rec.coin_symbol.clone(),
                name: rec.coin_name.clone(),
                debates: 0,
                total_votes: 0,
                bull_wins: 0,
                bear_wins: 0,
            });
            stats.debates += 1;
            stats.total_votes += rec.total_votes;
            if rec.finished {
                match rec.winner.as_deref() {
                    Some("bull") => {
                        bull_wins += 1;
                        stats.bull_wins += 1;
                    }
                    Some("bear") => {
                        bear_wins += 1;
                        stats.bear_wins += 1;
                    }
                    _ => draws += 1,
                }
            }
        }

        let mut coins: Vec<CoinStats> = by_coin.into_values().collect();
        coins.sort_by(|a, b| b.total_votes.cmp(&a.total_votes).then(b.debates.cmp(&a.debates)));

        let mut recent: Vec<DebateRecord> = data.debates.values().cloned().collect();
        recent.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        recent.truncate(10);

        let mut predictors: Vec<UserProfile> = data
            .users
            .values()
            .filter(|u| u.predictions > 0)
            .cloned()
            .collect();
        predictors.sort_by(|a, b| b.points.cmp(&a.points).then(b.correct.cmp(&a.correct)));
        predictors.truncate(10);

        Leaderboard {
            coins,
            bull_wins,
            bear_wins,
            draws,
            total_debates: data.debates.len() as u64,
            recent,
            predictors,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CoinStats {
    pub coin_id: String,
    pub symbol: String,
    pub name: String,
    pub debates: u64,
    pub total_votes: u64,
    pub bull_wins: u64,
    pub bear_wins: u64,
}

#[derive(Debug, Serialize)]
pub struct Leaderboard {
    pub coins: Vec<CoinStats>,
    pub bull_wins: u64,
    pub bear_wins: u64,
    pub draws: u64,
    pub total_debates: u64,
    pub recent: Vec<DebateRecord>,
    pub predictors: Vec<UserProfile>,
}
