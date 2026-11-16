"""
Strategy Alert Engine & Backend Notification Delivery.

Allows Python strategies and backend evaluation modules to send
notification-only alerts into OpenAlgo's unified alert system.

Features:
- Authenticated & account-isolated routing.
- Sound selection and continuous ringing via NativeSoundManager.
- Works when the browser is closed (native sound + messaging webhooks).
- Input validation, cooldown deduplication, and anti-flooding rate limiting.
- Persistent logging to SQLite alert_log table.
- EventBus publication and Socket.IO emission to browser clients.
- STRICT INVARIANT: Notification-only; never executes or modifies trades.
"""

from __future__ import annotations

import os
import threading
import time
import uuid
from typing import Any

from database.alert_log_db import record_fire
from events.alert_events import StrategyAlertEvent
from services.alerts.native_sound import native_sound_manager
from services.alerts.notify import notify
from services.alerts.registry import get_webhook_channel
from utils.event_bus import bus
from utils.logging import get_logger

logger = get_logger(__name__)

# Rate limits and defaults
MAX_ALERTS_PER_MINUTE = 30
DEFAULT_COOLDOWN_SEC = 0
VALID_LEVELS = {"info", "warning", "danger", "error", "success"}
VALID_SOUNDS = {"chime", "siren", "radar", "beep", "synth", "bell", "ding"}
VALID_DURATIONS = {
    "once",
    "3s",
    "5s",
    "10s",
    "15s",
    "30s",
    "untilDismissed",
    "continuous",
}
VALID_CHANNELS = {
    "browser",
    "sound",
    "desktop",
    "telegram",
    "discord",
    "slack",
    "whatsapp",
}

# Thread-safe in-memory rate limiting and deduplication stores
_LOCK = threading.Lock()
_COOLDOWN_CACHE: dict[tuple[str, str], float] = {}
_RATE_LIMIT_CACHE: dict[str, list[float]] = {}


def reset_alert_caches() -> None:
    """Reset rate-limiting and deduplication caches (useful in tests)."""
    with _LOCK:
        _COOLDOWN_CACHE.clear()
        _RATE_LIMIT_CACHE.clear()


def check_rate_limit(user_id: str) -> bool:
    """Check if the user has exceeded the alert rate limit (sliding minute window)."""
    now = time.time()
    cutoff = now - 60.0
    with _LOCK:
        history = _RATE_LIMIT_CACHE.setdefault(user_id, [])
        # Prune older than 1 minute
        history[:] = [t for t in history if t > cutoff]
        if len(history) >= MAX_ALERTS_PER_MINUTE:
            return False
        history.append(now)
        return True


def check_cooldown(user_id: str, dedup_key: str, cooldown_sec: int) -> bool:
    """
    Returns True if the alert is allowed to fire.
    Returns False if throttled due to active cooldown.
    """
    if cooldown_sec <= 0:
        return True

    now = time.time()
    cache_key = (user_id, dedup_key)
    with _LOCK:
        last_fired = _COOLDOWN_CACHE.get(cache_key)
        if last_fired is not None and (now - last_fired) < cooldown_sec:
            return False
        _COOLDOWN_CACHE[cache_key] = now
        return True


