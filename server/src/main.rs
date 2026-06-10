mod debate;
mod llm;
mod market;
mod store;

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use tower_http::cors::CorsLayer;

use market::{coin_by_id, MarketClient, MarketSnapshot, COINS};

pub struct AppState {
    pub market: MarketClient,
    pub debates: debate::DebateHub,
    pub store: store::Store,
    pub llm: llm::LlmClient,
}

async fn list_coins() -> Json<&'static [market::CoinInfo]> {
    Json(COINS)
}

async fn get_markets(State(app): State<Arc<AppState>>) -> Json<Vec<MarketSnapshot>> {
    Json(app.market.snapshot_all().await)
}

async fn get_market(
    State(app): State<Arc<AppState>>,
    Path(coin_id): Path<String>,
) -> Result<Json<MarketSnapshot>, (StatusCode, String)> {
    let coin = coin_by_id(&coin_id)
        .ok_or((StatusCode::NOT_FOUND, format!("unknown coin: {coin_id}")))?;
    Ok(Json(app.market.snapshot(coin).await))
}

async fn leaderboard(State(app): State<Arc<AppState>>) -> Json<store::Leaderboard> {
    Json(app.store.leaderboard())
}

async fn create_user(State(app): State<Arc<AppState>>) -> Json<store::UserProfile> {
    let id = uuid::Uuid::new_v4().to_string();
    Json(app.store.create_user(id, market::now_secs()))
}

async fn get_user(
    State(app): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<store::UserProfile>, StatusCode> {
    app.store.get_user(&id).map(Json).ok_or(StatusCode::NOT_FOUND)
}

#[derive(serde::Deserialize)]
struct SetName {
    name: String,
}

async fn set_user_name(
    State(app): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<SetName>,
) -> Result<Json<store::UserProfile>, (StatusCode, String)> {
    let name: String = req.name.trim().chars().take(24).collect();
    if name.len() < 2 {
        return Err((StatusCode::BAD_REQUEST, "name must be at least 2 characters".to_string()));
    }
    app.store
        .set_user_name(&id, name)
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "unknown user".to_string()))
}

#[tokio::main]
async fn main() {
    let llm = llm::LlmClient::from_env();
    println!(
        "AI engine: {}",
        if llm.enabled() { "OpenAI-compatible API (OPENAI_API_KEY set)" } else { "built-in persona engine (set OPENAI_API_KEY for LLM debates)" }
    );

    let state = Arc::new(AppState {
        market: MarketClient::new(),
        debates: debate::DebateHub::default(),
        store: store::Store::load("data/store.json"),
        llm,
    });

    let app = Router::new()
        .route("/api/coins", get(list_coins))
        .route("/api/markets", get(get_markets))
        .route("/api/market/{coin_id}", get(get_market))
        .route("/api/debates", post(debate::create_debate))
        .route("/api/debates/{id}", get(debate::get_debate))
        .route("/api/debates/{id}/stream", get(debate::stream_debate))
        .route("/api/debates/{id}/vote", post(debate::vote))
        .route("/api/debates/{id}/stake", post(debate::stake))
        .route("/api/debates/{id}/stake/{user_id}", get(debate::get_stake))
        .route("/api/users", post(create_user))
        .route("/api/users/{id}", get(get_user))
        .route("/api/users/{id}/name", post(set_user_name))
        .route("/api/leaderboard", get(leaderboard))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    println!("Crypto Debate Arena server listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}
