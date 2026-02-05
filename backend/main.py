"""
Volatility Sentiment Engine — Backend
Calculates BTC market sentiment from Deribit option skew (25-delta risk reversal).
"""

import asyncio
import logging
import math
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from statistics import NormalDist

import aiohttp
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
)
log = logging.getLogger("sentiment-engine")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DERIBIT_BASE = "https://www.deribit.com/api/v2"
BOOK_SUMMARY_URL = f"{DERIBIT_BASE}/public/get_book_summary_by_currency"
DVOL_INDEX_URL = f"{DERIBIT_BASE}/public/get_index_price"
TICKER_URL = f"{DERIBIT_BASE}/public/ticker"
FETCH_INTERVAL_SECONDS = 60
TARGET_DELTA = 0.25

# Standard normal CDF for approximate delta
_PHI = NormalDist().cdf

# ---------------------------------------------------------------------------
# In-memory cache
# ---------------------------------------------------------------------------


class CachedState:
    """Holder for the latest processed sentiment data."""

    def __init__(self) -> None:
        self.data: dict | None = None
        self.last_updated: str | None = None
        self.error: str | None = None

    def set(self, data: dict) -> None:
        self.data = data
        self.last_updated = datetime.now(timezone.utc).isoformat()
        self.error = None

    def set_error(self, msg: str) -> None:
        self.error = msg

    def read(self) -> dict:
        return {
            "data": self.data,
            "last_updated": self.last_updated,
            "error": self.error,
        }


cache = CachedState()

# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class BenchmarkOption(BaseModel):
    instrument: str
    strike: float
    delta: float
    mark_iv: float


class ExpirySkew(BaseModel):
    expiry: str
    expiry_timestamp: int
    days_to_expiry: int
    benchmark_call: BenchmarkOption | None
    benchmark_put: BenchmarkOption | None
    skew: float | None  # call_iv - put_iv


class SentimentPayload(BaseModel):
    dvol: float | None
    dvol_label: str | None
    nearest_skew: float | None
    nearest_expiry: str | None
    skews: list[ExpirySkew]
    btc_price: float | None


class SentimentResponse(BaseModel):
    data: SentimentPayload | None
    last_updated: str | None
    error: str | None


# ---------------------------------------------------------------------------
# Deribit data fetching (async)
# ---------------------------------------------------------------------------


async def fetch_json(session: aiohttp.ClientSession, url: str, params: dict) -> dict:
    """Generic async JSON fetcher with error handling."""
    try:
        async with session.get(
            url, params=params, timeout=aiohttp.ClientTimeout(total=15)
        ) as resp:
            resp.raise_for_status()
            body = await resp.json()
            if "result" not in body:
                raise ValueError(f"Deribit API error: {body.get('error', body)}")
            return body["result"]
    except Exception as exc:
        log.error("fetch_json failed for %s: %s", url, exc)
        raise


async def fetch_book_summary(session: aiohttp.ClientSession) -> list[dict]:
    """Fetch full BTC option surface from Deribit."""
    return await fetch_json(
        session, BOOK_SUMMARY_URL, {"currency": "BTC", "kind": "option"}
    )


async def fetch_dvol(session: aiohttp.ClientSession) -> float:
    """Fetch the DVOL (Deribit Volatility Index) for BTC via btcdvol_usdc index."""
    data = await fetch_json(
        session, DVOL_INDEX_URL, {"index_name": "btcdvol_usdc"}
    )
    return data.get("index_price", 0.0)


async def fetch_btc_price(session: aiohttp.ClientSession) -> float:
    """Fetch the current BTC index price."""
    data = await fetch_json(
        session, DVOL_INDEX_URL, {"index_name": "btc_usd"}
    )
    return data.get("index_price", 0.0)


async def fetch_ticker(
    session: aiohttp.ClientSession,
    instrument_name: str,
    semaphore: asyncio.Semaphore,
) -> dict | None:
    """Fetch ticker for a single instrument (includes greeks). Rate-limited."""
    async with semaphore:
        try:
            return await fetch_json(
                session, TICKER_URL, {"instrument_name": instrument_name}
            )
        except Exception:
            return None


# ---------------------------------------------------------------------------
# Helper: approximate delta from book_summary data (used only for candidate
# selection — the final delta reported comes from Deribit's ticker endpoint).
# ---------------------------------------------------------------------------


