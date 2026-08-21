import assert from "node:assert/strict";
import test from "node:test";
import { calculate, defaults, networkPreset, normalizeInputs, reactionLatex, validate, type Inputs } from "../src/core/models.ts";
import { parseChemicalFormula } from "../src/core/chemistry.ts";
import { toCaseConfiguration, toProductMaterialStream, toUnifiedNetwork } from "../src/core/caseConfiguration.ts";
import { caseReadiness, speciesDependencies } from "../src/core/caseReadiness.ts";
import { createCaseFile, parseCaseFile } from "../src/core/caseFile.ts";

function network(overrides: Partial<Inputs> = {}): Inputs {
  const networkType = overrides.networkType === "series" ? "series" : "parallel";
  return {
    ...defaults,
    ...networkPreset(networkType),
    reactionMode: "multiple",
    networkType,
    reactor: "PFR",
    phase: "liquid",
    solveFor: "target",
    targetX: 0.5,
    reactantCount: 1,
    productCount: 2,
    networkFeed: [1, 0, 0],
    networkHeatCapacities: [75, 85, 95],
    fa0: 1,
    isothermal: true,
    reversible: false,
    networkRateConstants: [0.2, 0.1],
    networkOrdersBySpecies: networkType === "series" ? [[1, 0, 0], [0, 1, 0]] : [[1, 0, 0], [1, 0, 0]],
    networkActivationEnergies: [0, 0],
    networkHeatOfReactions: [-20000, -10000],
    ...overrides,
  };
}

test("parallel network is rendered as two independent paths", () => {
  assert.equal(reactionLatex(network()), String.raw`A\rightarrow B,\qquad A\rightarrow C`);
  assert.deepEqual(validate(network()), []);
});

test("first-order parallel PFR matches the analytical scale, selectivity and yield", () => {
  const result = calculate(network());
  const expectedVolume = Math.log(2) / 0.3;

  assert.ok(Math.abs(result.scale - expectedVolume) < 2e-6);
  assert.ok(Math.abs((result.multiple?.overallSelectivity ?? 0) - 2) < 2e-6);
  assert.ok(Math.abs((result.multiple?.instantaneousSelectivity ?? 0) - 2) < 2e-6);
  assert.ok(Math.abs((result.multiple?.desiredYield ?? 0) - 1 / 3) < 2e-6);
  assert.ok(Math.abs(result.outletComponents[0].outlet - 0.5) < 2e-6);
});

test("parallel reaction network conserves A+B+C in PFR, CSTR and BR", () => {
  for (const reactor of ["PFR", "CSTR", "BR"] as const) {
    const result = calculate(network({ reactor }));
    const total = result.outletComponents.slice(0, 3).reduce((sum, component) => sum + component.outlet, 0);
    assert.ok(Math.abs(total - 1) < 2e-6, reactor);
  }
});

test("first-order parallel CSTR solves coupled outlet species balances", () => {
  const result = calculate(network({ reactor: "CSTR" }));

  assert.ok(Math.abs(result.scale - 10 / 3) < 2e-6);
  assert.ok(Math.abs((result.multiple?.overallSelectivity ?? 0) - 2) < 2e-6);
  assert.ok(Math.abs(result.outletComponents[1].outlet - 1 / 3) < 2e-6);
  assert.ok(Math.abs(result.outletComponents[2].outlet - 1 / 6) < 2e-6);
});

test("series PFR locates the analytical intermediate-B maximum", () => {
  const result = calculate(network({ networkType: "series", targetX: 0.95 }));
  const expectedScale = Math.log(2) / 0.1;
  const peak = result.multiple?.peakDesired;

  assert.ok(peak);
  assert.ok(Math.abs((peak?.scale ?? 0) - expectedScale) < 0.16);
  assert.ok(Math.abs((peak?.value ?? 0) - 0.5) < 5e-4);
  assert.equal(result.outletComponents[1].role, "intermediate");
});

test("multiple-reaction result exposes reaction and net-species rate profiles", () => {
  const result = calculate(network({ networkType: "series", targetX: 0.8 }));

  assert.equal(result.points.length, 101);
  assert.ok(result.points.every(point => point.reactionRates?.length === 2));
  assert.ok(result.points.every(point => point.netRates?.length === 3));
  assert.match(result.equations.map(row => row.expression).join(" "), /nu\^T|\\nu\^T/);
});

