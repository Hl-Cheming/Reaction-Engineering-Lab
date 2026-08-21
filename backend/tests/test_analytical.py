from math import exp, log
import unittest

from backend.kinetics import arrhenius_from_reference
from backend.reactors import (
    br_first_order,
    cstr_conversion,
    cstr_first_order,
    pfr_conversion,
    pfr_first_order,
)
from backend.stoichiometry import concentration_a
from backend.transport import pressure_ratio
from backend.solver import SolverInput, solve


class AnalyticalModelTests(unittest.TestCase):
    def test_first_order_br_matches_analytical_solution(self):
        k, x = 0.25, 0.8
        self.assertAlmostEqual(br_first_order(k, x).size, log(1 / (1 - x)) / k, places=12)

    def test_first_order_cstr_matches_damkohler_solution(self):
        k, tau = 0.25, 6.0
        self.assertAlmostEqual(cstr_conversion(k, tau), k * tau / (1 + k * tau), places=12)
        result = cstr_first_order(k, 0.6, 0.5)
        self.assertAlmostEqual(result.size / 0.5, 0.6 / (k * 0.4), places=12)

    def test_first_order_pfr_matches_analytical_solution(self):
        k, tau = 0.25, 6.0
        self.assertAlmostEqual(pfr_conversion(k, tau), 1 - exp(-k * tau), places=12)
        result = pfr_first_order(k, 0.8, 0.5)
        self.assertAlmostEqual(result.size / 0.5, log(5) / k, places=12)

    def test_arrhenius_reference_identity(self):
        self.assertAlmostEqual(arrhenius_from_reference(0.25, 350, 350, 52_000), 0.25, places=12)

    def test_gas_stoichiometry_and_pressure_boundary(self):
        self.assertAlmostEqual(concentration_a(2.0, 0.5, phase="gas", epsilon=0.5), 0.8, places=12)
        self.assertAlmostEqual(pressure_ratio(10, 0.03), (1 - 0.3) ** 0.5, places=12)
        with self.assertRaises(ValueError):
            pressure_ratio(40, 0.03)

    def test_generic_solver_matches_first_order_pfr(self):
        result = solve(
            SolverInput(
                reactor="PFR",
                phase="liquid",
                solve_for="target",
                target_x=0.8,
                size=1.0,
                order=1.0,
                k_ref=0.25,
                temperature=350,
                ref_temperature=350,
                activation_energy=52_000,
                ca0=2.0,
                fa0=1.0,
            )
        )
        self.assertAlmostEqual(result["scale"], log(5) / (0.25 * 2), places=6)


if __name__ == "__main__":
    unittest.main()
