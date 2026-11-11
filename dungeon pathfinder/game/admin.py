from django.contrib import admin

from .models import HighScore


@admin.register(HighScore)
class HighScoreAdmin(admin.ModelAdmin):
    list_display = ("player_name", "score", "floor", "created_at")
    ordering = ("-score",)
    search_fields = ("player_name",)
