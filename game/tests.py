import json
import time

from django.core import signing
from django.test import TestCase
from django.urls import reverse

from .models import HighScore
from .views import SALT


def make_token(age_seconds=60, run_id="abc123"):
    return signing.dumps({"t": time.time() - age_seconds, "id": run_id}, salt=SALT)


class ScoreApiTests(TestCase):
    def post(self, **fields):
        return self.client.post(
            reverse("scores"), data=json.dumps(fields), content_type="application/json"
        )

    def test_index_renders(self):
        self.assertEqual(self.client.get(reverse("index")).status_code, 200)

    def test_start_run_returns_token(self):
        res = self.client.get(reverse("start_run"))
        self.assertEqual(res.status_code, 200)
        self.assertIn("token", res.json())

    def test_valid_score_is_saved(self):
        res = self.post(player_name="Aria", score=300, floor=2, token=make_token())
        self.assertEqual(res.status_code, 201)
        self.assertEqual(HighScore.objects.count(), 1)

    def test_bad_token_rejected(self):
        res = self.post(player_name="Aria", score=10, floor=1, token="nope")
        self.assertEqual(res.status_code, 403)

    def test_implausible_score_rejected(self):
        res = self.post(player_name="Cheat", score=999999, floor=1, token=make_token(age_seconds=30))
        self.assertEqual(res.status_code, 403)

    def test_too_short_run_rejected(self):
        res = self.post(player_name="Fast", score=10, floor=1, token=make_token(age_seconds=0))
        self.assertEqual(res.status_code, 403)

    def test_replay_rejected(self):
        token = make_token(run_id="same")
        self.assertEqual(self.post(player_name="A", score=50, floor=1, token=token).status_code, 201)
        self.assertEqual(self.post(player_name="A", score=50, floor=1, token=token).status_code, 409)

    def test_empty_name_rejected(self):
        res = self.post(player_name="  ", score=10, floor=1, token=make_token())
        self.assertEqual(res.status_code, 400)

    def test_leaderboard_sorted(self):
        HighScore.objects.create(player_name="low", score=10)
        HighScore.objects.create(player_name="high", score=500)
        scores = self.client.get(reverse("scores")).json()["scores"]
        self.assertEqual([s["player_name"] for s in scores], ["high", "low"])