test("selection results stay disabled until two produced species are explicitly defined", () => {
  const input = toUnifiedNetwork(defaults);
  const result = calculate(input);

  assert.equal(result.multiple?.selectivityEnabled, false);
  assert.equal(result.multiple?.instantaneousSelectivity, null);
  assert.ok(!result.equations.some(row => row.name === "选择性与收率"));
  assert.ok(result.outletComponents.every(component => component.role !== "desired" && component.role !== "undesired"));

  const invalid = caseReadiness({ ...input, networkSelectivityEnabled: true });
  assert.equal(invalid.ready, false);
  assert.match(invalid.errors.join(" "), /目标产物与非目标产物/);
  assert.ok(!speciesDependencies(input, 1).includes("目标产物"));
});

test("gas PBR couples multi-reaction partial pressures, heat release and pressure drop", () => {
  const result = calculate(network({
    reactor: "PBR",
    phase: "gas",
    targetX: 0.2,
    networkFeed: [2, 0, 0],
    inertConcentration: 1,
    networkRateConstants: [0.02, 0.01],
    isothermal: false,
    pressureDrop: true,
    alpha: 0.01,
    networkHeatOfReactions: [-1000, -500],
  }));

  assert.ok(Number.isFinite(result.scale) && result.scale > 0);
  assert.ok(result.pressureRatio > 0 && result.pressureRatio < 1);
  assert.ok(result.outletTemperature > 350);
  assert.ok(result.points.every(point => point.flows.length === 4));
});

test("custom network supports four species and three independently parameterized reactions", () => {
  const custom = network({
    networkType: "custom",
    networkSpeciesCount: 4,
    networkReactionCount: 3,
    networkStoichiometry: [[-1, 1, 0, 0], [-1, 0, 1, 0], [0, -1, 0, 1]],
    networkOrdersBySpecies: [[1, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0]],
    networkFeed: [1, 0, 0, 0],
    networkHeatCapacities: [75, 80, 85, 90],
    networkRateConstants: [0.2, 0.1, 0.05],
    networkActivationEnergies: [0, 0, 0],
    networkHeatOfReactions: [-10000, -8000, -5000],
    networkReversible: [false, false, true],
    networkEquilibriumConstants: [10, 10, 10],
    networkDesiredSpecies: 1,
    networkReferenceSpecies: 2,
    solveFor: "size",
    size: 1.5,
  });
  const result = calculate(custom);

  assert.equal(reactionLatex(custom), String.raw`A\rightarrow B,\qquad A\rightarrow C,\qquad B\rightleftharpoons D`);
  assert.equal(result.outletComponents.length, 4);
  assert.equal(result.multiple?.reactionRates.length, 3);
  assert.equal(result.multiple?.netRates.length, 4);
  assert.ok(result.outletComponents.every(component => Number.isFinite(component.outlet)));
});

test("a reversible step uses its own reaction quotient and may run in reverse", () => {
  const result = calculate(network({
    networkReversible: [true, false],
    networkEquilibriumConstants: [1, 10],
    networkFeed: [1, 2, 0],
    solveFor: "size",
    size: 0.05,
  }));

  assert.ok((result.points[0].reactionRates?.[0] ?? 0) < 0);
  assert.ok((result.points.at(-1)?.flows[1] ?? 2) < 2);
  assert.match(result.assumptions.join(" "), /含可逆步骤/);
});

test("network validation rejects incomplete and duplicate stoichiometric rows", () => {
  const invalid = network({
    networkType: "custom",
    networkStoichiometry: [[-1, 1, 0], [-1, 1, 0]],
  });
  const errors = validate(invalid).join(" ");
  assert.match(errors, /完全重复/);

  const incomplete = validate({ ...invalid, networkStoichiometry: [[-1, 0, 0], [-1, 0, 1]] }).join(" ");
  assert.match(incomplete, /同时包含反应物和产物/);
});

test("V1.3 cached series inputs migrate to the V1.4 matrices", () => {
  const migrated = normalizeInputs({
    reactionMode: "multiple",
    networkType: "series",
    networkOrders: [1, 2],
    reactantConcentrations: [1],
    productConcentrations: [0, 0],
  });
  assert.deepEqual(migrated.networkStoichiometry, [[-1, 1, 0], [0, -1, 1]]);
  assert.deepEqual(migrated.networkOrdersBySpecies, [[1, 0, 0], [0, 2, 0]]);
  assert.deepEqual(migrated.networkFeed, [1, 0, 0]);
});

test("any consumed inlet species can be selected as the conversion and flow basis", () => {
  const result = calculate(network({
    networkType: "custom",
    networkReactionCount: 1,
    networkStoichiometry: [[-1, -1, 1]],
    networkOrdersBySpecies: [[0, 1, 0]],
    networkRateConstants: [0.2],
    networkActivationEnergies: [0],
    networkHeatOfReactions: [-10000],
    networkReversible: [false],
    networkEquilibriumConstants: [10],
    networkFeed: [2, 1, 0],
    networkConversionSpecies: 1,
    targetX: 0.5,
  }));

  assert.equal(result.multiple?.conversionSymbol, "B");
  assert.deepEqual(result.limitingSymbols, ["B"]);
  assert.ok(Math.abs(result.scale - Math.log(2) / 0.2) < 2e-5);
  assert.ok(Math.abs(result.outletState - 0.5) < 2e-6);
  assert.match(result.equations.map(row => row.substitution).join(" "), /X_\{B\}/);
});

