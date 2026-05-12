"""
MailerLite Proxy — Cloud Run service
Proxies subscriber creation to MailerLite API, keeping the API key server-side.
"""

import os
import time
import re
import json
import logging
from collections import defaultdict
from flask import Flask, request, jsonify

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# ─── Config ────────────────────────────────────────────────
ML_API_KEY = os.environ.get("MAILERLITE_API_KEY", "")
ML_API_URL = "https://connect.mailerlite.com/api/subscribers"

# Rate limiting: max 5 requests per minute per IP
rate_store: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW = 60  # seconds

# Group slug → MailerLite group ID (hardcoded server-side mapping)
GROUP_MAP = {
    "playbook":  "186325633265042550",
    "flowchart":  "186325706890806816",
    "challenge":  "186325707504224152",
    "audit":      "186325707984471239",
    "articles newsletter subscribers": "184146703705704286",
    "contact": "184146703705704286",  # contact form → Articles Newsletter Subscribers
}

ALLOWED_SLUGS = set(GROUP_MAP.keys())

# ─── Helpers ───────────────────────────────────────────────
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

def is_rate_limited(ip: str) -> bool:
    """Check if IP has exceeded 5 req/min. Returns True if limited."""
    now = time.time()
    # Prune old timestamps
    rate_store[ip] = [t for t in rate_store[ip] if now - t < RATE_LIMIT_WINDOW]
    if len(rate_store[ip]) >= RATE_LIMIT_MAX:
        return True
    rate_store[ip].append(now)
    return False

def validate_payload(data: dict) -> str | None:
    """Return error string if invalid, None if ok."""
    if not data:
        return "Empty request body"

    email = (data.get("email") or "").strip()
    if not email:
        return "Email is required"
    if not EMAIL_RE.match(email):
        return "Invalid email format"

    group = (data.get("group") or "").strip().lower()
    if not group:
        return "Group (funnel name) is required"
    if group not in ALLOWED_SLUGS:
        return f"Unknown funnel group: {group}"

    return None

def build_ml_payload(data: dict) -> dict:
    """Build the MailerLite subscriber payload from form data."""
    group_slug = data["group"].strip().lower()
    group_id = GROUP_MAP[group_slug]

    fields = {}
    # Map known fields
    for key in ("name", "company", "phone", "website", "message", "agent_count",
                "agent_types", "biggest_failure", "current_stack", "funnel"):
        val = data.get(key)
        if val and val.strip():
            fields[key] = val.strip()

    payload = {
        "email": data["email"].strip(),
        "groups": [group_id],
    }
    if fields:
        payload["fields"] = fields

    return payload

# ─── Routes ────────────────────────────────────────────────
@app.route("/api/subscribe", methods=["POST"])
def subscribe():
    """Proxy MailerLite subscriber creation."""
    # Rate limit check
    ip = request.headers.get("X-Forwarded-For", request.remote_addr) or "unknown"
    if is_rate_limited(ip):
        app.logger.warning(f"Rate limit exceeded for IP: {ip}")
        return jsonify({"success": False, "error": "Too many requests. Please wait a moment."}), 429

    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"success": False, "error": "Invalid JSON body"}), 400

    # Validate
    err = validate_payload(data)
    if err:
        app.logger.info(f"Validation failed: {err} — data={data}")
        return jsonify({"success": False, "error": err}), 422

    # Build MailerLite payload
    ml_payload = build_ml_payload(data)
    redirect_url = data.get("redirect", "").strip()

    app.logger.info(f"Proxying subscribe: email={data.get('email')}, group={data.get('group')}")

    # Call MailerLite
    try:
        import requests
        resp = requests.post(
            ML_API_URL,
            json=ml_payload,
            headers={
                "Authorization": f"Bearer {ML_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=15,
        )
        app.logger.info(f"MailerLite response: status={resp.status_code}")

        if resp.status_code in (200, 201):
            app.logger.info(f"Subscriber created: {data.get('email')} → group={data.get('group')}")
            return jsonify({
                "success": True,
                "redirect_url": redirect_url if redirect_url else None,
            })
        else:
            # Try to extract ML error message
            try:
                ml_err = resp.json()
                err_text = ml_err.get("message", resp.text[:200])
            except Exception:
                err_text = resp.text[:200]
            app.logger.error(f"MailerLite API error: {resp.status_code} — {err_text}")
            return jsonify({"success": False, "error": f"MailerLite error: {err_text}"}), 502

    except requests.exceptions.Timeout:
        app.logger.error("MailerLite API timeout")
        return jsonify({"success": False, "error": "Service timed out. Please try again."}), 504
    except requests.exceptions.ConnectionError:
        app.logger.error("MailerLite connection error")
        return jsonify({"success": False, "error": "Unable to reach email service. Please try again."}), 502
    except Exception as e:
        app.logger.error(f"Unexpected error: {e}")
        return jsonify({"success": False, "error": "Internal server error"}), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


# ─── CORS (allow all origins for public funnels) ───────────
@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response
