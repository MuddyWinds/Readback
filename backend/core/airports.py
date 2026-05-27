from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "airports.json"


@lru_cache(maxsize=1)
def _load() -> dict:
    try:
        with open(_DATA_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def resolve_airport(code: str) -> Optional[dict]:
    if not code:
        return None
    return _load().get(code.upper())


def airport_geo(code: str) -> Optional[tuple[float, float]]:
    info = resolve_airport(code)
    if info and info.get("lat") is not None and info.get("lon") is not None:
        return (info["lat"], info["lon"])
    return None


def suggest_airport_code(url: str) -> str:
    segment = url.rstrip("/").split("/")[-1]
    alpha = re.match(r"[A-Za-z]+", segment)
    return alpha.group(0).upper()[:4] if alpha else ""
