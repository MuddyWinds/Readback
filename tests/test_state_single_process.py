"""state.py no longer holds the in-memory ADS-B snapshot dict."""

import backend.core.state as state


def test_adsb_snapshots_dict_removed():
    assert not hasattr(state, "adsb_snapshots")