test("single-reaction readiness requires the limiting reactant as conversion basis", () => {
  const input = network({
    networkType: "custom",
    networkReactionCount: 1,
    networkStoichiometry: [[-1, -1, 1]],
    networkOrdersBySpecies: [[1, 1, 0]],
    networkRateConstants: [0.2],
    networkActivationEnergies: [0],
    networkHeatOfReactions: [0],
    networkReversible: [false],
    networkEquilibriumConstants: [10],
    networkFeed: [2, 1, 0],
    networkConversionSpecies: 0,
  });
  const readiness = caseReadiness(input);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.sections.specification.some(error => error.includes("限制性反应物 B")));
});

test("a product-only species cannot define conversion", () => {
  const input = network({
    networkType: "custom",
    networkReactionCount: 1,
    networkStoichiometry: [[-1, -1, 1]],
    networkOrdersBySpecies: [[1, 1, 0]],
    networkRateConstants: [0.2],
    networkActivationEnergies: [0],
    networkHeatOfReactions: [0],
    networkReversible: [false],
    networkEquilibriumConstants: [10],
    networkFeed: [2, 1, 0.1],
    networkConversionSpecies: 2,
  });
  const readiness = caseReadiness(input);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.sections.specification.some(error => error.includes("只作为产物出现")));
});

test("formula parser supports grouped species and conservation rejects an unbalanced row", () => {
  assert.deepEqual(parseChemicalFormula("Ca(OH)2").elements, { Ca: 1, O: 2, H: 2 });

  const balanced = network({
    networkType: "custom",
    networkReactionCount: 1,
    networkStoichiometry: [[-2, -1, 2]],
    networkOrdersBySpecies: [[1, 0, 0]],
    networkRateConstants: [0.2],
    networkActivationEnergies: [0],
    networkHeatOfReactions: [-10000],
    networkReversible: [false],
    networkEquilibriumConstants: [10],
    networkFeed: [2, 1, 0],
    networkFormulas: ["H2", "O2", "H2O"],
    networkCharges: [0, 0, 0],
    networkEnforceConservation: true,
  });
  assert.deepEqual(validate(balanced), []);

  const errors = validate({ ...balanced, networkStoichiometry: [[-1, -1, 1]] }).join(" ");
  assert.match(errors, /O 元素不守恒/);
});

test("charge conservation is checked independently of elemental composition", () => {
  const ionic = network({
    networkType: "custom",
    networkReactionCount: 1,
    networkStoichiometry: [[-1, -1, 1]],
    networkOrdersBySpecies: [[1, 0, 0]],
    networkRateConstants: [0.2],
    networkActivationEnergies: [0],
    networkHeatOfReactions: [-10000],
    networkReversible: [false],
    networkEquilibriumConstants: [10],
    networkFeed: [1, 1, 0],
    networkFormulas: ["Na", "Cl", "NaCl"],
    networkCharges: [1, -1, 0],
    networkEnforceConservation: true,
  });
  assert.deepEqual(validate(ionic), []);
  assert.match(validate({ ...ionic, networkCharges: [1, 0, 0] }).join(" "), /电荷不守恒/);
});

test("implicit adaptive integration resolves a fast-slow reaction network without negative species", () => {
  const result = calculate(network({
    networkType: "series",
    solveFor: "size",
    size: 0.05,
    networkRateConstants: [1000, 1],
    networkOrdersBySpecies: [[1, 0, 0], [0, 1, 0]],
    networkActivationEnergies: [0, 0],
    networkSolver: "implicit",
    networkRelativeTolerance: 1e-5,
    networkAbsoluteTolerance: 1e-8,
  }));

  assert.match(result.method, /隐式/);
  assert.ok(result.points.every(point => point.flows.slice(0, 3).every(value => value >= 0 && Number.isFinite(value))));
  assert.ok(result.outletComponents[0].outlet < 1e-5);
  const total = result.outletComponents.slice(0, 3).reduce((sum, component) => sum + component.outlet, 0);
  assert.ok(Math.abs(total - 1) < 2e-5);
});

