from __future__ import annotations


def require_positive(value: float, label: str) -> None:
    if value <= 0:
        raise ValueError(f"{label} must be positive")


def require_conversion(value: float) -> None:
    if not 0 < value < 1:
        raise ValueError("target conversion must satisfy 0 < X < 1")
