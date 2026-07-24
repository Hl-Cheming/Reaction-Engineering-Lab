from __future__ import annotations


def adiabatic_temperature(
    inlet_temperature: float, heat_of_reaction: float, heat_capacity_flow: float, conversion: float
) -> float:
    """Reserved P2 interface: T = T0 + (-delta_H/Cp0)X."""
    if heat_capacity_flow <= 0:
        raise ValueError("heat_capacity_flow must be positive")
    return inlet_temperature + (-heat_of_reaction / heat_capacity_flow) * conversion