test("implicit target search and plotted integration use the same numerical path", () => {
  const result = calculate(network({
    networkType: "custom",
    networkReactionCount: 1,
    networkStoichiometry: [[-1, -1, 2]],
    networkOrdersBySpecies: [[0, 1, 0]],
    networkRateConstants: [0.2],
    networkActivationEnergies: [0],
    networkHeatOfReactions: [-10000],
    networkReversible: [false],
    networkEquilibriumConstants: [10],
    networkFeed: [1, 1, 0],
    networkConversionSpecies: 1,
    networkSolver: "implicit",
    networkRelativeTolerance: 1e-5,
    networkAbsoluteTolerance: 1e-8,
    targetX: 0.5,
  }));
  assert.ok(Math.abs(result.outletX - 0.5) < 1e-10);
  assert.equal(result.points.length, 101);
});

test("V1.4 cached inputs migrate to V1.5 basis, conservation and solver defaults", () => {
  const migrated = normalizeInputs({ reactionMode: "multiple", networkFeed: [1, 0, 0] });
  assert.equal(migrated.networkConversionSpecies, 0);
  assert.equal(migrated.networkEnforceConservation, false);
  assert.equal(migrated.networkSolver, "auto");
  assert.deepEqual(migrated.networkFormulas, ["", "", ""]);
});

test("V1.6 migrates a legacy single reaction into one editable reaction object", () => {
  const unified = toUnifiedNetwork({
    ...defaults,
    reactantCount: 2,
    productCount: 1,
    reactantStoich: [2, 1],
    productStoich: [2],
    reactantOrders: [2, 1],
    reactantConcentrations: [2, 1],
    productConcentrations: [0],
    inertConcentration: 0.5,
  });
  const configured = toCaseConfiguration(unified);

  assert.equal(unified.reactionMode, "multiple");
  assert.equal(unified.networkType, "custom");
  assert.deepEqual(unified.networkStoichiometry, [[-2, -1, 2, 0]]);
  assert.equal(configured.reactions.length, 1);
  assert.deepEqual(configured.components.map(component => component.symbol), ["A", "B", "C", "I"]);
  assert.equal(configured.components[3].inert, true);
  assert.match(configured.reactions[0].equation, /2A\+B\\rightarrow 2C/);
});

test("V1.6 stores an independent Arrhenius reference temperature for every reaction", () => {
  const configured = toCaseConfiguration(normalizeInputs({
    ...network(),
    networkReferenceTemperatures: [300, 425],
  }));
  assert.deepEqual(configured.reactions.map(reaction => reaction.referenceTemperature), [300, 425]);
});

test("V1.6 canonical material stream preserves gas partial pressures and component flows", () => {
  const base = toUnifiedNetwork(defaults);
  const input = toUnifiedNetwork({ ...base, phase: "gas", fa0: 2, networkFeed: [2, 1] });
  const feed = toCaseConfiguration(input).streams[0];
  assert.equal(feed.pressure, 3);
  assert.equal(feed.componentMolarFlows[0], 2);
  assert.equal(feed.componentMolarFlows[1], 1);
  assert.equal(feed.totalMolarFlow, 3);
  assert.deepEqual(feed.moleFractions.map(value => Number(value.toFixed(8))), [0.66666667, 0.33333333]);
});

test("V1.6 creates a canonical PRODUCT stream from a solved outlet", () => {
  const input = toUnifiedNetwork({ ...defaults, reactor: "PFR", solveFor: "target", targetX: 0.4 });
  const result = calculate(input);
  const product = toProductMaterialStream(input, result);
  assert.equal(product.id, "product");
  assert.ok(product.totalMolarFlow > 0);
  assert.equal(product.componentMolarFlows.length, input.networkSpeciesCount);
  assert.ok(Math.abs(product.componentMolarFlows[input.networkConversionSpecies] - input.fa0 * (1 - result.outletX)) < 1e-9);
});

test("V1.6 readiness blocks an empty basis feed and reports species dependencies", () => {
  const input = toUnifiedNetwork(defaults);
  const invalid = { ...input, networkFeed: input.networkFeed.map(() => 0) };
  const readiness = caseReadiness(invalid);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.sections.stream.some(error => error.includes("入口物流不能为空")));
  assert.ok(speciesDependencies(input, input.networkConversionSpecies).includes("转化率基准"));
  assert.ok(speciesDependencies(input, 0).includes("R1"));
});

test("V1.6 case files round-trip through the versioned import format", () => {
  const input = toUnifiedNetwork({ ...defaults, temperature: 412 });
  const restored = parseCaseFile(JSON.stringify(createCaseFile(input)));
  assert.equal(restored.temperature, 412);
  assert.equal(restored.networkReactionCount, input.networkReactionCount);
  assert.deepEqual(restored.networkStoichiometry, input.networkStoichiometry);
});
