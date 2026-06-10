use futures::StreamExt;
use serde_json::json;
use tokio::sync::mpsc;

use crate::market::MarketSnapshot;

/// Streams chat completions from any OpenAI-compatible API when
/// OPENAI_API_KEY is set. Returns None when no key is configured,
/// in which case the caller uses the built-in persona engine.
pub struct LlmClient {
    http: reqwest::Client,
    api_key: Option<String>,
    base_url: String,
    model: String,
}

impl LlmClient {
    pub fn from_env() -> Self {
        Self {
            http: reqwest::Client::new(),
            api_key: std::env::var("OPENAI_API_KEY").ok().filter(|k| !k.is_empty()),
            base_url: std::env::var("OPENAI_BASE_URL")
                .unwrap_or_else(|_| "https://api.openai.com/v1".to_string()),
            model: std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string()),
        }
    }

    pub fn enabled(&self) -> bool {
        self.api_key.is_some()
    }

    /// Streams content tokens through a channel. Returns None if disabled
    /// or the request fails (caller falls back to the persona engine).
    pub async fn stream_completion(
        &self,
        system: String,
        user: String,
    ) -> Option<mpsc::Receiver<String>> {
        let key = self.api_key.clone()?;
        let body = json!({
            "model": self.model,
            "stream": true,
            "max_tokens": 220,
            "temperature": 0.9,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        });

        let resp = self
            .http
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(key)
            .json(&body)
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?;

        let (tx, rx) = mpsc::channel::<String>(64);
        tokio::spawn(async move {
            let mut stream = resp.bytes_stream();
            let mut buf = String::new();
            while let Some(Ok(chunk)) = stream.next().await {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(pos) = buf.find('\n') {
                    let line = buf[..pos].trim().to_string();
                    buf.drain(..=pos);
                    let Some(data) = line.strip_prefix("data: ") else { continue };
                    if data == "[DONE]" {
                        return;
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(token) = v["choices"][0]["delta"]["content"].as_str() {
                            if tx.send(token.to_string()).await.is_err() {
                                return;
                            }
                        }
                    }
                }
            }
        });
        Some(rx)
    }
}

// ---------------------------------------------------------------------------
// Built-in persona engine (no API key required)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Bull,
    Bear,
}

impl Side {
    pub fn label(&self) -> &'static str {
        match self {
            Side::Bull => "Bull",
            Side::Bear => "Bear",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArgKind {
    Opening,
    Rebuttal,
    Closing,
}

fn fmt_price(p: f64) -> String {
    if p >= 1000.0 {
        let int = p.round() as i64;
        let s = int.to_string();
        let mut out = String::new();
        for (i, c) in s.chars().enumerate() {
            if i > 0 && (s.len() - i) % 3 == 0 {
                out.push(',');
            }
            out.push(c);
        }
        format!("${out}")
    } else if p >= 1.0 {
        format!("${p:.2}")
    } else {
        format!("${p:.6}")
    }
}

fn fmt_big(v: f64) -> String {
    if v >= 1e9 {
        format!("${:.1}B", v / 1e9)
    } else if v >= 1e6 {
        format!("${:.1}M", v / 1e6)
    } else {
        format!("${:.0}K", v / 1e3)
    }
}

fn pick<'a>(options: &'a [String]) -> &'a str {
    let i = rand::random::<u32>() as usize % options.len();
    &options[i]
}

pub fn persona_system_prompt(side: Side, m: &MarketSnapshot) -> String {
    let persona = match side {
        Side::Bull => "You are 'Max Moon', an unshakeably bullish crypto analyst. You are witty, sharp, data-driven but dramatic. You argue why the asset will go UP. Spin even bad news as bullish.",
        Side::Bear => "You are 'Dr. Doom', a ruthless bearish crypto skeptic. You are sardonic, precise, risk-obsessed. You argue why the asset will go DOWN. Dismantle hype with cold facts.",
    };
    format!(
        "{persona}\n\nLive market data for {} ({}): price {}, 24h change {:+.2}%, 7d change {:+.2}%, 24h volume {}, market cap {}, all-time high {} ({:+.1}% from ATH).\n\nReference the live numbers. Stay in character. Reply with ONE punchy debate argument of 50-90 words. No markdown, no lists, no preamble.",
        m.name,
        m.symbol,
        fmt_price(m.price),
        m.change_24h_pct,
        m.change_7d_pct,
        fmt_big(m.volume_24h),
        fmt_big(m.market_cap),
        fmt_price(m.ath),
        m.ath_change_pct,
    )
}

pub fn persona_user_prompt(kind: ArgKind, round: u32, opponent_last: Option<&str>) -> String {
    match kind {
        ArgKind::Opening => "Deliver your opening argument for this debate.".to_string(),
        ArgKind::Closing => match opponent_last {
            Some(op) => format!(
                "Your opponent just argued: \"{op}\". Deliver your closing argument — counter them and land your strongest final point. This is round {round}, the final round."
            ),
            None => "Deliver your closing argument.".to_string(),
        },
        ArgKind::Rebuttal => match opponent_last {
            Some(op) => format!(
                "Your opponent just argued: \"{op}\". Rebut their point directly, then advance your own case. This is round {round}."
            ),
            None => format!("Advance your case with a new argument. This is round {round}."),
        },
    }
}

