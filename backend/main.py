from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .kinetics import arrhenius_from_reference
from .reactors import br_first_order, cstr_first_order, pfr_first_order
from .validation import require_conversion, require_positive

app = FastAPI(
    title="Reaction Engineering Lab API",
    version="1.0.0",
    description="Teaching API for ideal, isothermal, single-reaction models.",
)


class FirstOrderRequest(BaseModel):
    reactor: str = Field(pattern="^(BR|CSTR|PFR)$")
    target_x: float
    k_ref: float
    temperature: float = 350.0
    ref_temperature: float = 350.0
    activation_energy: float = 52_000.0
    volumetric_flow: float = 0.5


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/first-order")
def first_order(request: FirstOrderRequest) -> dict[str, float | str]:
    try:
        require_conversion(request.target_x)
        require_positive(request.k_ref, "k_ref")
        require_positive(request.temperature, "temperature")
        k = arrhenius_from_reference(
            request.k_ref,
            request.temperature,
            request.ref_temperature,
            request.activation_energy,
        )
        if request.reactor == "BR":
            result = br_first_order(k, request.target_x)
        elif request.reactor == "CSTR":
            require_positive(request.volumetric_flow, "volumetric_flow")
            result = cstr_first_order(k, request.target_x, request.volumetric_flow)
        else:
            require_positive(request.volumetric_flow, "volumetric_flow")
            result = pfr_first_order(k, request.target_x, request.volumetric_flow)
        return {
            "reactor": result.reactor,
            "target_x": result.conversion,
            "size": result.size,
            "unit": result.unit,
            "k_at_temperature": k,
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
