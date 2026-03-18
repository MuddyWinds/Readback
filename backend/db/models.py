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
    is_compliant = Column(Boolean)
    violations = Column(JSON)   # list of Violation dicts
    summary = Column(Text)
    confidence_score = Column(Float)