/// Generates a full argument from templates, used when no LLM key is set.
pub fn persona_fallback(
    side: Side,
    kind: ArgKind,
    m: &MarketSnapshot,
    opponent_last: Option<&str>,
) -> String {
    let sym = &m.symbol;
    let price = fmt_price(m.price);
    let chg = format!("{:+.1}%", m.change_24h_pct);
    let chg7 = format!("{:+.1}%", m.change_7d_pct);
    let vol = fmt_big(m.volume_24h);
    let ath = fmt_price(m.ath);
    let from_ath = format!("{:.0}%", m.ath_change_pct.abs());
    let up_24h = m.change_24h_pct >= 0.0;

    let opener: String = match (side, kind) {
        (Side::Bull, ArgKind::Opening) => {
            let opts = vec![
                format!("Ladies and gentlemen, {sym} sits at {price} and the 24h tape reads {chg} — and either way, that's a gift."),
                format!("Look at the board: {sym} trading at {price}, {vol} in volume churning through in a single day. That is not a dying asset, that's a coiled spring."),
                format!("{sym} at {price}. Write that number down, because you'll be telling people you could've bought here."),
            ];
            pick(&opts).to_string()
        }
        (Side::Bear, ArgKind::Opening) => {
            let opts = vec![
                format!("Let's start with reality: {sym} is {from_ath} below its all-time high of {ath}. The market already voted, and it voted no."),
                format!("{sym} prints {chg} on the day and the crowd calls it opportunity. I call it a falling knife with good marketing."),
                format!("Here are the facts the bulls won't read: {sym} at {price}, 7-day move of {chg7}, and a chart that needs hope as a load-bearing wall."),
            ];
            pick(&opts).to_string()
        }
        (Side::Bull, _) => {
            let opts = vec![
                format!("My opponent sees ghosts; I see {vol} of daily volume backing {sym} at {price}."),
                format!("Fear is the discount, friends. {sym} moving {chg} today just reset the entry for everyone paying attention."),
                format!("Zoom out. {sym} is {chg7} on the week while builders keep shipping — price follows fundamentals with a lag, always has."),
            ];
            pick(&opts).to_string()
        }
        (Side::Bear, _) => {
            let opts = vec![
                format!("Adorable optimism, but {sym} is still {from_ath} away from {ath} — gravity is undefeated."),
                format!("That {vol} of volume the bull loves? Plenty of it is exit liquidity. Smart money distributes into exactly this kind of noise."),
                format!("A {chg} day doesn't make a thesis. {sym} remains a leveraged bet on liquidity, and liquidity has a habit of leaving first."),
            ];
            pick(&opts).to_string()
        }
    };

    let counter: String = match (opponent_last.is_some(), side) {
        (true, Side::Bull) => {
            let opts = vec![
                "My opponent's entire case is a screenshot of yesterday — markets price the future, not the rear-view mirror.".to_string(),
                "The bear cites the drawdown from ATH like it's a verdict. Every monster rally in this asset's history started from exactly this kind of despair.".to_string(),
                "Notice the bear offers fear, never a level. I'll give you levels: accumulation zones get bought, and we're sitting in one.".to_string(),
            ];
            pick(&opts).to_string()
        }
        (true, Side::Bear) => {
            let opts = vec![
                "The bull's rebuttal is vibes wearing a suit. Hope is not a risk model.".to_string(),
                "\"Zoom out\" — the eternal cry of the underwater position. Zoom out far enough and you'll see every bagholder said the same thing.".to_string(),
                "My opponent calls capitulation a discount. The market calls it price discovery, and it isn't finished.".to_string(),
            ];
            pick(&opts).to_string()
        }
        _ => String::new(),
    };

    let close: String = match (side, kind) {
        (Side::Bull, ArgKind::Closing) => {
            let opts = vec![
                format!("So here's the closing math: asymmetric upside, {vol} of daily conviction, and a market that punishes the unimaginative. {sym} doesn't need everyone to believe — just enough. Moon isn't a meme; it's a destination."),
                format!("History rhymes: panic, disbelief, then a candle nobody can explain. {sym} at {price} is the disbelief phase. See you at the after-party."),
            ];
            pick(&opts).to_string()
        }
        (Side::Bear, ArgKind::Closing) => {
            let opts = vec![
                format!("Closing argument: {sym} is {from_ath} from its high, momentum reads {chg7} on the week, and the only catalyst on offer is a vibe. Protect your capital — the market won't do it for you."),
                format!("I'll end where the chart ends: lower. {sym} at {price} is not a floor, it's a landing on the way down the staircase. The bear case writes itself; the bull case needs a séance."),
            ];
            pick(&opts).to_string()
        }
        (Side::Bull, _) => {
            let opts = vec![
                format!("Volume {vol}, narrative heating up, supply drying on exchanges — {sym} is loading, not fading."),
                format!("The asset survived every obituary written about it. {price} today is a footnote in a much taller chart."),
                if up_24h {
                    format!("And the tape agrees — {chg} and climbing. Strength begets strength.")
                } else {
                    format!("A {chg} dip is the market shaking out tourists before the real move. Thank it.")
                },
            ];
            pick(&opts).to_string()
        }
        (Side::Bear, _) => {
            let opts = vec![
                format!("Watch the weekly: {chg7}. Trends are momentum, and momentum here points at the floor."),
                format!("Until {sym} reclaims lost ground with real volume — not {vol} of churn — every bounce is a short's paycheck."),
                if up_24h {
                    format!("Yes, it's {chg} today. Dead cats bounce highest. Ask anyone who bought the last 'recovery'.")
                } else {
                    format!("The tape says {chg} and falling. When the market speaks this clearly, listen.")
                },
            ];
            pick(&opts).to_string()
        }
    };

    let mut parts: Vec<String> = vec![opener];
    if !counter.is_empty() {
        parts.push(counter);
    }
    parts.push(close);
    parts.join(" ")
}
