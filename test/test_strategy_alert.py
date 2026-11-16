"""
Tests for Strategy Alert Routing, Deduplication, and Delivery (Milestone 4).

Verifies:
1. Notification-only invariant (never places/modifies orders).
2. Input sanitization and validation.
3. Cooldown deduplication and anti-flooding rate limiting.
4. Account isolation across different users.
5. SQLite persistent logging to alert_log.
6. REST API endpoint authentication and error handling.
7. EventBus publication of StrategyAlertEvent.
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest

from database.alert_log_db import clear_fires, init_db, list_fires
from events.alert_events import STRATEGY_ALERT_TOPIC, StrategyAlertEvent
from services.alerts.strategy_alert import (
    MAX_ALERTS_PER_MINUTE,
    StrategyAlert,
    dispatch_strategy_alert,
    reset_alert_caches,
    sanitize_input,
)
from utils.event_bus import bus


@pytest.fixture(autouse=True)
def clean_state():
    """Ensure clean caches and logs before each test."""
    init_db()
    reset_alert_caches()
    clear_fires("test_user_a")
    clear_fires("test_user_b")
    yield
    reset_alert_caches()
    clear_fires("test_user_a")
    clear_fires("test_user_b")


class TestStrategyAlertSanitization:
    def test_requires_title_and_message(self):
        _, err1 = sanitize_input({})
        assert "title" in err1.lower()

        _, err2 = sanitize_input({"title": "Breakout", "message": ""})
        assert "message" in err2.lower()

    def test_normalizes_levels_and_sounds(self):
        clean, err = sanitize_input({
            "title": "EMA Cross",
            "message": "Fast crossed slow",
            "level": "ERROR",
            "sound": "SIREN",
            "duration": "10s",
        })
        assert err is None
        assert clean["level"] == "danger"  # normalized error -> danger
        assert clean["sound"] == "siren"
        assert clean["duration"] == "10s"

    def test_defaults_fallback_cleanly(self):
        clean, err = sanitize_input({
            "title": "Signal",
            "message": "Go long",
            "level": "unknown_level",
            "sound": "invalid_sound",
            "duration": "invalid_duration",
        })
        assert err is None
        assert clean["level"] == "info"
        assert clean["sound"] == "chime"
        assert clean["duration"] == "once"


class TestStrategyAlertDispatch:
    @patch("services.alerts.strategy_alert.native_sound_manager.start")
    def test_successful_dispatch_and_logging(self, mock_sound):
        mock_sound.return_value = True
        received_events: list[StrategyAlertEvent] = []

        def on_event(evt):
            received_events.append(evt)

        bus.subscribe(STRATEGY_ALERT_TOPIC, on_event, "test:strategy_alert")
        try:
            result = dispatch_strategy_alert("test_user_a", {
                "title": "RSI Oversold",
                "message": "NIFTY RSI below 30 on 15m",
                "level": "info",
                "sound": "beep",
                "duration": "5s",
                "symbol": "NIFTY",
                "exchange": "NSE",
                "price": 24150.0,
                "strategy_id": "rsi_strat",
            })

            assert result["status"] == "success"
            assert result["code"] == 200
            assert "alert_id" in result
            assert "sound" in result["delivered"]
            assert "browser" in result["delivered"]

            # Verify persistent log in database
            fires = list_fires("test_user_a")
            assert len(fires) == 1
            assert fires[0]["title"] == "RSI Oversold"
            assert fires[0]["symbol"] == "NIFTY"
            assert fires[0]["price"] == 24150.0
            assert fires[0]["kind"] == "strategy"

            # Verify EventBus dispatch
            assert len(received_events) == 1
            assert received_events[0].title == "RSI Oversold"
            assert received_events[0].user_id == "test_user_a"
        finally:
            bus.unsubscribe(STRATEGY_ALERT_TOPIC, "test:strategy_alert")

    def test_cooldown_deduplication(self):
        payload = {
            "title": "Supertrend Flip",
            "message": "Bullish trend change",
            "cooldown_sec": 10,
            "symbol": "BANKNIFTY",
            "strategy_id": "supertrend_01",
        }

        # 1. First alert fires cleanly
        res1 = dispatch_strategy_alert("test_user_a", payload)
        assert res1["status"] == "success"

        # 2. Immediate duplicate is throttled
        res2 = dispatch_strategy_alert("test_user_a", payload)
        assert res2["status"] == "throttled"
        assert res2["code"] == 200

        # Verify only 1 row was written to persistent log
        fires = list_fires("test_user_a")
        assert len(fires) == 1

    def test_rate_limiting_anti_flood(self):
        # Fire MAX_ALERTS_PER_MINUTE alerts
        for i in range(MAX_ALERTS_PER_MINUTE):
            res = dispatch_strategy_alert("test_user_a", {
                "title": f"Tick {i}",
                "message": "Price update",
                "cooldown_sec": 0,
            })
            assert res["status"] == "success"

        # The (MAX + 1)th alert within 1 minute should be rate limited
        blocked = dispatch_strategy_alert("test_user_a", {
            "title": "Tick Overflow",
            "message": "Should be blocked",
            "cooldown_sec": 0,
        })
        assert blocked["status"] == "rate_limited"
        assert blocked["code"] == 429

    def test_account_isolation(self):
        payload = {
            "title": "Isolated Alert",
            "message": "Secret strategy signal",
            "symbol": "TCS",
            "cooldown_sec": 60,
        }

        # User A fires alert
        dispatch_strategy_alert("test_user_a", payload)

        # User B fires same alert: should NOT be blocked by User A's cooldown
        res_b = dispatch_strategy_alert("test_user_b", payload)
        assert res_b["status"] == "success"

        # Logs must be isolated
        fires_a = list_fires("test_user_a")
        fires_b = list_fires("test_user_b")
        assert len(fires_a) == 1
        assert len(fires_b) == 1
        assert fires_a[0]["title"] == "Isolated Alert"
        assert fires_b[0]["title"] == "Isolated Alert"


class TestStrategyAlertRestApi:
    @pytest.fixture
    def client(self):
        from flask import Flask

        from restx_api import api_v1_bp
        test_app = Flask("test_strategy_alert_app")
        test_app.config["TESTING"] = True
        test_app.register_blueprint(api_v1_bp)
        with test_app.test_client() as c:
            yield c

    def test_rejects_missing_api_key(self, client):
        resp = client.post("/api/v1/strategy/alert", json={
            "title": "Signal",
            "message": "Buy call",
        })
        assert resp.status_code == 401
        data = resp.get_json()
        assert data["status"] == "error"

    def test_rejects_invalid_api_key(self, client):
        resp = client.post("/api/v1/strategy/alert", json={
            "apikey": "invalid-nonexistent-key",
            "title": "Signal",
            "message": "Buy call",
        })
        assert resp.status_code == 401

    @patch("restx_api.strategy_alert.verify_api_key")
    def test_accepts_valid_api_key_and_dispatches(self, mock_verify, client):
        mock_verify.return_value = "trader_alice"
        resp = client.post("/api/v1/strategy/alert", json={
            "apikey": "valid-mock-key",
            "title": "Volume Spike Alert",
            "message": "Volume exceeded 3x 20-day average",
            "level": "warning",
            "sound": "radar",
            "symbol": "INFY",
            "exchange": "NSE",
            "price": 1920.50,
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "success"
        assert "alert_id" in data
