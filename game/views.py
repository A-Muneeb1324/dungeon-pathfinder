"""HTTP layer: the game page, a signed run token, and the high-score API.

Score verification (stateless, so it works on serverless):
  1. When a run starts, the browser asks for a token. The token is signed by
     the server and contains the start time and a unique run id.
  2. When the run ends, the browser submits the score together with the token.
  3. The server checks the signature, the run age, that the score is
     plausible for the time played, and that the run id was never used before.
This does not stop a determined cheater (the game runs in the browser), but it
blocks casual tampering, replays and absurd scores.
"""
import json
import time
import uuid

from django.core import signing
from django.db import IntegrityError
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .models import HighScore

SALT = "dungeon-run-v1"
TOKEN_MAX_AGE = 60 * 60 * 6        # a run must be submitted within 6 hours
MIN_RUN_SECONDS = 3                # faster than this is not a real run
MAX_SCORE_PER_SECOND = 40          # generous upper bound for a human player
MAX_SCORE_BASE = 200
MAX_NAME_LEN = 20
LEADERBOARD_SIZE = 10


def index(request):
    return render(request, "game/index.html")


@require_GET
def start_run(request):
    token = signing.dumps({"t": time.time(), "id": uuid.uuid4().hex}, salt=SALT)
    return JsonResponse({"token": token})


def _top_scores():
    return [
        {"player_name": s.player_name, "score": s.score, "floor": s.floor}
        for s in HighScore.objects.all()[:LEADERBOARD_SIZE]
    ]


def _error(message, status=400):
    return JsonResponse({"error": message}, status=status)


@csrf_exempt  # protected by the signed run token instead of a CSRF cookie
@require_http_methods(["GET", "POST"])
def scores(request):
    if request.method == "GET":
        return JsonResponse({"scores": _top_scores()})

    try:
        data = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return _error("Invalid JSON.")
    if not isinstance(data, dict):
        return _error("Invalid JSON.")

    name = str(data.get("player_name", "")).strip()[:MAX_NAME_LEN]
    if not name:
        return _error("Enter a name (1-20 characters).")

    try:
        score = int(data.get("score"))
        floor = int(data.get("floor", 1))
    except (TypeError, ValueError):
        return _error("Score and floor must be whole numbers.")
    if score < 0 or floor < 1:
        return _error("Score or floor out of range.")

    try:
        payload = signing.loads(str(data.get("token", "")), salt=SALT, max_age=TOKEN_MAX_AGE)
    except signing.BadSignature:
        return _error("This run could not be verified. Start a new run.", 403)

    elapsed = time.time() - float(payload["t"])
    if elapsed < MIN_RUN_SECONDS:
        return _error("Run was too short to be valid.", 403)
    if score > MAX_SCORE_BASE + MAX_SCORE_PER_SECOND * elapsed:
        return _error("Score is not plausible for the time played.", 403)

    try:
        HighScore.objects.create(player_name=name, score=score, floor=floor, run_id=payload["id"])
    except IntegrityError:
        return _error("This run was already submitted.", 409)

    return JsonResponse({"ok": True, "scores": _top_scores()}, status=201)
