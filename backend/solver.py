from __future__ import annotations

from dataclasses import dataclass
from math import isfinite

from .kinetics import arrhenius_from_reference, power_law_rate
from .stoichiometry import concentration_a


@dataclass(frozen=True)
class SolverInput:
    reactor: str
    phase: str
    solve_for: str
    target_x: float
    size: float
    order: float
    k_ref: float
    temperature: float
    ref_temperature: float
    activation_energy: float
    ca0: float
    fa0: float
    epsilon: float = 0.0
    pressure_drop: bool = False
    alpha: float = 0.03


def _validate(data: SolverInput) -> None:
    if data.reactor not in {"BR", "CSTR", "PFR", "PBR"}:
        raise ValueError("reactor must be BR, CSTR, PFR or PBR")
    if data.phase not in {"liquid", "gas"}:
        raise ValueError("phase must be liquid or gas")
    if data.solve_for not in {"target", "size"}:
        raise ValueError("solve_for must be target or size")
    if not 0 < data.target_x < 0.999999:
        raise ValueError("target_x must satisfy 0 < X < 0.999999")
    if data.solve_for == "size" and data.size <= 0:
        raise ValueError("size must be positive")
    if not 0 <= data.order <= 4:
        raise ValueError("order must be between 0 and 4")
    for value, name in (
        (data.k_ref, "k_ref"),
        (data.temperature, "temperature"),
        (data.ref_temperature, "ref_temperature"),
        (data.ca0, "ca0"),
        (data.fa0, "fa0"),
    ):
        if not isfinite(value) or value <= 0:
            raise ValueError(f"{name} must be positive")
    if 1 + data.epsilon * data.target_x <= 0:
        raise ValueError("1 + epsilon*X must be positive")
    if data.pressure_drop and data.alpha <= 0:
        raise ValueError("alpha must be positive when pressure drop is enabled")


def _rate(x: float, p: float, data: SolverInput, k: float) -> float:
    ca = concentration_a(
        data.ca0,
        min(max(x, 0.0), 0.999999),
        phase=data.phase,
        epsilon=data.epsilon,
        pressure_ratio=max(p, 1e-10),
    )
    return power_law_rate(k, ca, data.order)


def _simpson(function, end: float, steps: int = 2000) -> float:
    h = end / steps
    total = function(0.0) + function(end)
    for index in range(1, steps):
        total += (2 if index % 2 == 0 else 4) * function(index * h)
    return total * h / 3


def _pbr_step(x: float, p: float, step: float, data: SolverInput, k: float) -> tuple[float, float]:
    def derivative(x_value: float, p_value: float) -> tuple[float, float]:
        safe_p = max(p_value, 1e-8)
        flow_ratio = 1 + data.epsilon * x_value if data.phase == "gas" else 1
        return _rate(x_value, safe_p, data, k) / data.fa0, -data.alpha * flow_ratio / (2 * safe_p)

    x1, p1 = derivative(x, p)
    x2, p2 = derivative(x + step * x1 / 2, p + step * p1 / 2)
    x3, p3 = derivative(x + step * x2 / 2, p + step * p2 / 2)
    x4, p4 = derivative(x + step * x3, p + step * p3)
    return (
        x + step * (x1 + 2 * x2 + 2 * x3 + x4) / 6,
        p + step * (p1 + 2 * p2 + 2 * p3 + p4) / 6,
    )


def _size_for_x(target_x: float, data: SolverInput, k: float) -> tuple[float, float]:
    if data.reactor == "BR":
        size = _simpson(lambda x: data.ca0 / max(_rate(x, 1, data, k), 1e-12), target_x)
        return size, 1.0
    if data.reactor == "CSTR":
        return data.fa0 * target_x / max(_rate(target_x, 1, data, k), 1e-12), 1.0
    if data.reactor == "PFR" or not data.pressure_drop:
        return data.fa0 * _simpson(lambda x: 1 / max(_rate(x, 1, data, k), 1e-12), target_x), 1.0

    maximum = 0.999 / (data.alpha * max(1.0, 1 + max(0.0, data.epsilon)))
    step = maximum / 30_000
    x, p, weight = 0.0, 1.0, 0.0
    while x < target_x and weight < maximum and p > 0.02:
        x, p = _pbr_step(x, p, step, data, k)
        weight += step
    if x < target_x or p <= 0:
        raise ValueError("target conversion is unreachable before the pressure model fails")
    return weight, p


def _x_for_size(size: float, data: SolverInput, k: float) -> float:
    low, high = 0.0, 0.999999
    for _ in range(70):
        middle = (low + high) / 2
        try:
            required, _ = _size_for_x(middle, data, k)
        except ValueError:
            high = middle
            continue
        if required < size:
            low = middle
        else:
            high = middle
    return (low + high) / 2


def solve(data: SolverInput) -> dict[str, float | str]:
    _validate(data)
    k = arrhenius_from_reference(data.k_ref, data.temperature, data.ref_temperature, data.activation_energy)
    outlet_x = data.target_x if data.solve_for == "target" else _x_for_size(data.size, data, k)
    scale, pressure_ratio = _size_for_x(outlet_x, data, k) if data.solve_for == "target" else (data.size, 1.0)
    if data.reactor == "PBR" and data.pressure_drop and data.solve_for == "size":
        _, pressure_ratio = _size_for_x(outlet_x, data, k)
    outlet_ca = concentration_a(data.ca0, outlet_x, phase=data.phase, epsilon=data.epsilon, pressure_ratio=pressure_ratio)
    return {
        "reactor": data.reactor,
        "scale": scale,
        "outlet_x": outlet_x,
        "outlet_ca": outlet_ca,
        "outlet_rate": power_law_rate(k, outlet_ca, data.order),
        "pressure_ratio": pressure_ratio,
        "k_at_temperature": k,
    }
