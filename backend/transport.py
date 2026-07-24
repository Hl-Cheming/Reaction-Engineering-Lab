from __future__ import annotations

from math import sqrt


def pressure_ratio(weight: float, alpha: float) -> float:
    """Simplified isothermal PBR relation p = sqrt(1-alpha*W)."""
    boundary = 1.0 - alpha * weight
    if boundary <= 0:
        raise ValueError("pressure-drop model invalid: 1-alpha*W <= 0")
    return sqrt(boundary)
