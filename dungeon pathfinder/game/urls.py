from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("api/run/start/", views.start_run, name="start_run"),
    path("api/scores/", views.scores, name="scores"),
]
