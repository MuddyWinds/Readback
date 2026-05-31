"""Pure-function tests for speech-weighted scoring and the hallucination heuristic.

These never load Whisper — they feed lightweight segment stand-ins to the pure
helpers extracted from transcribe().
"""

from dataclasses import dataclass

from backend.ingestion.transcriber import (
    score_segments,
    is_likely_hallucination,
    WORDS_PER_SPEECH_SECOND_MAX,
    NO_SPEECH_PROB_THRESHOLD,
)


@dataclass
class Seg:
    text: str
    avg_logprob: float
    no_speech_prob: float
    start: float
    end: float


def test_score_uses_speech_segments_only_for_text_and_words():
    # One real speech segment among two silence segments.
    segs = [
        Seg("  ", -1.8, 0.95, 0.0, 10.0),
        Seg("United 123 cleared to land", -0.2, 0.05, 10.0, 13.0),
        Seg("static noise garble", -1.9, 0.90, 13.0, 30.0),
    ]
    scored = score_segments(segs)
    assert scored["text"] == "United 123 cleared to land"
    assert scored["word_count"] == 5
    assert scored["has_speech"] is True
    # Confidence reflects the clear speech segment, not the silence.
    assert scored["stt_confidence"] > 0.7
    assert scored["speech_seconds"] == 3.0


def test_score_no_speech_when_all_segments_above_cutoff():
    segs = [
        Seg("noise", -1.9, NO_SPEECH_PROB_THRESHOLD, 0.0, 15.0),
        Seg("hiss", -1.8, 0.99, 15.0, 30.0),
    ]
    scored = score_segments(segs)
    assert scored["has_speech"] is False
    assert scored["text"] == ""
    assert scored["word_count"] == 0


def test_score_empty_segment_list():
    scored = score_segments([])
    assert scored["has_speech"] is False
    assert scored["text"] == ""
    assert scored["word_count"] == 0
    assert scored["stt_confidence"] == 0.0


def test_hallucination_flags_dense_words_over_short_speech():
    # 30 words in 1 second of speech = 30 wps, far over the cap.
    assert is_likely_hallucination(word_count=30, speech_seconds=1.0) is True


def test_hallucination_allows_normal_density():
    # 9 words over 4 seconds = 2.25 wps, normal ATC.
    assert is_likely_hallucination(word_count=9, speech_seconds=4.0) is False


def test_hallucination_floor_avoids_div_by_zero():
    # speech_seconds 0 -> denominator floored at 0.5; 2 words / 0.5 = 4 wps < cap.
    assert is_likely_hallucination(word_count=2, speech_seconds=0.0) is False
    # but 5 words / 0.5 = 10 wps > cap.
    assert is_likely_hallucination(word_count=5, speech_seconds=0.0) is True
    assert WORDS_PER_SPEECH_SECOND_MAX == 6.0
