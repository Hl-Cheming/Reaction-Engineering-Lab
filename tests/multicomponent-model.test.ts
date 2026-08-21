import assert from "node:assert/strict";
import test from "node:test";
import {
  calculate,
  componentConcentrations,
  defaults,
  equilibriumConstantAt,
  equilibriumConversion,
  gasExpansion,
  heatOfReactionAt,
  limitingAnalysis,
  maximumConversion,
  normalizeInputs,
  reactionLatex,
  reactionHeatCapacityChange,
  stoichiometricLabels,
  validate,
  type Inputs,
} from "../src/core/models.ts";
import {
  rateConstantFromCanonical,
  rateConstantToCanonical,
  rateConstantUnitLatex,
  rateFromCanonical,
  rateUnit,
} from "../src/core/units.ts";

function multicomponent(overrides: Partial<Inputs> = {}): Inputs {
  return {
    ...defaults,
    reactantCount: 2,
    productCount: 1,
    reactantStoich: [2, 1],
    productStoich: [2],
    reactantConcentrations: [2, 1],
    productConcentrations: [0.3],
    inertConcentration: 0.5,
    reactantOrders: [2, 1],
    ...overrides,
  };
}

test("builds the requested 2A+B to 2C reaction", () => {
  assert.equal(reactionLatex(multicomponent()), String.raw`2A+B\rightarrow 2C`);
});

test("reversible reaction uses the equilibrium arrow and reference constant", () => {
  const reversible = { ...defaults, reversible: true, equilibriumConstant: 9, heatOfReaction: -50000, targetX: 0.5 };

  assert.equal(reactionLatex(reversible), String.raw`A\rightleftharpoons B`);
  assert.ok(Math.abs((equilibriumConversion(reversible.temperature, 1, reversible) ?? 0) - 0.9) < 1e-9);
  assert.ok(equilibriumConstantAt(400, reversible) < reversible.equilibriumConstant, "放热反应升温时平衡常数应降低");
});

test("reversible PFR reports equilibrium conversion and every component molar-flow profile", () => {
  const inputs = { ...defaults, reactor: "PFR" as const, reversible: true, equilibriumConstant: 9, targetX: 0.5 };
  const result = calculate(inputs);

  assert.equal(result.points.length, 101);
  assert.ok(result.points.every(point => point.xeq !== null && point.x < (point.xeq ?? 0)));
  assert.deepEqual(result.points[0].flows, [1, 0, 0]);
  assert.deepEqual(result.points.at(-1)?.flows, [0.5, 0.5, 0]);
});

test("target conversion cannot cross the isothermal equilibrium boundary", () => {
  const inputs = { ...defaults, reversible: true, equilibriumConstant: 4, targetX: 0.81 };
  assert.match(validate(inputs).join(" "), /平衡转化率/);
});

test("nonisothermal reversible PFR couples the moving equilibrium boundary", () => {
  const result = calculate({ ...defaults, reactor: "PFR", reversible: true, equilibriumConstant: 9, isothermal: false, heatOfReaction: -5000, targetX: 0.3 });
  const inletEquilibrium = result.points[0].xeq ?? 0;
  const outletEquilibrium = result.points.at(-1)?.xeq ?? 0;

  assert.ok(result.outletTemperature > defaults.temperature);
  assert.ok(outletEquilibrium < inletEquilibrium);
  assert.ok(result.outletX < outletEquilibrium);
});

test("liquid stoichiometry includes co-reactant, product feed and inert", () => {
  const state = componentConcentrations(0.5, 1, multicomponent());

  assert.deepEqual(state.reactants, [1, 0.5]);
  assert.deepEqual(state.products, [1.3]);
  assert.equal(state.inert, 0.5);
});

test("gas expansion is derived from stoichiometry and all inlet species", () => {
  const inputs = multicomponent({ phase: "gas" });

  assert.ok(Math.abs(gasExpansion(inputs) - (-1 / 3.8)) < 1e-12);
  assert.equal(validate(inputs).length, 0);
});

test("feed concentration and stoichiometry determine B as the limiting reactant", () => {
  const inputs = multicomponent({ reactantConcentrations: [2, 0.5], targetX: 0.6 });

  assert.deepEqual(limitingAnalysis(inputs).symbols, ["B"]);
  assert.equal(maximumConversion(inputs), 1);
  assert.equal(validate(inputs).length, 0);
  const result = calculate(inputs);
  assert.equal(result.outletState, result.outletComponents.find(component => component.symbol === "B")?.outlet);
});

test("equimolar feed is described explicitly before identifying the limiting reactant", () => {
  const analysis = limitingAnalysis(multicomponent({ reactantConcentrations: [1, 1] }));

  assert.equal(analysis.equimolar, true);
  assert.deepEqual(analysis.symbols, ["A"]);
  assert.match(analysis.description, /A、B 等摩尔进料/);
});

test("stoichiometric symbols are lowercase and elementary orders default to coefficients", () => {
  assert.deepEqual(stoichiometricLabels({ reactantCount: 2, productCount: 2 }), {
    reactants: ["a", "b"],
    products: ["c", "d"],
  });
  const normalized = normalizeInputs({ reactantCount: 2, productCount: 1, reactantStoich: [2, 3] });
  assert.deepEqual(normalized.reactantOrders, [2, 3]);
});

test("calculation reports every outlet component including product and inert feeds", () => {
  const result = calculate(multicomponent({ targetX: 0.4 }));

  assert.deepEqual(result.outletComponents.map(component => component.symbol), ["A", "B", "C", "I"]);
  assert.equal(result.outletComponents.find(component => component.symbol === "C")?.inlet, 0.3);
  assert.equal(result.outletComponents.find(component => component.symbol === "I")?.outlet, 0.5);
  assert.deepEqual(result.limitingSymbols, ["A", "B"]);
  assert.ok(result.scale > 0);
});