def _approx_delta(
    strike: float,
    underlying: float,
    mark_iv_pct: float,
    years_to_expiry: float,
    is_call: bool,
) -> float:
    """
    Black-Scholes delta approximation using Deribit's mark_iv.
    Only used to narrow down which instruments are near 25-delta
    so we can fetch their exact greeks from the ticker endpoint.
    """
    if underlying <= 0 or strike <= 0 or mark_iv_pct <= 0 or years_to_expiry <= 0:
        return 0.0
    sigma = mark_iv_pct / 100.0
    sqrt_t = math.sqrt(years_to_expiry)
    d1 = (math.log(underlying / strike) + 0.5 * sigma * sigma * years_to_expiry) / (
        sigma * sqrt_t
    )
    if is_call:
        return _PHI(d1)
    else:
        return _PHI(d1) - 1.0


# ---------------------------------------------------------------------------
# Skew calculation ("Delta Hunt") — two-phase approach
# ---------------------------------------------------------------------------


def parse_expiry(instrument_name: str) -> str:
    """Extract expiry string from instrument name like 'BTC-28JUN25-100000-C'."""
    parts = instrument_name.split("-")
    return parts[1] if len(parts) >= 2 else "UNKNOWN"


def _select_candidates(raw_instruments: list[dict]) -> dict[str, dict]:
    """
    Phase 1: From the book_summary data (no greeks), use approximate delta
    to pick the best 3 candidate calls and 3 candidate puts per expiry.
    Returns {instrument_name: summary_data} for only the candidates.
    """
    now_ms = datetime.now(timezone.utc).timestamp() * 1000

    rows = []
    for inst in raw_instruments:
        instrument_name = inst.get("instrument_name", "")
        if not instrument_name:
            continue

        parts = instrument_name.split("-")
        if len(parts) < 4:
            continue

        expiry_str = parts[1]
        strike = float(parts[2]) if parts[2].replace(".", "").isdigit() else 0
        option_type = parts[3]  # C or P
        mark_iv = inst.get("mark_iv")
        underlying = inst.get("underlying_price", 0)

        if not mark_iv or mark_iv <= 0 or not underlying or underlying <= 0:
            continue

        # Compute approximate time to expiry from the instrument data
        # We'll get the real expiry timestamp from the ticker later
        # Use a rough estimate: parse expiry string
        rows.append(
            {
                "instrument": instrument_name,
                "expiry": expiry_str,
                "strike": strike,
                "option_type": option_type,
                "mark_iv": mark_iv,
                "underlying": underlying,
            }
        )

    if not rows:
        return {}

    df = pd.DataFrame(rows)

    # We need time to expiry. Estimate from expiry string.
    # Deribit format: DDMMMYY (e.g. "28JUN25", "6FEB26")
    def _parse_expiry_date(s: str) -> float:
        """Returns years to expiry (approximate)."""
        import re
        from datetime import datetime as dt

        months = {
            "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
            "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
        }
        m = re.match(r"(\d{1,2})([A-Z]{3})(\d{2})", s)
        if not m:
            return 0.0
        day, mon, yr = int(m.group(1)), months.get(m.group(2), 1), 2000 + int(m.group(3))
        try:
            exp_dt = dt(yr, mon, day, 8, 0, 0, tzinfo=timezone.utc)  # 08:00 UTC expiry
            diff = (exp_dt - dt.now(timezone.utc)).total_seconds()
            return max(diff / (365.25 * 86400), 1 / (365.25 * 24))  # min 1 hour
        except ValueError:
            return 0.0

    df["years_to_expiry"] = df["expiry"].apply(_parse_expiry_date)
    df = df[df["years_to_expiry"] > 0].copy()

    # Compute approximate delta
    df["approx_delta"] = df.apply(
        lambda r: _approx_delta(
            r["strike"], r["underlying"], r["mark_iv"], r["years_to_expiry"], r["option_type"] == "C"
        ),
        axis=1,
    )

    # For calls: find closest to +0.25
    # For puts: find closest to -0.25
    candidates = {}

    for expiry, group in df.groupby("expiry"):
        calls = group[group["option_type"] == "C"].copy()
        puts = group[group["option_type"] == "P"].copy()

        if not calls.empty:
            calls["dist"] = (calls["approx_delta"] - TARGET_DELTA).abs()
            top_calls = calls.nsmallest(3, "dist")
            for _, row in top_calls.iterrows():
                candidates[row["instrument"]] = row.to_dict()

        if not puts.empty:
            puts["dist"] = (puts["approx_delta"] - (-TARGET_DELTA)).abs()
            top_puts = puts.nsmallest(3, "dist")
            for _, row in top_puts.iterrows():
                candidates[row["instrument"]] = row.to_dict()

    return candidates


