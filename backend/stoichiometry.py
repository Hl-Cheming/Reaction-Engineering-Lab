from __future__ import annotations


def concentration_a(
    ca0: float,
    conversion: float,
    *,
    phase: str = "liquid",
    epsilon: float = 0.0,
    pressure_ratio: float = 1.0,
    temperature_ratio: float = 1.0,
) -> float:
    """Concentration of A for liquid constant-density or ideal-gas variable volume."""
    if not 0.0 <= conversion < 1.0:
        raise ValueError("conversion must satisfy 0 <= X < 1")
    if phase == "liquid":
        return ca0 * (1.0 - conversion)
    denominator = 1.0 + epsilon * conversion
    if denominator <= 0:
        raise ValueError("1 + epsilon*X must be positive")
    return (
        ca0
        * (1.0 - conversion)
        / denominator
        * pressure_ratio
        * temperature_ratio
    )
