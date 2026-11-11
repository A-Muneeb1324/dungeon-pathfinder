from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="HighScore",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("player_name", models.CharField(max_length=100)),
                ("score", models.IntegerField()),
                ("floor", models.PositiveIntegerField(default=1)),
                ("run_id", models.CharField(blank=True, max_length=32, null=True, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["-score", "created_at"]},
        ),
    ]