async def fetch_candidate_greeks(
    session: aiohttp.ClientSession, candidate_names: list[str]
) -> dict[str, dict]:
    """
    Phase 2: Fetch ticker (with greeks) for each candidate instrument.
    Uses a semaphore to respect rate limits.
    """
    semaphore = asyncio.Semaphore(15)  # max 15 concurrent requests
    tasks = [
        fetch_ticker(session, name, semaphore)
        for name in candidate_names
    ]
    results = await asyncio.gather(*tasks)

    ticker_map = {}
    for result in results:
        if result and result.get("greeks"):
            ticker_map[result["instrument_name"]] = result
    return ticker_map


def build_skew_table(
    ticker_map: dict[str, dict], candidate_info: dict[str, dict]
) -> list[ExpirySkew]:
    """
    Phase 3: From the ticker data (with real greeks), pick the actual
    25-delta call and put per expiry and compute skew.
    """
    now_ts = datetime.now(timezone.utc).timestamp() * 1000

    # Group ticker results by expiry
    from collections import defaultdict

    by_expiry: dict[str, list[dict]] = defaultdict(list)

    for name, ticker in ticker_map.items():
        greeks = ticker.get("greeks", {})
        delta = greeks.get("delta")
        mark_iv = ticker.get("mark_iv")
        if delta is None or mark_iv is None:
            continue

        parts = name.split("-")
        if len(parts) < 4:
            continue

        expiry = parts[1]
        strike = float(parts[2]) if parts[2].replace(".", "").isdigit() else 0
        option_type = parts[3]

        by_expiry[expiry].append(
            {
                "instrument": name,
                "expiry": expiry,
                "strike": strike,
                "option_type": option_type,
                "delta": delta,
                "mark_iv": mark_iv,
                "underlying_price": ticker.get("underlying_price", 0),
            }
        )

    results: list[ExpirySkew] = []

    for expiry, instruments in by_expiry.items():
        calls = [i for i in instruments if i["option_type"] == "C"]
        puts = [i for i in instruments if i["option_type"] == "P"]

        bench_call: BenchmarkOption | None = None
        bench_put: BenchmarkOption | None = None
        skew_val: float | None = None

        # Find call closest to +0.25 delta
        if calls:
            best = min(calls, key=lambda c: abs(c["delta"] - TARGET_DELTA))
            bench_call = BenchmarkOption(
                instrument=best["instrument"],
                strike=best["strike"],
                delta=round(best["delta"], 4),
                mark_iv=round(best["mark_iv"], 2),
            )

        # Find put closest to -0.25 delta
        if puts:
            best = min(puts, key=lambda p: abs(p["delta"] - (-TARGET_DELTA)))
            bench_put = BenchmarkOption(
                instrument=best["instrument"],
                strike=best["strike"],
                delta=round(best["delta"], 4),
                mark_iv=round(best["mark_iv"], 2),
            )

        # Compute skew
        if bench_call and bench_put:
            skew_val = round(bench_call.mark_iv - bench_put.mark_iv, 2)

        # Compute DTE from the expiry string
        import re

        months = {
            "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
            "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
        }
        m = re.match(r"(\d{1,2})([A-Z]{3})(\d{2})", expiry)
        if m:
            from datetime import datetime as dt

            day = int(m.group(1))
            mon = months.get(m.group(2), 1)
            yr = 2000 + int(m.group(3))
            try:
                exp_dt = dt(yr, mon, day, 8, 0, 0, tzinfo=timezone.utc)
                exp_ts = int(exp_dt.timestamp() * 1000)
                dte = max(int((exp_ts - now_ts) / (1000 * 86400)), 0)
            except ValueError:
                exp_ts = 0
                dte = 0
        else:
            exp_ts = 0
            dte = 0

        results.append(
            ExpirySkew(
                expiry=expiry,
                expiry_timestamp=exp_ts,
                days_to_expiry=dte,
                benchmark_call=bench_call,
                benchmark_put=bench_put,
                skew=skew_val,
            )
        )

    # Sort by expiry_timestamp ascending (nearest first)
    results.sort(key=lambda x: x.expiry_timestamp)
    return results


