"""
Strategy Alert REST API: Allows Python strategies and external algorithms
to post notification-only alerts into OpenAlgo.

Mounted at ``/api/v1/strategy/alert``.

Authentication:
- API key in body (``{"apikey": "..."}``) or ``X-API-KEY`` header.
- Account-isolated: resolved to the key's user account.
"""

from __future__ import annotations

from flask import jsonify, make_response, request
from flask_restx import Namespace, Resource, fields

from database.auth_db import verify_api_key
from limiter import limiter
from services.alerts.strategy_alert import dispatch_strategy_alert
from utils.logging import get_logger

logger = get_logger(__name__)

api = Namespace("strategy_alert", description="Strategy Alert Notification API")

strategy_alert_model = api.model(
    "StrategyAlertRequest",
    {
        "apikey": fields.String(required=False, description="OpenAlgo API key"),
        "title": fields.String(required=True, description="Alert title / subject"),
        "message": fields.String(required=True, description="Alert message body"),
        "level": fields.String(
            default="info",
            description="Alert severity: info, warning, danger, success",
        ),
        "sound": fields.String(
            default="chime",
            description="Sound preset: chime, siren, radar, beep, synth, bell, ding",
        ),
        "duration": fields.String(
            default="once",
            description="Playback duration: once, 3s, 5s, 10s, 15s, 30s, untilDismissed, continuous",
        ),
        "symbol": fields.String(default="", description="Trading symbol (e.g. NIFTY)"),
        "exchange": fields.String(default="", description="Exchange (e.g. NSE)"),
        "price": fields.Float(description="Price level when alert triggered"),
        "channels": fields.List(
            fields.String,
            description="Target channels: browser, sound, desktop, telegram, discord, slack, whatsapp",
        ),
        "cooldown_sec": fields.Integer(
            default=0,
            description="Cooldown period in seconds to throttle duplicate alerts",
        ),
        "strategy_id": fields.String(description="Strategy identifier"),
        "dedup_key": fields.String(description="Optional custom deduplication key"),
    },
)


class StrategyAlertResource(Resource):
    @limiter.limit("60 per minute")
    @api.doc(security="apikey")
    @api.expect(strategy_alert_model)
    def post(self):
        """Send a notification-only alert from a strategy."""
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return make_response(
                jsonify({"status": "error", "message": "Request must be a JSON object"}),
                400,
            )

        api_key = data.get("apikey") or request.headers.get("X-API-KEY")
        if not isinstance(api_key, str) or not api_key:
            return make_response(
                jsonify({"status": "error", "message": "Invalid or missing API key"}),
                401,
            )

        user_id = verify_api_key(api_key)
        if not user_id:
            return make_response(
                jsonify({"status": "error", "message": "Invalid or missing API key"}),
                401,
            )

        result = dispatch_strategy_alert(user_id, data)
        code = result.pop("code", 200)
        return make_response(jsonify(result), code)


api.route("", strict_slashes=False)(StrategyAlertResource)
