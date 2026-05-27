from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, Text, JSON
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class TranscriptChunkDB(Base):
    __tablename__ = "transcript_chunks"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    airport_code = Column(String(10), index=True)
    feed_url = Column(String(500))
    raw_text = Column(Text)
    duration_seconds = Column(Integer)


class AnalysisResultDB(Base):
    __tablename__ = "analysis_results"

    id = Column(Integer, primary_key=True, index=True)
    chunk_id = Column(Integer, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    airport_code = Column(String(10), index=True)
    transcript = Column(Text)
    assessable = Column(Boolean, default=True)
    assessable_confidence = Column(Float, default=1.0)
    is_standard = Column(Boolean)
    observations = Column(JSON)   # list of Observation dicts
    summary = Column(Text)
    confidence_score = Column(Float)
    enrichment = Column(JSON, nullable=True)  # speaker_segments, readback comparison, callsign clarity
    status = Column(String(20), default="new")  # new/under_review/confirmed/false_positive
    reviewer_notes = Column(Text, nullable=True)
    adsb_snapshot = Column(JSON, nullable=True)  # ADS-B aircraft captured at analysis time


class AppSettingsDB(Base):
    __tablename__ = "app_settings"

    # Single-row table, always pinned to id=1 by settings_store.
    id = Column(Integer, primary_key=True)
    data = Column(JSON)
    updated_at = Column(DateTime, default=datetime.utcnow)