def sanitize_input(data: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
    """Validate and sanitize alert parameters."""
    if not isinstance(data, dict):
        return {}, "Request payload must be a JSON object"

    title = str(data.get("title") or "").strip()
    if not title:
        return {}, "Alert 'title' is required"
    if len(title) > 200:
        title = title[:200]

    message = str(data.get("message") or "").strip()
    if not message:
        return {}, "Alert 'message' is required"
    if len(message) > 2000:
        message = message[:2000]

    level = str(data.get("level") or "info").lower().strip()
    if level == "error":
        level = "danger"
    if level not in VALID_LEVELS:
        level = "info"

    sound = str(data.get("sound") or "chime").lower().strip()
    if sound not in VALID_SOUNDS:
        sound = "chime"

    duration = str(data.get("duration") or "once").strip()
    if duration not in VALID_DURATIONS:
        duration = "once"

    symbol = str(data.get("symbol") or "").strip()[:60]
    exchange = str(data.get("exchange") or "").strip()[:20]

    raw_price = data.get("price")
    price: float | None = None
    if raw_price is not None:
        try:
            p = float(raw_price)
            if not (abs(p) == float("inf") or p != p):  # not inf or nan
                price = p
        except (ValueError, TypeError):
            price = None

    raw_channels = data.get("channels")
    if isinstance(raw_channels, (list, tuple)):
        channels = [
            str(c).lower().strip() for c in raw_channels if str(c).lower().strip() in VALID_CHANNELS
        ]
        if not channels:
            channels = ["browser", "sound"]
    else:
        channels = ["browser", "sound", "desktop"]

    try:
        cooldown_sec = max(0, min(86400, int(data.get("cooldown_sec") or 0)))
    except (ValueError, TypeError):
        cooldown_sec = DEFAULT_COOLDOWN_SEC

    strategy_id = str(data.get("strategy_id") or "").strip()[:64]
    dedup_key = str(data.get("dedup_key") or "").strip()
    if not dedup_key:
        dedup_key = f"{strategy_id}:{symbol}:{title}:{message[:50]}"

    return {
        "title": title,
        "message": message,
        "level": level,
        "sound": sound,
        "duration": duration,
        "symbol": symbol,
        "exchange": exchange,
        "price": price,
        "channels": channels,
        "cooldown_sec": cooldown_sec,
        "strategy_id": strategy_id,
        "dedup_key": dedup_key,
    }, None


def dispatch_strategy_alert(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """
    Main dispatch entry point for strategy alerts.

    Args:
        user_id: Authenticated user account identifier.
        data: Alert parameters.

    Returns:
        Result summary dict.
    """
    sanitized, error = sanitize_input(data)
    if error:
        return {"status": "error", "message": error, "code": 400}

    # 1. Anti-flood rate limiting
    if not check_rate_limit(user_id):
        logger.warning(f"Strategy alert suppressed for user {user_id}: Rate limit exceeded")
        return {
            "status": "rate_limited",
            "message": "Alert rate limit exceeded (maximum 30 alerts per minute).",
            "code": 429,
        }

    # 2. Cooldown deduplication
    if not check_cooldown(user_id, sanitized["dedup_key"], sanitized["cooldown_sec"]):
        logger.info(
            f"Strategy alert throttled for user {user_id} (cooldown {sanitized['cooldown_sec']}s active)"
        )
        return {
            "status": "throttled",
            "message": f"Alert throttled due to cooldown ({sanitized['cooldown_sec']}s active)",
            "alert_id": None,
            "code": 200,
        }

    alert_id = f"strat-{uuid.uuid4().hex[:12]}"
    now = time.time()
    delivered_channels: list[str] = []

    # 3. Native Windows Audio (works even when browser is closed)
    if "sound" in sanitized["channels"] or "desktop" in sanitized["channels"]:
        try:
            started = native_sound_manager.start(
                alert_id=alert_id,
                title=sanitized["title"],
                sound_name=sanitized["sound"],
                duration=sanitized["duration"],
            )
            if started:
                delivered_channels.append("sound")
        except Exception as exc:
            logger.warning(f"Native sound alert failed: {exc}")

    # 4. External messaging channels
    formatted_text = (
        f"🚨 [{sanitized['level'].upper()}] {sanitized['title']}\n"
        f"{sanitized['message']}\n"
        + (f"Symbol: {sanitized['symbol']} ({sanitized['exchange']})\n" if sanitized["symbol"] else "")
        + (f"Price: {sanitized['price']}\n" if sanitized["price"] is not None else "")
    )

    if "discord" in sanitized["channels"]:
        try:
            dc = get_webhook_channel("discord")
            if dc:
                res = notify(dc, formatted_text, wait=False, shorten=True)
                if res.ok:
                    delivered_channels.append("discord")
        except Exception as exc:
            logger.warning(f"Discord alert failed: {exc}")

    if "slack" in sanitized["channels"]:
        try:
            sc = get_webhook_channel("slack")
            if sc:
                res = notify(sc, formatted_text, wait=False, shorten=True)
                if res.ok:
                    delivered_channels.append("slack")
        except Exception as exc:
            logger.warning(f"Slack alert failed: {exc}")

    if "telegram" in sanitized["channels"]:
        try:
            from database.telegram_db import get_all_telegram_users
            from services.telegram_alert_service import telegram_alert_service

            recipients = [u for u in get_all_telegram_users() if u.get("notifications_enabled")]
            sent_any = False
            for user in recipients:
                if telegram_alert_service.send_alert(user["telegram_id"], formatted_text):
                    sent_any = True
            if sent_any:
                delivered_channels.append("telegram")
        except Exception as exc:
            logger.warning(f"Telegram alert failed: {exc}")

    if "whatsapp" in sanitized["channels"]:
        try:
            from services.whatsapp_alert_service import whatsapp_alert_service

            if whatsapp_alert_service.send_message(formatted_text):
                delivered_channels.append("whatsapp")
        except Exception as exc:
            logger.warning(f"WhatsApp alert failed: {exc}")

    if "browser" in sanitized["channels"]:
        delivered_channels.append("browser")

    # 5. Persistent SQLite logging
    fire_payload = {
        "alertId": alert_id,
        "title": sanitized["title"],
        "kind": "strategy",
        "condition": sanitized["level"],
        "symbol": sanitized["symbol"],
        "exchange": sanitized["exchange"],
        "interval": sanitized["strategy_id"],
        "price": sanitized["price"],
        "message": sanitized["message"],
    }
    record_fire(user_id, fire_payload, delivered=delivered_channels)

    # 6. Publish to EventBus
    event = StrategyAlertEvent(
        alert_id=alert_id,
        strategy_id=sanitized["strategy_id"],
        user_id=user_id,
        title=sanitized["title"],
        message=sanitized["message"],
        level=sanitized["level"],
        sound=sanitized["sound"],
        duration=sanitized["duration"],
        symbol=sanitized["symbol"],
        exchange=sanitized["exchange"],
        price=sanitized["price"],
        channels=sanitized["channels"],
        timestamp=now,
        delivered=delivered_channels,
    )
    bus.publish(event)

    return {
        "status": "success",
        "alert_id": alert_id,
        "delivered": delivered_channels,
        "code": 200,
    }


class StrategyAlert:
    """
    Convenience helper for Python strategies.

    Usage:
        from services.alerts.strategy_alert import StrategyAlert

        StrategyAlert.send(
            title="EMA 20/50 Crossover",
            message="NIFTY crossed 50 EMA bullishly",
            level="info",
            sound="chime",
            symbol="NIFTY",
            cooldown_sec=60
        )
    """

    @staticmethod
    def send(
        title: str,
        message: str,
        level: str = "info",
        sound: str = "chime",
        duration: str = "once",
        symbol: str = "",
        exchange: str = "",
        price: float | None = None,
        channels: list[str] | None = None,
        cooldown_sec: int = 0,
        strategy_id: str | None = None,
        dedup_key: str | None = None,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """Dispatch a notification alert from a Python strategy."""
        strat_id = strategy_id or os.environ.get("STRATEGY_ID", "")
        payload = {
            "title": title,
            "message": message,
            "level": level,
            "sound": sound,
            "duration": duration,
            "symbol": symbol,
            "exchange": exchange,
            "price": price,
            "channels": channels,
            "cooldown_sec": cooldown_sec,
            "strategy_id": strat_id,
            "dedup_key": dedup_key,
        }

        # Check if running as a subprocess with OPENALGO_HOST / OPENALGO_API_KEY
        host = os.environ.get("OPENALGO_HOST")
        api_key = os.environ.get("OPENALGO_API_KEY")

        if host and api_key:
            import json
            import urllib.error
            import urllib.request

            if not (host.startswith("http://") or host.startswith("https://")):
                logger.warning(f"StrategyAlert invalid host scheme: {host}")
                return {"status": "error", "message": "Invalid host scheme", "code": 400}

            payload["apikey"] = api_key
            url = f"{host.rstrip('/')}/api/v1/strategy/alert"
            data_bytes = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data_bytes,
                headers={"Content-Type": "application/json", "X-API-KEY": api_key},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:  # nosec B310
                    return json.loads(resp.read().decode("utf-8"))
            except Exception as exc:
                logger.warning(f"StrategyAlert HTTP dispatch failed: {exc}")
                return {"status": "error", "message": str(exc), "code": 500}

        # In-process execution fallback
        target_user = user_id or os.environ.get("OPENALGO_USER", "default_user")
        return dispatch_strategy_alert(target_user, payload)
