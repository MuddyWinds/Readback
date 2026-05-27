"""ADS-B snapshots persist on the result row and survive a fresh DB session."""

from backend.db.models import AnalysisResultDB


def test_model_has_adsb_snapshot_column():
    assert "adsb_snapshot" in AnalysisResultDB.__table__.columns