test("multicomponent logic produces finite results for every reactor family", () => {
  const scenarios: Array<Partial<Inputs>> = [
    { reactor: "BR", phase: "gas", targetX: 0.2 },
    { reactor: "CSTR", phase: "liquid", targetX: 0.4 },
    { reactor: "PFR", phase: "gas", targetX: 0.4 },
    { reactor: "PBR", phase: "gas", targetX: 0.1, pressureDrop: true, alpha: 0.03 },
  ];

  for (const scenario of scenarios) {
    const result = calculate(multicomponent(scenario));
    assert.ok(Number.isFinite(result.scale) && result.scale > 0, `${scenario.reactor} 应得到有限正设计尺度`);
    assert.equal(result.outletComponents.length, 4);
  }
});

test("CSTR result curve follows the design equation instead of a straight interpolation", () => {
  const result = calculate({ ...defaults, reactor: "CSTR", targetX: 0.8 });
  const midpoint = result.points[50];

  assert.ok(Math.abs(midpoint.s - result.scale / 2) < 1e-10);
  assert.ok(Math.abs(midpoint.x - 2 / 3) < 1e-6);
  assert.notEqual(midpoint.x, result.outletX / 2);
});

test("reaction heat-capacity change is calculated from every species instead of assumed zero", () => {
  assert.equal(reactionHeatCapacityChange(defaults), 15);
  assert.equal(heatOfReactionAt(400, { ...defaults, heatOfReaction: -50000 }), -49250);
});

test("activation energy and reaction enthalpy default to zero", () => {
  assert.equal(defaults.activationEnergy, 0);
  assert.equal(defaults.heatOfReaction, 0);
  assert.deepEqual(defaults.networkActivationEnergies, [0, 0]);
  assert.deepEqual(defaults.networkHeatOfReactions, [0, 0]);
});

test("nonisothermal PFR couples conversion and temperature under adiabatic conditions", () => {
  const result = calculate({ ...defaults, reactor: "PFR", isothermal: false, heatOfReaction: -50000, targetX: 0.5 });

  assert.equal(result.points.length, 101);
  assert.ok(result.outletTemperature > defaults.temperature);
  assert.equal(result.points[0].t, defaults.temperature);
  assert.ok(result.points.every(point => Number.isFinite(point.t) && Number.isFinite(point.x)));
});

test("heat exchange changes the nonisothermal PFR temperature profile", () => {
  const adiabatic = calculate({ ...defaults, reactor: "PFR", isothermal: false, heatOfReaction: -50000, targetX: 0.5, heatTransferCoefficient: 0 });
  const cooled = calculate({ ...defaults, reactor: "PFR", isothermal: false, heatOfReaction: -50000, targetX: 0.5, heatTransferCoefficient: 1000, environmentTemperature: 300 });

  assert.ok(cooled.outletTemperature < adiabatic.outletTemperature);
});

test("gas PBR can couple partial-pressure kinetics, temperature and pressure drop", () => {
  const result = calculate({ ...defaults, reactor: "PBR", phase: "gas", isothermal: false, heatOfReaction: -50000, pressureDrop: true, targetX: 0.2, alpha: 0.03 });

  assert.ok(result.pressureRatio < 1 && result.pressureRatio > 0);
  assert.ok(result.outletTemperature > defaults.temperature);
  assert.ok(result.points.some(point => point.p < 1));
});

test("gas component state is reported on a partial-pressure basis", () => {
  const result = calculate({ ...defaults, reactor: "PFR", phase: "gas", targetX: 0.5 });
  const a = result.outletComponents.find(component => component.symbol === "A");

  assert.equal(a?.inlet, 2);
  assert.equal(a?.outlet, 1);
});

test("PBR rates and rate constants use a catalyst-mass basis", () => {
  const liquidUnits = { ...defaults, reactor: "PBR" as const, phase: "liquid" as const, lengthUnit: "m" as const, timeUnit: "min" as const };
  const gasUnits = { ...liquidUnits, phase: "gas" as const, pressureUnit: "kPa" as const };

  assert.equal(rateFromCanonical(2, liquidUnits), 120);
  assert.equal(rateUnit(liquidUnits), "mol·kg_cat⁻¹·min⁻¹");
  assert.ok(Math.abs(rateConstantFromCanonical(1, 2, liquidUnits) - 6e-5) < 1e-12);
  assert.ok(Math.abs(rateConstantToCanonical(6e-5, 2, liquidUnits) - 1) < 1e-12);
  assert.equal(rateConstantUnitLatex(2, liquidUnits), "\\mathrm{mol^{-1}\\,m^{6}\\,kg_{cat}^{-1}\\,min^{-1}}");

  assert.ok(Math.abs(rateConstantFromCanonical(1, 2, gasUnits) - 0.006) < 1e-12);
  assert.ok(Math.abs(rateConstantToCanonical(0.006, 2, gasUnits) - 1) < 1e-12);
  assert.equal(rateConstantUnitLatex(2, gasUnits), "\\mathrm{mol\\,kg_{cat}^{-1}\\,kPa^{-2}\\,min^{-1}}");
});

test("homogeneous rate-unit conversion remains volume based", () => {
  const units = { ...defaults, reactor: "PFR" as const, phase: "liquid" as const, lengthUnit: "m" as const, timeUnit: "min" as const };

  assert.equal(rateFromCanonical(2, units), 120000);
  assert.equal(rateUnit(units), "mol·m⁻³·min⁻¹");
  assert.equal(rateConstantFromCanonical(1, 2, units), 0.06);
  assert.ok(Math.abs(rateConstantToCanonical(0.06, 2, units) - 1) < 1e-12);
});
