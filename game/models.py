from django.db import models


class HighScore(models.Model):
    player_name = models.CharField(max_length=100)
    score = models.IntegerField()
    floor = models.PositiveIntegerField(default=1)
    # Unique id of the run (taken from the signed start token). Stops the same
    # run from being submitted twice.
    run_id = models.CharField(max_length=32, unique=True, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-score", "created_at"]

    def __str__(self):
        return f"{self.player_name}: {self.score}"
