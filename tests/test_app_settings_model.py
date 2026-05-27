"""The app_settings table is a single JSON-bearing row."""

from backend.db.models import AppSettingsDB, Base


def test_app_settings_table_registered_with_json_data_column():
    table = Base.metadata.tables["app_settings"]
    assert AppSettingsDB.__tablename__ == "app_settings"
    assert "data" in table.columns
    assert "updated_at" in table.columns
    assert table.columns["id"].primary_key is True
