from __future__ import annotations

from dataclasses import dataclass
from math import log


@dataclass(frozen=True)
class FirstOrderResult:
    reactor: str
    size: float
    unit: str
    conversion: float


def br_first_order(k: float, conversion: float) -> FirstOrderResult:
    return FirstOrderResult("BR", -log(1.0 - conversion) / k, "s", conversion)


def cstr_first_order(
    k: float, conversion: float, volumetric_flow: float
) -> FirstOrderResult:
    volume = volumetric_flow * conversion / (k * (1.0 - conversion))
    return FirstOrderResult("CSTR", volume, "L", conversion)


def pfr_first_order(
    k: float, conversion: float, volumetric_flow: float
) -> FirstOrderResult:
    volume = volumetric_flow * -log(1.0 - conversion) / k
    return FirstOrderResult("PFR", volume, "L", conversion)


def cstr_conversion(k: float, space_time: float) -> float:
    da = k * space_time
    return da / (1.0 + da)


def pfr_conversion(k: float, space_time: float) -> float:
    from math import exp

    return 1.0 - exp(-k * space_time)
