"""Tests for transmission segmentation + transcript distillation.

These are the upstream "distill the text" steps: a fixed audio window is split
into individual radio transmissions on real silence gaps (so unrelated aircraft
land in separate cards, while an instruction and its immediate read-back stay
together), and Whisper's repeated-phrase loop artifacts are collapsed.
"""

from backend.ingestion.segmentation import distill_text, group_transmissions


def seg(text, start, end, avg_logprob=-0.2, no_speech_prob=0.1):
    return {
        "text": text, "start": start, "end": end,
        "avg_logprob": avg_logprob, "no_speech_prob": no_speech_prob,
    }


def test_group_splits_unrelated_transmissions_on_a_long_gap():
    segs = [
        seg("Malaysia 377 descend flight level 200", 0.0, 2.0),
        seg("flight level 200 Malaysia 377", 2.4, 3.8),     # immediate readback — same exchange
        seg("Air China 373 contact ground 121.8", 11.0, 13.0),  # different aircraft, 7s later
    ]
    groups = group_transmissions(segs, max_gap_seconds=2.5)
    assert len(groups) == 2
    assert "Malaysia 377" in groups[0]["text"] and "flight level 200 Malaysia 377" in groups[0]["text"]
    assert groups[1]["text"] == "Air China 373 contact ground 121.8"


def test_group_carries_per_transmission_quality_metrics():
    segs = [
        seg("United 12 cleared to land 28R", 0.0, 2.0, avg_logprob=-0.1, no_speech_prob=0.05),
        seg("clear to land 28R United 12", 2.2, 3.5, avg_logprob=-0.3, no_speech_prob=0.15),
    ]
    groups = group_transmissions(segs, max_gap_seconds=2.5)
    assert len(groups) == 1
    g = groups[0]
    # Averaged across the grouped segments, not the whole window.
    assert abs(g["avg_logprob"] - (-0.2)) < 1e-9
    assert abs(g["no_speech_prob"] - 0.10) < 1e-9
    assert g["start"] == 0.0 and g["end"] == 3.5


def test_group_handles_empty():
    assert group_transmissions([], max_gap_seconds=2.5) == []


def test_distill_collapses_repeated_phrase_loops():
    # Classic faster-whisper hallucination loop seen on degraded ATC audio.
    text = ("China 960, C-2-SID, level 1-3-0. China 960, C-2-SID, level 1-3-0. "
            "China 960, C-2-SID, level 1-3-0. China 960, C-2-SID, level 1-3-0.")
    assert distill_text(text) == "China 960, C-2-SID, level 1-3-0."


def test_distill_preserves_distinct_sentences():
    text = "Malaysia 377 descend flight level 200. Air China 373 contact ground."
    assert distill_text(text) == "Malaysia 377 descend flight level 200. Air China 373 contact ground."


def test_distill_is_whitespace_safe_and_handles_empty():
    assert distill_text("   ") == ""
    assert distill_text("  Cathay   250   contact tower  ") == "Cathay 250 contact tower"