def classify_dvol(dvol: float) -> str:
    if dvol < 45:
        return "Market Asleep"
    elif dvol > 70:
        return "Market Explosive"
    return "Normal Volatility"


# ---------------------------------------------------------------------------
# Background refresh loop
# ---------------------------------------------------------------------------


async def refresh_market_data() -> None:
    """Fetch, process, and cache sentiment data (two-phase delta hunt)."""
    log.info("Refreshing market data...")
    try:
        async with aiohttp.ClientSession() as session:
            # Phase 0: Fetch book_summary, DVOL, and BTC price concurrently
            raw_instruments, dvol, btc_price = await asyncio.gather(
                fetch_book_summary(session),
                fetch_dvol(session),
                fetch_btc_price(session),
                return_exceptions=True,
            )

            # Handle individual failures gracefully
            if isinstance(raw_instruments, BaseException):
                raise raw_instruments
            if isinstance(dvol, BaseException):
                log.warning("DVOL fetch failed, defaulting to 0: %s", dvol)
                dvol = 0.0
            if isinstance(btc_price, BaseException):
                log.warning("BTC price fetch failed, defaulting to 0: %s", btc_price)
                btc_price = 0.0

            log.info(
                "Phase 0: Fetched %d instruments, DVOL=%.1f, BTC=$%.0f",
                len(raw_instruments), dvol, btc_price,
            )

            # Phase 1: Select ~3 candidate instruments per side per expiry
            candidates = _select_candidates(raw_instruments)
            log.info("Phase 1: Selected %d candidate instruments", len(candidates))

            if not candidates:
                log.warning("No candidates found — market data may be stale")
                cache.set(
                    SentimentPayload(
                        dvol=round(dvol, 2),
                        dvol_label=classify_dvol(dvol),
                        nearest_skew=None,
                        nearest_expiry=None,
                        skews=[],
                        btc_price=round(btc_price, 2),
                    ).model_dump()
                )
                return

            # Phase 2: Fetch greeks for candidates via ticker endpoint
            ticker_map = await fetch_candidate_greeks(session, list(candidates.keys()))
            log.info("Phase 2: Got greeks for %d instruments", len(ticker_map))

            # Phase 3: Build the skew table
            skews = build_skew_table(ticker_map, candidates)

        # Find nearest expiry skew
        nearest_skew: float | None = None
        nearest_expiry: str | None = None
        for s in skews:
            if s.skew is not None:
                nearest_skew = s.skew
                nearest_expiry = s.expiry
                break

        payload = SentimentPayload(
            dvol=round(dvol, 2),
            dvol_label=classify_dvol(dvol),
            nearest_skew=nearest_skew,
            nearest_expiry=nearest_expiry,
            skews=skews,
            btc_price=round(btc_price, 2),
        )

        cache.set(payload.model_dump())
        log.info(
            "Cache updated — %d expiries, nearest skew: %s",
            len(skews), nearest_skew,
        )

    except Exception as exc:
        log.exception("refresh_market_data failed: %s", exc)
        cache.set_error(str(exc))


async def background_loop() -> None:
    """Runs forever, refreshing data every FETCH_INTERVAL_SECONDS."""
    while True:
        await refresh_market_data()
        await asyncio.sleep(FETCH_INTERVAL_SECONDS)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background task on startup, cancel on shutdown."""
    task = asyncio.create_task(background_loop())
    log.info("Background data loop started (interval=%ds)", FETCH_INTERVAL_SECONDS)
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        log.info("Background loop cancelled.")


app = FastAPI(
    title="Volatility Sentiment Engine",
    description="BTC option-skew sentiment from Deribit",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/sentiment", response_model=SentimentResponse)
async def get_sentiment():
    """
    Returns the latest cached sentiment data.
    Data is refreshed in the background every 60 seconds.
    """
    return cache.read()


@app.get("/health")
async def health():
    return {"status": "ok", "has_data": cache.data is not None}
