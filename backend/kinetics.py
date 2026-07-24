from __future__ import annotations

from math import exp

R = 8.314462618


def arrhenius_from_reference(
    k_ref: float, temperature: float, ref_temperature: float, activation_energy: float
) -> float:
    """Return k(T) from a known k at T_ref."""
    return k_ref * exp(
        -activation_energy / R * (1.0 / temperature - 1.0 / ref_temperature)
    )


def power_law_rate(k: float, concentration: float, order: float) -> float:
    """Return the positive disappearance-rate magnitude -r_A."""
    return k * max(concentration, 0.0) ** order
