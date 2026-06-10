use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::Json;
use futures::stream::Stream;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{broadcast, RwLock};
use tokio_stream::wrappers::BroadcastStream;
use uuid::Uuid;

use crate::llm::{persona_fallback, persona_system_prompt, persona_user_prompt, ArgKind, Side};
use crate::market::{coin_by_id, now_secs, MarketSnapshot};
use crate::store::DebateRecord;
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct Argument {
    pub id: String,
    pub side: Side,
    pub round: u32,
    pub kind: String,
    pub text: String,
    pub token_count: u64,
    pub up: i64,
    pub down: i64,
    pub done: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DebateStatus {
    Live,
    Voting,
    Finished,
}

/// Seconds the crowd gets to vote after the final argument before the
/// verdict locks and stakes are settled.
const VOTING_WINDOW_SECS: u64 = 45;

const MIN_STAKE: i64 = 10;
const MAX_STAKE: i64 = 10_000;

#[derive(Debug, Clone, Copy, Serialize, Default)]
pub struct StakePools {
    pub bull: i64,
    pub bear: i64,
    pub stakers: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Stake {
    pub side: Side,
    pub amount: i64,
    pub payout: Option<i64>,
    pub won: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DebateState {
    pub id: String,
    pub coin_id: String,
    pub coin_symbol: String,
    pub coin_name: String,
    pub rounds_total: u32,
    pub status: DebateStatus,
    pub market: MarketSnapshot,
    pub arguments: Vec<Argument>,
    pub sentiment: Sentiment,
    pub winner: Option<String>,
    pub created_at: u64,
    pub llm_powered: bool,
    pub pools: StakePools,
    pub voting_ends_at: Option<u64>,
    #[serde(skip_serializing)]
    pub stakes: HashMap<String, Stake>,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Sentiment {
    pub bull: f64,
    pub bear: f64,
    pub total_votes: u64,
}

pub struct DebateRoom {
    pub state: RwLock<DebateState>,
    pub tx: broadcast::Sender<String>,
}

#[derive(Default)]
pub struct DebateHub {
    rooms: RwLock<HashMap<String, Arc<DebateRoom>>>,
}

impl DebateHub {
    pub async fn get(&self, id: &str) -> Option<Arc<DebateRoom>> {
        self.rooms.read().await.get(id).cloned()
    }

    pub async fn insert(&self, id: String, room: Arc<DebateRoom>) {
        self.rooms.write().await.insert(id, room);
    }
}

fn compute_sentiment(args: &[Argument]) -> Sentiment {
    let mut bull = 0i64;
    let mut bear = 0i64;
    let mut total = 0u64;
    for a in args {
        total += (a.up + a.down) as u64;
        match a.side {
            Side::Bull => {
                bull += a.up;
                bear += a.down;
            }
            Side::Bear => {
                bear += a.up;
                bull += a.down;
            }
        }
    }
    let sum = (bull + bear) as f64;
    if sum <= 0.0 {
        Sentiment { bull: 50.0, bear: 50.0, total_votes: total }
    } else {
        let b = (bull as f64 / sum * 100.0).clamp(0.0, 100.0);
        Sentiment { bull: b, bear: 100.0 - b, total_votes: total }
    }
}

fn compute_winner(args: &[Argument]) -> (i64, i64, Option<String>) {
    let mut bull_net = 0i64;
    let mut bear_net = 0i64;
    for a in args {
        let net = a.up - a.down;
        match a.side {
            Side::Bull => bull_net += net,
            Side::Bear => bear_net += net,
        }
    }
    let winner = if bull_net > bear_net {
        Some("bull".to_string())
    } else if bear_net > bull_net {
        Some("bear".to_string())
    } else {
        Some("draw".to_string())
    };
    (bull_net, bear_net, winner)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateDebate {
    pub coin_id: String,
    #[serde(default)]
    pub rounds: Option<u32>,
}

pub async fn create_debate(
    State(app): State<Arc<AppState>>,
    Json(req): Json<CreateDebate>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let coin = coin_by_id(&req.coin_id)
        .ok_or((StatusCode::BAD_REQUEST, format!("unknown coin: {}", req.coin_id)))?;
    let rounds = req.rounds.unwrap_or(3).clamp(1, 5);

    let market = app.market.snapshot(coin).await;
    let id = Uuid::new_v4().to_string();

    let state = DebateState {
        id: id.clone(),
        coin_id: coin.id.to_string(),
        coin_symbol: coin.symbol.to_string(),
        coin_name: coin.name.to_string(),
        rounds_total: rounds,
        status: DebateStatus::Live,
        market,
        arguments: Vec::new(),
        sentiment: Sentiment { bull: 50.0, bear: 50.0, total_votes: 0 },
        winner: None,
        created_at: now_secs(),
        llm_powered: app.llm.enabled(),
        pools: StakePools::default(),
        voting_ends_at: None,
        stakes: HashMap::new(),
    };

    app.store.upsert(DebateRecord {
        id: id.clone(),
        coin_id: state.coin_id.clone(),
        coin_symbol: state.coin_symbol.clone(),
        coin_name: state.coin_name.clone(),
        created_at: state.created_at,
        finished: false,
        total_votes: 0,
        bull_score: 0,
        bear_score: 0,
        winner: None,
    });

    let (tx, _) = broadcast::channel::<String>(512);
    let room = Arc::new(DebateRoom { state: RwLock::new(state), tx });
    app.debates.insert(id.clone(), room.clone()).await;

    tokio::spawn(run_debate(app.clone(), room));

    Ok(Json(json!({ "id": id })))
}

pub async fn get_debate(
    State(app): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<DebateState>, StatusCode> {
    let room = app.debates.get(&id).await.ok_or(StatusCode::NOT_FOUND)?;
    let state = room.state.read().await.clone();
    Ok(Json(state))
}

pub async fn stream_debate(
    State(app): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<SseEvent, Infallible>>>, StatusCode> {
    let room = app.debates.get(&id).await.ok_or(StatusCode::NOT_FOUND)?;

    // Subscribe before snapshotting so no events are missed; the frontend
    // dedupes tokens via per-argument token indices.
    let rx = room.tx.subscribe();
    let state = room.state.read().await.clone();
    let snapshot = json!({ "type": "snapshot", "state": state }).to_string();

    let stream = futures::stream::once(async move { Ok(SseEvent::default().data(snapshot)) })
        .chain(BroadcastStream::new(rx).filter_map(|msg| async move {
            match msg {
                Ok(data) => Some(Ok(SseEvent::default().data(data))),
                Err(_lagged) => None,
            }
        }));

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

#[derive(Debug, Deserialize)]
pub struct VoteReq {
    pub argument_id: String,
    pub dir: String, // "up" | "down"
}

pub async fn vote(
    State(app): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<VoteReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let room = app
        .debates
        .get(&id)
        .await
        .ok_or((StatusCode::NOT_FOUND, "debate not found".to_string()))?;

    let mut state = room.state.write().await;
    if state.status == DebateStatus::Finished {
        return Err((StatusCode::CONFLICT, "voting is closed — the verdict is locked".to_string()));
    }
    let arg = state
        .arguments
        .iter_mut()
        .find(|a| a.id == req.argument_id)
        .ok_or((StatusCode::NOT_FOUND, "argument not found".to_string()))?;

    match req.dir.as_str() {
        "up" => arg.up += 1,
        "down" => arg.down += 1,
        _ => return Err((StatusCode::BAD_REQUEST, "dir must be 'up' or 'down'".to_string())),
    }
    let (arg_id, up, down) = (arg.id.clone(), arg.up, arg.down);

    state.sentiment = compute_sentiment(&state.arguments);
    let (bull_net, bear_net, _) = compute_winner(&state.arguments);

    app.store.upsert(DebateRecord {
        id: state.id.clone(),
        coin_id: state.coin_id.clone(),
        coin_symbol: state.coin_symbol.clone(),
        coin_name: state.coin_name.clone(),
        created_at: state.created_at,
        finished: state.status == DebateStatus::Finished,
        total_votes: state.sentiment.total_votes,
        bull_score: bull_net,
        bear_score: bear_net,
        winner: state.winner.clone(),
    });

    let event = json!({
        "type": "votes",
        "argument_id": arg_id,
        "up": up,
        "down": down,
        "sentiment": state.sentiment,
        "winner": state.winner,
    });
    let _ = room.tx.send(event.to_string());

    Ok(Json(json!({ "ok": true, "sentiment": state.sentiment })))
}

#[derive(Debug, Deserialize)]
pub struct StakeReq {
    pub user_id: String,
    pub side: String, // "bull" | "bear"
    pub amount: i64,
}

pub async fn stake(
    State(app): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<StakeReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let side = match req.side.as_str() {
        "bull" => Side::Bull,
        "bear" => Side::Bear,
        _ => return Err((StatusCode::BAD_REQUEST, "side must be 'bull' or 'bear'".to_string())),
    };
    if !(MIN_STAKE..=MAX_STAKE).contains(&req.amount) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("stake must be between {MIN_STAKE} and {MAX_STAKE} points"),
        ));
    }

    let room = app
        .debates
        .get(&id)
        .await
        .ok_or((StatusCode::NOT_FOUND, "debate not found".to_string()))?;

    let mut state = room.state.write().await;
    if state.status != DebateStatus::Live {
        return Err((StatusCode::CONFLICT, "staking closed — the debate is over".to_string()));
    }
    if state.stakes.contains_key(&req.user_id) {
        return Err((StatusCode::CONFLICT, "you already staked on this debate".to_string()));
    }

    let user = app.store.deduct_points(&req.user_id, req.amount).ok_or((
        StatusCode::BAD_REQUEST,
        "unknown user or insufficient points".to_string(),
    ))?;

    state.stakes.insert(
        req.user_id.clone(),
        Stake { side, amount: req.amount, payout: None, won: None },
    );
    match side {
        Side::Bull => state.pools.bull += req.amount,
        Side::Bear => state.pools.bear += req.amount,
    }
    state.pools.stakers += 1;
    let pools = state.pools;

    let _ = room.tx.send(json!({ "type": "stake", "pools": pools }).to_string());

    Ok(Json(json!({ "ok": true, "pools": pools, "points": user.points })))
}

pub async fn get_stake(
    State(app): State<Arc<AppState>>,
    Path((id, user_id)): Path<(String, String)>,
) -> Result<Json<Stake>, StatusCode> {
    let room = app.debates.get(&id).await.ok_or(StatusCode::NOT_FOUND)?;
    let state = room.state.read().await;
    state.stakes.get(&user_id).cloned().map(Json).ok_or(StatusCode::NOT_FOUND)
}

// ---------------------------------------------------------------------------
// Debate generation task
// ---------------------------------------------------------------------------

async fn run_debate(app: Arc<AppState>, room: Arc<DebateRoom>) {
    let (rounds, market) = {
        let s = room.state.read().await;
        (s.rounds_total, s.market.clone())
    };

    for round in 1..=rounds {
        for side in [Side::Bull, Side::Bear] {
            let kind = if round == 1 {
                ArgKind::Opening
            } else if round == rounds {
                ArgKind::Closing
            } else {
                ArgKind::Rebuttal
            };

            let opponent_last = {
                let s = room.state.read().await;
                s.arguments
                    .iter()
                    .rev()
                    .find(|a| a.side != side)
                    .map(|a| a.text.clone())
            };

            speak(&app, &room, side, round, kind, &market, opponent_last.as_deref()).await;
            tokio::time::sleep(Duration::from_millis(900)).await;
        }
    }

    // Voting window: arguments are done, the crowd gets a final chance to
    // vote before the verdict locks and stakes settle.
    let voting_ends_at = now_secs() + VOTING_WINDOW_SECS;
    {
        let mut s = room.state.write().await;
        s.status = DebateStatus::Voting;
        s.voting_ends_at = Some(voting_ends_at);
        let _ = room.tx.send(
            json!({
                "type": "status",
                "status": "voting",
                "voting_ends_at": voting_ends_at,
                "sentiment": s.sentiment,
            })
            .to_string(),
        );
    }
    tokio::time::sleep(Duration::from_secs(VOTING_WINDOW_SECS)).await;

    let mut s = room.state.write().await;
    s.status = DebateStatus::Finished;
    let (bull_net, bear_net, winner) = compute_winner(&s.arguments);
    s.winner = winner.clone();
    s.sentiment = compute_sentiment(&s.arguments);

    settle_stakes(&app, &mut s, winner.as_deref());

    app.store.upsert(DebateRecord {
        id: s.id.clone(),
        coin_id: s.coin_id.clone(),
        coin_symbol: s.coin_symbol.clone(),
        coin_name: s.coin_name.clone(),
        created_at: s.created_at,
        finished: true,
        total_votes: s.sentiment.total_votes,
        bull_score: bull_net,
        bear_score: bear_net,
        winner: winner.clone(),
    });

    let _ = room.tx.send(
        json!({
            "type": "settled",
            "winner": winner,
            "sentiment": s.sentiment,
            "pools": s.pools,
        })
        .to_string(),
    );
}

/// Parimutuel settlement: winners split the losing pool pro-rata to their
/// stake. Draws (or a one-sided pool) refund everyone.
fn settle_stakes(app: &Arc<AppState>, s: &mut DebateState, winner: Option<&str>) {
    if s.stakes.is_empty() {
        return;
    }

    let winning_side = match winner {
        Some("bull") => Some(Side::Bull),
        Some("bear") => Some(Side::Bear),
        _ => None,
    };
    let (win_pool, lose_pool) = match winning_side {
        Some(Side::Bull) => (s.pools.bull, s.pools.bear),
        Some(Side::Bear) => (s.pools.bear, s.pools.bull),
        None => (0, 0),
    };

    if winning_side.is_none() || win_pool == 0 {
        let refunds: Vec<(String, i64)> =
            s.stakes.iter().map(|(id, st)| (id.clone(), st.amount)).collect();
        for st in s.stakes.values_mut() {
            st.payout = Some(st.amount);
            st.won = None; // refunded, not counted as a prediction
        }
        app.store.refund_users(&refunds);
        return;
    }

    let mut results: Vec<(String, i64, bool)> = Vec::with_capacity(s.stakes.len());
    for (id, st) in s.stakes.iter_mut() {
        let won = Some(st.side) == winning_side;
        let payout = if won {
            st.amount + st.amount * lose_pool / win_pool
        } else {
            0
        };
        st.payout = Some(payout);
        st.won = Some(won);
        results.push((id.clone(), payout, won));
    }
    app.store.settle_users(&results);
}

async fn speak(
    app: &Arc<AppState>,
    room: &Arc<DebateRoom>,
    side: Side,
    round: u32,
    kind: ArgKind,
    market: &MarketSnapshot,
    opponent_last: Option<&str>,
) {
    let arg_id = Uuid::new_v4().to_string();
    let kind_label = match kind {
        ArgKind::Opening => "opening",
        ArgKind::Rebuttal => "rebuttal",
        ArgKind::Closing => "closing",
    };

    {
        let mut s = room.state.write().await;
        s.arguments.push(Argument {
            id: arg_id.clone(),
            side,
            round,
            kind: kind_label.to_string(),
            text: String::new(),
            token_count: 0,
            up: 0,
            down: 0,
            done: false,
        });
    }
    let _ = room.tx.send(
        json!({
            "type": "argument_start",
            "argument": { "id": arg_id, "side": side, "round": round, "kind": kind_label }
        })
        .to_string(),
    );

    // Try the LLM first; fall back to the built-in persona engine.
    let mut llm_rx = if app.llm.enabled() {
        app.llm
            .stream_completion(
                persona_system_prompt(side, market),
                persona_user_prompt(kind, round, opponent_last),
            )
            .await
    } else {
        None
    };

    let mut idx: u64 = 0;

    if let Some(rx) = llm_rx.as_mut() {
        while let Some(chunk) = rx.recv().await {
            push_token(room, &arg_id, &mut idx, chunk).await;
            tokio::time::sleep(Duration::from_millis(28)).await;
        }
        if idx == 0 {
            llm_rx = None; // stream yielded nothing — fall through to fallback
        }
    }

    if llm_rx.is_none() && idx == 0 {
        let text = persona_fallback(side, kind, market, opponent_last);
        for word in text.split_whitespace() {
            push_token(room, &arg_id, &mut idx, format!("{word} ")).await;
            tokio::time::sleep(Duration::from_millis(42)).await;
        }
    }

    {
        let mut s = room.state.write().await;
        if let Some(a) = s.arguments.iter_mut().find(|a| a.id == arg_id) {
            a.done = true;
        }
    }
    let _ = room.tx.send(json!({ "type": "argument_end", "argument_id": arg_id }).to_string());
}

async fn push_token(room: &Arc<DebateRoom>, arg_id: &str, idx: &mut u64, text: String) {
    let i = *idx;
    *idx += 1;
    {
        let mut s = room.state.write().await;
        if let Some(a) = s.arguments.iter_mut().find(|a| a.id == arg_id) {
            a.text.push_str(&text);
            a.token_count = i + 1;
        }
    }
    let _ = room.tx.send(
        json!({ "type": "token", "argument_id": arg_id, "idx": i, "text": text }).to_string(),
    );
}
