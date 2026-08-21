import {
  solveMultipleReactions,
  validateMultipleReactionConfig,
  type MultipleReactionConfig,
  type NetworkSolver,
  type NetworkType,
} from "./multipleReactions.ts";
import { materialStreamFromSource, streamBasisMolarFlow } from "./materialStream.ts";
import { analyzeConservation, type ConservationReport } from "./chemistry.ts";

export type Reactor = "BR" | "CSTR" | "PFR" | "PBR";
export type Phase = "liquid" | "gas";
export type SolveFor = "target" | "size";
export type SpeciesRole = "reactant" | "product" | "inert" | "desired" | "undesired" | "intermediate";
export type TimeUnit = "s" | "min" | "h";
export type EnergyUnit = "J" | "kJ" | "kcal";
export type PressureUnit = "Pa" | "kPa" | "bar";
export type LengthUnit = "m" | "dm" | "mm";

export interface Inputs {
  timeUnit: TimeUnit;
  energyUnit: EnergyUnit;
  pressureUnit: PressureUnit;
  lengthUnit: LengthUnit;
  reactionMode: "single" | "multiple";
  networkType: NetworkType;
  networkRateConstants: number[];
  networkOrders: number[];
  networkActivationEnergies: number[];
  networkReferenceTemperatures: number[];
  networkElementary: boolean[];
  networkHeatOfReactions: number[];
  networkSpeciesCount: number;
  networkReactionCount: number;
  networkStoichiometry: number[][];
  networkOrdersBySpecies: number[][];
  networkFeed: number[];
  networkFormulas: string[];
  networkNames: string[];
  networkInertSpecies: boolean[];
  networkCharges: number[];
  networkEnforceConservation: boolean;
  networkHeatCapacities: number[];
  networkReversible: boolean[];
  networkEquilibriumConstants: number[];
  networkSelectivityEnabled: boolean;
  networkDesiredSpecies: number;
  networkReferenceSpecies: number;
  networkConversionSpecies: number;
  networkSolver: NetworkSolver;
  networkRelativeTolerance: number;
  networkAbsoluteTolerance: number;
  reactor: Reactor;
  phase: Phase;
  solveFor: SolveFor;
  targetX: number;
  size: number;
  reactantCount: number;
  productCount: number;
  reactantStoich: number[];
  productStoich: number[];
  reactantConcentrations: number[];
  productConcentrations: number[];
  inertConcentration: number;
  reactantOrders: number[];
  kRef: number;
  temperature: number;
  refTemperature: number;
  activationEnergy: number;
  fa0: number;
  reversible: boolean;
  equilibriumConstant: number;
  isothermal: boolean;
  reactantHeatCapacities: number[];
  productHeatCapacities: number[];
  inertHeatCapacity: number;
  heatOfReaction: number;
  environmentTemperature: number;
  heatTransferCoefficient: number;
  specificArea: number;
  catalystBulkDensity: number;
  pressureDrop: boolean;
  alpha: number;
}

export interface Point {
  s: number;
  x: number;
  state: number;
  rate: number;
  p: number;
  t: number;
  xeq: number | null;
  flows: number[];
  activities?: number[];
  reactionRates?: number[];
  netRates?: number[];
  instantaneousSelectivity?: number | null;
}

export interface OutletComponent {
  symbol: string;
  role: SpeciesRole;
  inlet: number;
  outlet: number;
}

export interface Result {
  reactor: Reactor;
  primaryLabel: string;
  primaryValue: number;
  primaryUnit: string;
  scale: number;
  scaleLabel: string;
  scaleUnit: string;
  outletX: number;
  outletState: number;
  outletRate: number;
  limitingSymbols: string[];
  outletComponents: OutletComponent[];
  k: number;
  epsilon: number;
  pressureRatio: number;
  outletTemperature: number;
  spaceTime: number | null;
  points: Point[];
  equations: Array<{ name: string; expression: string; substitution: string }>;
  assumptions: string[];
  conclusion: string;
  warnings: string[];
  method: string;
  multiple?: {
    networkType: NetworkType;
    speciesSymbols: string[];
    conversionSymbol: string;
    desiredSymbol: string;
    referenceSymbol: string;
    reactionRates: number[];
    netRates: number[];
    instantaneousSelectivity: number | null;
    overallSelectivity: number | null;
    selectivityEnabled: boolean;
    desiredYield: number;
    peakDesired: { scale: number; value: number } | null;
  };
}

const R = 8.314462618;
const R_BAR_L = 0.08314462618;
const EPS = 1e-12;
const INTEGRATION_STEPS = 2000;
const MAX_SPECIES_PER_SIDE = 4;
const SPECIES_SYMBOLS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const STOICHIOMETRIC_SYMBOLS = ["a", "b", "c", "d", "e", "f", "g", "h"];

export const defaults: Inputs = {
  timeUnit: "s",
  energyUnit: "kJ",
  pressureUnit: "bar",
  lengthUnit: "dm",
  reactionMode: "single",
  networkType: "parallel",
  networkRateConstants: [0.25, 0.1],
  networkOrders: [1, 2],
  networkActivationEnergies: [0, 0],
  networkReferenceTemperatures: [350, 350],
  networkElementary: [true, false],
  networkHeatOfReactions: [0, 0],
  networkSpeciesCount: 3,
  networkReactionCount: 2,
  networkStoichiometry: [[-1, 1, 0], [-1, 0, 1]],
  networkOrdersBySpecies: [[1, 0, 0], [2, 0, 0]],
  networkFeed: [2, 0, 0],
  networkFormulas: ["", "", ""],
  networkNames: ["", "", ""],
  networkInertSpecies: [false, false, false],
  networkCharges: [0, 0, 0],
  networkEnforceConservation: false,
  networkHeatCapacities: [75, 90, 90],
  networkReversible: [false, false],
  networkEquilibriumConstants: [9, 9],
  networkSelectivityEnabled: false,
  networkDesiredSpecies: 1,
  networkReferenceSpecies: 2,
  networkConversionSpecies: 0,
  networkSolver: "auto",
  networkRelativeTolerance: 1e-7,
  networkAbsoluteTolerance: 1e-9,
  reactor: "PFR",
  phase: "liquid",
  solveFor: "target",
  targetX: 0.8,
  size: 3.2,
  reactantCount: 1,
  productCount: 1,
  reactantStoich: [1],
  productStoich: [1],
  reactantConcentrations: [2],
  productConcentrations: [0],
  inertConcentration: 0,
  reactantOrders: [1],
  kRef: 0.25,
  temperature: 350,
  refTemperature: 350,
  activationEnergy: 0,
  fa0: 1,
  reversible: false,
  equilibriumConstant: 9,
  isothermal: true,
  reactantHeatCapacities: [75],
  productHeatCapacities: [90],
  inertHeatCapacity: 30,
  heatOfReaction: 0,
  environmentTemperature: 300,
  heatTransferCoefficient: 0,
  specificArea: 0.1,
  catalystBulkDensity: 0.8,
  pressureDrop: false,
  alpha: 0.03,
};

const reactorMeta: Record<Reactor, { scale: string; unit: string }> = {
  BR: { scale: "反应时间", unit: "s" },
  CSTR: { scale: "反应器体积", unit: "L" },
  PFR: { scale: "反应器体积", unit: "L" },
  PBR: { scale: "催化剂质量", unit: "kg_cat" },
};

function clampCount(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= MAX_SPECIES_PER_SIDE ? numeric : fallback;
}

function numericArray(value: unknown, count: number, fallback: number[]): number[] {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from({ length: count }, (_, index) => Number(source[index] ?? fallback[index] ?? 0));
}

function numericMatrix(value: unknown, rows: number, columns: number, fallback: number[][]): number[][] {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from({ length: rows }, (_, row) => numericArray(source[row], columns, fallback[row] ?? []));
}

function booleanArray(value: unknown, count: number, fallback: boolean[]): boolean[] {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from({ length: count }, (_, index) => source[index] === true);
}

function stringArray(value: unknown, count: number, fallback: string[]): string[] {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from({ length: count }, (_, index) => String(source[index] ?? fallback[index] ?? ""));
}

export function normalizeInputs(value: unknown): Inputs {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const reactantCount = clampCount(source.reactantCount, defaults.reactantCount);
  const productCount = clampCount(source.productCount, defaults.productCount);
  const networkSpeciesCount = Math.max(2, Math.min(8, Math.round(Number(source.networkSpeciesCount ?? defaults.networkSpeciesCount))));
  const networkReactionCount = Math.max(1, Math.min(8, Math.round(Number(source.networkReactionCount ?? defaults.networkReactionCount))));
  const normalizedNetworkType: NetworkType = source.networkType === "series" || source.networkType === "custom" ? source.networkType : "parallel";
  const legacyStoichiometry = normalizedNetworkType === "series" ? [[-1, 1, 0], [0, -1, 1]] : defaults.networkStoichiometry;
  const legacyNetworkOrders = numericArray(source.networkOrders, networkReactionCount, defaults.networkOrders);
  const legacyOrdersBySpecies = normalizedNetworkType === "series"
    ? [[legacyNetworkOrders[0] ?? 1, 0, 0], [0, legacyNetworkOrders[1] ?? 1, 0]]
    : [[legacyNetworkOrders[0] ?? 1, 0, 0], [legacyNetworkOrders[1] ?? 1, 0, 0]];
  const legacyNetworkFeed = source.networkFeed ?? [
    Array.isArray(source.reactantConcentrations) ? source.reactantConcentrations[0] : defaults.networkFeed[0],
    Array.isArray(source.productConcentrations) ? source.productConcentrations[0] : 0,
    Array.isArray(source.productConcentrations) ? source.productConcentrations[1] : 0,
  ];
  const legacyNetworkHeatCapacities = source.networkHeatCapacities ?? [
    Array.isArray(source.reactantHeatCapacities) ? source.reactantHeatCapacities[0] : 75,
    Array.isArray(source.productHeatCapacities) ? source.productHeatCapacities[0] : 90,
    Array.isArray(source.productHeatCapacities) ? source.productHeatCapacities[1] : 90,
  ];
  const legacyCa0 = Number(source.ca0 ?? defaults.reactantConcentrations[0]);
  const legacyOrder = Number(source.order ?? defaults.reactantOrders[0]);
  const reactantStoich = numericArray(source.reactantStoich, reactantCount, defaults.reactantStoich);
  const reactantOrders = Array.isArray(source.reactantOrders)
    ? numericArray(source.reactantOrders, reactantCount, reactantStoich)
    : source.order !== undefined
      ? numericArray(undefined, reactantCount, [legacyOrder])
      : [...reactantStoich];
  const reactantHeatCapacities = Array.from({ length: reactantCount }, (_, index) => Number(Array.isArray(source.reactantHeatCapacities) ? source.reactantHeatCapacities[index] ?? 75 : 75));
  const productHeatCapacities = Array.from({ length: productCount }, (_, index) => Number(Array.isArray(source.productHeatCapacities) ? source.productHeatCapacities[index] ?? 90 : 90));
  return {
    ...defaults,
    ...source,
    timeUnit: source.timeUnit === "min" || source.timeUnit === "h" ? source.timeUnit : "s",
    energyUnit: source.energyUnit === "J" || source.energyUnit === "kcal" ? source.energyUnit : "kJ",
    pressureUnit: source.pressureUnit === "Pa" || source.pressureUnit === "kPa" ? source.pressureUnit : "bar",
    lengthUnit: source.lengthUnit === "m" || source.lengthUnit === "mm" ? source.lengthUnit : "dm",
    reactionMode: source.reactionMode === "multiple" ? "multiple" : "single",
    networkType: normalizedNetworkType,
    networkRateConstants: numericArray(source.networkRateConstants, networkReactionCount, defaults.networkRateConstants),
    networkOrders: numericArray(source.networkOrders, networkReactionCount, defaults.networkOrders),
    networkActivationEnergies: numericArray(source.networkActivationEnergies, networkReactionCount, defaults.networkActivationEnergies),
    networkReferenceTemperatures: numericArray(source.networkReferenceTemperatures, networkReactionCount, Array(networkReactionCount).fill(Number(source.refTemperature ?? defaults.refTemperature))),
    networkElementary: booleanArray(source.networkElementary, networkReactionCount, Array(networkReactionCount).fill(true)),
    networkHeatOfReactions: numericArray(source.networkHeatOfReactions, networkReactionCount, defaults.networkHeatOfReactions),
    networkSpeciesCount,
    networkReactionCount,
    networkStoichiometry: numericMatrix(source.networkStoichiometry, networkReactionCount, networkSpeciesCount, legacyStoichiometry),
    networkOrdersBySpecies: numericMatrix(source.networkOrdersBySpecies, networkReactionCount, networkSpeciesCount, legacyOrdersBySpecies),
    networkFeed: numericArray(legacyNetworkFeed, networkSpeciesCount, defaults.networkFeed),
    networkFormulas: stringArray(source.networkFormulas, networkSpeciesCount, defaults.networkFormulas),
    networkNames: stringArray(source.networkNames, networkSpeciesCount, defaults.networkNames),
    networkInertSpecies: booleanArray(source.networkInertSpecies, networkSpeciesCount, defaults.networkInertSpecies),
    networkCharges: numericArray(source.networkCharges, networkSpeciesCount, defaults.networkCharges),
    networkEnforceConservation: source.networkEnforceConservation === true,
    networkHeatCapacities: numericArray(legacyNetworkHeatCapacities, networkSpeciesCount, defaults.networkHeatCapacities),
    networkReversible: booleanArray(source.networkReversible, networkReactionCount, defaults.networkReversible),
    networkEquilibriumConstants: numericArray(source.networkEquilibriumConstants, networkReactionCount, defaults.networkEquilibriumConstants),
    networkSelectivityEnabled: source.networkSelectivityEnabled === true,
    networkDesiredSpecies: Math.max(0, Math.min(networkSpeciesCount - 1, Math.round(Number(source.networkDesiredSpecies ?? defaults.networkDesiredSpecies)))),
    networkReferenceSpecies: Math.max(0, Math.min(networkSpeciesCount - 1, Math.round(Number(source.networkReferenceSpecies ?? defaults.networkReferenceSpecies)))),
    networkConversionSpecies: Math.max(0, Math.min(networkSpeciesCount - 1, Math.round(Number(source.networkConversionSpecies ?? defaults.networkConversionSpecies)))),
    networkSolver: source.networkSolver === "rk45" || source.networkSolver === "implicit" ? source.networkSolver : "auto",
    networkRelativeTolerance: Number(source.networkRelativeTolerance ?? defaults.networkRelativeTolerance),
    networkAbsoluteTolerance: Number(source.networkAbsoluteTolerance ?? defaults.networkAbsoluteTolerance),
    reactor: ["BR", "CSTR", "PFR", "PBR"].includes(String(source.reactor)) ? source.reactor as Reactor : defaults.reactor,
    phase: source.phase === "gas" ? "gas" : "liquid",
    solveFor: source.solveFor === "size" ? "size" : "target",
    reactantCount,
    productCount,
    reactantStoich,
    productStoich: numericArray(source.productStoich, productCount, defaults.productStoich),
    reactantConcentrations: numericArray(source.reactantConcentrations, reactantCount, [legacyCa0]),
    productConcentrations: numericArray(source.productConcentrations, productCount, defaults.productConcentrations),
    reactantOrders,
    reactantHeatCapacities,
    productHeatCapacities,
    inertConcentration: Number(source.inertConcentration ?? 0),
    inertHeatCapacity: Number(source.inertHeatCapacity ?? defaults.inertHeatCapacity),
    reversible: source.reversible === true,
    equilibriumConstant: Number(source.equilibriumConstant ?? defaults.equilibriumConstant),
    isothermal: source.isothermal !== false,
    heatOfReaction: Number(source.heatOfReaction ?? defaults.heatOfReaction),
    environmentTemperature: Number(source.environmentTemperature ?? defaults.environmentTemperature),
    heatTransferCoefficient: Number(source.heatTransferCoefficient ?? defaults.heatTransferCoefficient),
    specificArea: Number(source.specificArea ?? defaults.specificArea),
    catalystBulkDensity: Number(source.catalystBulkDensity ?? defaults.catalystBulkDensity),
  } as Inputs;
}

export function speciesLabels(i: Pick<Inputs, "reactantCount" | "productCount">): { reactants: string[]; products: string[] } {
  return {
    reactants: SPECIES_SYMBOLS.slice(0, i.reactantCount),
    products: SPECIES_SYMBOLS.slice(i.reactantCount, i.reactantCount + i.productCount),
  };
}

export function stoichiometricLabels(i: Pick<Inputs, "reactantCount" | "productCount">): { reactants: string[]; products: string[] } {
  return {
    reactants: STOICHIOMETRIC_SYMBOLS.slice(0, i.reactantCount),
    products: STOICHIOMETRIC_SYMBOLS.slice(i.reactantCount, i.reactantCount + i.productCount),
  };
}

export interface LimitingAnalysis {
  indices: number[];
  symbols: string[];
  basisIndex: number;
  equimolar: boolean;
  description: string;
}

export function limitingAnalysis(i: Inputs): LimitingAnalysis {
  if (i.reactionMode === "multiple") {
    const basis = Math.max(0, Math.min(i.networkSpeciesCount - 1, i.networkConversionSpecies));
    const symbol = networkSpeciesSymbols(i)[basis];
    return { indices: [basis], symbols: [symbol], basisIndex: basis, equimolar: false, description: `多反应体系以 ${symbol} 的净消耗定义转化率；其他物种由联立衡算直接求得。` };
  }
  const labels = speciesLabels(i).reactants;
  const valid = i.reactantStoich.length === i.reactantCount && i.reactantConcentrations.length === i.reactantCount
    && i.reactantStoich.every(value => Number.isFinite(value) && value > 0)
    && i.reactantConcentrations.every(value => Number.isFinite(value) && value > 0);
  if (!valid) return { indices: [], symbols: [], basisIndex: 0, equimolar: false, description: `完成所有反应物计量系数和入口${i.phase === "gas" ? "分压" : "浓度"}后自动判定。` };
  const ratios = i.reactantConcentrations.map((value, index) => value / i.reactantStoich[index]);
  const minimum = Math.min(...ratios);
  const tolerance = Math.max(1, Math.abs(minimum)) * 1e-9;
  const indices = ratios.flatMap((value, index) => Math.abs(value - minimum) <= tolerance ? [index] : []);
  const symbols = indices.map(index => labels[index]);
  const firstConcentration = i.reactantConcentrations[0];
  const equimolar = i.reactantConcentrations.every(value => Math.abs(value - firstConcentration) <= Math.max(1, Math.abs(firstConcentration)) * 1e-9);
  const feedPrefix = equimolar && i.reactantCount > 1 ? `${labels.join("、")} 等摩尔进料；` : "";
  const feedSymbol = i.phase === "gas" ? "P₀" : "C₀";
  const decision = symbols.length > 1
    ? `${symbols.join("、")} 的 ${feedSymbol}/计量系数相同，为共同限制反应物。`
    : `${symbols[0]} 的 ${feedSymbol}/计量系数最小，为限制反应物。`;
  return { indices, symbols, basisIndex: indices[0] ?? 0, equimolar, description: `${feedPrefix}${decision}` };
}

function coefficient(value: number): string {
  if (value === 1) return "";
  return compact(value);
}

function compact(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

export function reactionLatex(i: Inputs): string | null {
  if (i.reactionMode === "multiple") return networkReactionLatexes(i).join(",\\qquad ");
  if (
    i.reactantStoich.length !== i.reactantCount ||
    i.productStoich.length !== i.productCount ||
    [...i.reactantStoich, ...i.productStoich].some(value => !Number.isFinite(value) || value <= 0)
  ) return null;
  const labels = speciesLabels(i);
  const left = labels.reactants.map((symbol, index) => `${coefficient(i.reactantStoich[index])}${symbol}`).join("+");
  const right = labels.products.map((symbol, index) => `${coefficient(i.productStoich[index])}${symbol}`).join("+");
  return `${left}${i.reversible ? "\\rightleftharpoons" : "\\rightarrow"} ${right}`;
}

export function networkSpeciesSymbols(i: Pick<Inputs, "networkSpeciesCount"> & Partial<Pick<Inputs, "networkInertSpecies">>): string[] {
  let ordinaryIndex = 0;
  let inertIndex = 0;
  return Array.from({ length: i.networkSpeciesCount }, (_, index) => {
    if (i.networkInertSpecies?.[index]) {
      inertIndex += 1;
      return i.networkInertSpecies.filter(Boolean).length === 1 ? "I" : `I_{${inertIndex}}`;
    }
    const symbol = SPECIES_SYMBOLS[ordinaryIndex] ?? `S_{${ordinaryIndex + 1}}`;
    ordinaryIndex += 1;
    return symbol;
  });
}

export function hasValidSelectivityDefinition(i: Pick<Inputs, "networkSelectivityEnabled" | "networkDesiredSpecies" | "networkReferenceSpecies" | "networkStoichiometry" | "networkInertSpecies">): boolean {
  if (!i.networkSelectivityEnabled || i.networkDesiredSpecies === i.networkReferenceSpecies) return false;
  const produced = (species: number) => !i.networkInertSpecies[species] && i.networkStoichiometry.some(row => (row[species] ?? 0) > 0);
  return produced(i.networkDesiredSpecies) && produced(i.networkReferenceSpecies);
}

export function networkReactionLatexes(i: Pick<Inputs, "networkSpeciesCount" | "networkReactionCount" | "networkStoichiometry" | "networkReversible"> & Partial<Pick<Inputs, "networkInertSpecies">>): string[] {
  const symbols = networkSpeciesSymbols(i);
  return Array.from({ length: i.networkReactionCount }, (_, reaction) => {
    const row = i.networkStoichiometry[reaction] ?? [];
    const left = symbols.flatMap((symbol, species) => row[species] < 0 ? [`${coefficient(Math.abs(row[species]))}${symbol}`] : []);
    const right = symbols.flatMap((symbol, species) => row[species] > 0 ? [`${coefficient(row[species])}${symbol}`] : []);
    if (!left.length || !right.length) return `\\text{反应 ${reaction + 1} 待完善}`;
    return `${left.join("+")}${i.networkReversible[reaction] ? "\\rightleftharpoons" : "\\rightarrow"} ${right.join("+")}`;
  });
}

export function networkPreset(type: Exclude<NetworkType, "custom">): Partial<Inputs> {
  const series = type === "series";
  return {
    networkType: type,
    networkSpeciesCount: 3,
    networkReactionCount: 2,
    networkStoichiometry: series ? [[-1, 1, 0], [0, -1, 1]] : [[-1, 1, 0], [-1, 0, 1]],
    networkOrdersBySpecies: series ? [[1, 0, 0], [0, 1, 0]] : [[1, 0, 0], [2, 0, 0]],
    networkRateConstants: [0.25, 0.1],
    networkActivationEnergies: [0, 0],
    networkReferenceTemperatures: [350, 350],
    networkElementary: [true, false],
    networkHeatOfReactions: [0, 0],
    networkReversible: [false, false],
    networkEquilibriumConstants: [9, 9],
    networkFeed: [2, 0, 0],
    networkFormulas: ["", "", ""],
    networkNames: ["", "", ""],
    networkInertSpecies: [false, false, false],
    networkCharges: [0, 0, 0],
    networkEnforceConservation: false,
    networkHeatCapacities: [75, 90, 90],
    networkSelectivityEnabled: true,
    networkDesiredSpecies: 1,
    networkReferenceSpecies: 2,
    networkConversionSpecies: 0,
  };
}

export function networkConservationReport(i: Inputs): ConservationReport | null {
  if (i.reactionMode !== "multiple" || !i.networkEnforceConservation) return null;
  return analyzeConservation(i.networkFormulas, i.networkCharges, i.networkStoichiometry);
}

export function totalReactionOrder(i: Inputs): number {
  return i.reactantOrders.reduce((sum, order) => sum + order, 0);
}

function aInletConcentration(i: Inputs): number {
  return i.reactantConcentrations[0];
}

function basisIndex(i: Inputs): number {
  return limitingAnalysis(i).basisIndex;
}

function basisConcentration(i: Inputs): number {
  return i.reactantConcentrations[basisIndex(i)];
}

function basisStoichiometricCoefficient(i: Inputs): number {
  return i.reactantStoich[basisIndex(i)];
}

function basisMolarFlow(i: Inputs): number {
  return i.fa0 * basisConcentration(i) / aInletConcentration(i);
}

export function inletVolumetricFlow(i: Inputs): number {
  return i.phase === "gas" ? i.fa0 * R_BAR_L * i.temperature / aInletConcentration(i) : i.fa0 / aInletConcentration(i);
}

function inletMolarFlows(i: Inputs): { reactants: number[]; products: number[]; inert: number } {
  const scale = i.fa0 / aInletConcentration(i);
  return {
    reactants: i.reactantConcentrations.map(value => value * scale),
    products: i.productConcentrations.map(value => value * scale),
    inert: i.inertConcentration * scale,
  };
}

export function componentMolarFlows(x: number, i: Inputs): { reactants: number[]; products: number[]; inert: number } {
  const inlet = inletMolarFlows(i);
  const extent = basisMolarFlow(i) * x / basisStoichiometricCoefficient(i);
  return {
    reactants: inlet.reactants.map((value, index) => Math.max(0, value - i.reactantStoich[index] * extent)),
    products: inlet.products.map((value, index) => Math.max(0, value + i.productStoich[index] * extent)),
    inert: inlet.inert,
  };
}

export function flattenedMolarFlows(x: number, i: Inputs): number[] {
  const flows = componentMolarFlows(x, i);
  return [...flows.reactants, ...flows.products, flows.inert];
}

export function reactionHeatCapacityChange(i: Inputs): number {
  const products = i.productStoich.reduce((sum, coefficient, index) => sum + coefficient * i.productHeatCapacities[index], 0);
  const reactants = i.reactantStoich.reduce((sum, coefficient, index) => sum + coefficient * i.reactantHeatCapacities[index], 0);
  return products - reactants;
}

function heatCapacityFlow(x: number, i: Inputs): number {
  const flows = componentMolarFlows(x, i);
  return flows.reactants.reduce((sum, flow, index) => sum + flow * i.reactantHeatCapacities[index], 0)
    + flows.products.reduce((sum, flow, index) => sum + flow * i.productHeatCapacities[index], 0)
    + flows.inert * i.inertHeatCapacity;
}

export function heatOfReactionAt(temperature: number, i: Inputs): number {
  return i.heatOfReaction + reactionHeatCapacityChange(i) * (temperature - i.refTemperature);
}

export function equilibriumConstantAt(temperature: number, i: Inputs): number {
  if (!i.reversible) return Number.POSITIVE_INFINITY;
  const deltaCp = reactionHeatCapacityChange(i);
  const tRef = i.refTemperature;
  const integral = i.heatOfReaction * (1 / tRef - 1 / temperature)
    + deltaCp * (Math.log(temperature / tRef) + tRef * (1 / temperature - 1 / tRef));
  return i.equilibriumConstant * Math.exp(integral / R);
}

function inletTotalConcentration(i: Inputs): number {
  return [...i.reactantConcentrations, ...i.productConcentrations, i.inertConcentration].reduce((sum, value) => sum + value, 0);
}

export function gasExpansion(i: Inputs): number {
  const deltaStoichiometry = i.productStoich.reduce((sum, value) => sum + value, 0) - i.reactantStoich.reduce((sum, value) => sum + value, 0);
  const total = inletTotalConcentration(i);
  if (total <= 0 || basisStoichiometricCoefficient(i) <= 0) return Number.NaN;
  return basisConcentration(i) / total * deltaStoichiometry / basisStoichiometricCoefficient(i);
}

export function maximumConversion(i: Inputs): number {
  if (basisConcentration(i) <= 0 || basisStoichiometricCoefficient(i) <= 0) return 0;
  return Math.min(1, ...i.reactantConcentrations.map((concentration, index) => (
    concentration * basisStoichiometricCoefficient(i) / (basisConcentration(i) * i.reactantStoich[index])
  )));
}

interface ConcentrationState {
  reactants: number[];
  products: number[];
  inert: number;
}

export function componentConcentrations(x: number, p: number, i: Inputs): ConcentrationState {
  const basisChange = basisConcentration(i) * x / basisStoichiometricCoefficient(i);
  const numeratorReactants = i.reactantConcentrations.map((initial, index) => initial - i.reactantStoich[index] * basisChange);
  const numeratorProducts = i.productConcentrations.map((initial, index) => initial + i.productStoich[index] * basisChange);
  if (i.phase === "liquid") {
    return {
      reactants: numeratorReactants.map(value => Math.max(0, value)),
      products: numeratorProducts.map(value => Math.max(0, value)),
      inert: i.inertConcentration,
    };
  }
  const denominator = 1 + gasExpansion(i) * x;
  const factor = denominator > 0 ? p / denominator : Number.NaN;
  return {
    reactants: numeratorReactants.map(value => Math.max(0, value) * factor),
    products: numeratorProducts.map(value => Math.max(0, value) * factor),
    inert: i.inertConcentration * factor,
  };
}

export function reactionQuotient(x: number, p: number, i: Inputs): number {
  const state = componentConcentrations(x, p, i);
  const products = state.products.reduce((value, drivingForce, index) => value * Math.pow(Math.max(drivingForce, 0), i.productStoich[index]), 1);
  const reactants = state.reactants.reduce((value, drivingForce, index) => value * Math.pow(Math.max(drivingForce, 0), i.reactantStoich[index]), 1);
  if (reactants <= EPS) return Number.POSITIVE_INFINITY;
  return products / reactants;
}

export function equilibriumConversion(temperature: number, p: number, i: Inputs): number | null {
  if (!i.reversible) return null;
  const equilibriumConstant = equilibriumConstantAt(temperature, i);
  const upper = maximumConversion(i) * (1 - 1e-9);
  if (reactionQuotient(0, p, i) >= equilibriumConstant) return 0;
  if (reactionQuotient(upper, p, i) <= equilibriumConstant) return upper;
  let low = 0;
  let high = upper;
  for (let step = 0; step < 70; step++) {
    const middle = (low + high) / 2;
    if (reactionQuotient(middle, p, i) < equilibriumConstant) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function concentration(x: number, p: number, i: Inputs): number {
  return componentConcentrations(x, p, i).reactants[basisIndex(i)];
}

export function rateConstant(i: Inputs): number {
  return rateConstantAt(i.temperature, i);
}

export function rateConstantAt(temperature: number, i: Inputs): number {
  return i.kRef * Math.exp((-i.activationEnergy / R) * (1 / temperature - 1 / i.refTemperature));
}

function toMultipleReactionConfig(i: Inputs): MultipleReactionConfig {
  const feedStream = materialStreamFromSource({
    phase: i.phase,
    temperature: i.temperature,
    activities: i.networkFeed,
    basisSpecies: i.networkConversionSpecies,
    basisMolarFlow: i.fa0,
  });
  return {
    reactor: i.reactor,
    phase: i.phase,
    solveFor: i.solveFor,
    targetX: i.targetX,
    size: i.size,
    networkType: i.networkType,
    speciesSymbols: networkSpeciesSymbols(i),
    speciesFormulas: Array.from({ length: i.networkSpeciesCount }, (_, index) => i.networkFormulas[index] ?? ""),
    speciesCharges: Array.from({ length: i.networkSpeciesCount }, (_, index) => i.networkCharges[index] ?? 0),
    enforceConservation: i.networkEnforceConservation,
    stoichiometry: i.networkStoichiometry,
    feed: feedStream.activities,
    inertFeed: i.inertConcentration,
    fa0: streamBasisMolarFlow(feedStream, i.networkConversionSpecies),
    kRef: i.networkRateConstants,
    orders: i.networkOrdersBySpecies,
    reversible: i.networkReversible,
    equilibriumConstants: i.networkEquilibriumConstants,
    activationEnergies: i.networkActivationEnergies,
    referenceTemperatures: Array.from({ length: i.networkReactionCount }, (_, index) => i.networkReferenceTemperatures[index] ?? i.refTemperature),
    temperature: i.temperature,
    isothermal: i.isothermal,
    heatOfReactions: i.networkHeatOfReactions,
    heatCapacities: i.networkHeatCapacities,
    inertHeatCapacity: i.inertHeatCapacity,
    environmentTemperature: i.environmentTemperature,
    heatTransferCoefficient: i.heatTransferCoefficient,
    specificArea: i.specificArea,
    catalystBulkDensity: i.catalystBulkDensity,
    pressureDrop: i.pressureDrop,
    alpha: i.alpha,
    conversionSpecies: i.networkConversionSpecies,
    selectivityEnabled: hasValidSelectivityDefinition(i),
    desiredSpecies: i.networkDesiredSpecies,
    referenceSpecies: i.networkReferenceSpecies,
    solver: i.networkSolver,
    relativeTolerance: i.networkRelativeTolerance,
    absoluteTolerance: i.networkAbsoluteTolerance,
  };
}

export function validate(i: Inputs): string[] {
  if (i.reactionMode === "multiple") return validateMultipleReactionConfig(toMultipleReactionConfig(i));
  const errors: string[] = [];
  if (!Number.isInteger(i.reactantCount) || i.reactantCount < 1 || i.reactantCount > MAX_SPECIES_PER_SIDE) errors.push(`反应物数量必须是 1–${MAX_SPECIES_PER_SIDE} 的整数。`);
  if (!Number.isInteger(i.productCount) || i.productCount < 1 || i.productCount > MAX_SPECIES_PER_SIDE) errors.push(`产物数量必须是 1–${MAX_SPECIES_PER_SIDE} 的整数。`);
  if (i.reactantStoich.length !== i.reactantCount || i.productStoich.length !== i.productCount) errors.push("计量系数数量与组分数量不一致。");
  [...i.reactantStoich, ...i.productStoich].forEach((value, index) => {
    if (!Number.isFinite(value) || value <= 0) errors.push(`第 ${index + 1} 个计量系数必须大于 0。`);
  });
  i.reactantConcentrations.forEach((value, index) => {
    if (!Number.isFinite(value) || value <= 0) errors.push(`反应物 ${speciesLabels(i).reactants[index] ?? index + 1} 的入口${i.phase === "gas" ? "分压" : "浓度"}必须大于 0。`);
  });
  i.productConcentrations.forEach((value, index) => {
    if (!Number.isFinite(value) || value < 0) errors.push(`产物 ${speciesLabels(i).products[index] ?? index + 1} 的入口${i.phase === "gas" ? "分压" : "浓度"}不得为负。`);
  });
  if (!Number.isFinite(i.inertConcentration) || i.inertConcentration < 0) errors.push(`惰性物质 I 的入口${i.phase === "gas" ? "分压" : "浓度"}不得为负。`);
  i.reactantOrders.forEach((value, index) => {
    if (!Number.isFinite(value) || value < 0 || value > 4) errors.push(`反应物 ${speciesLabels(i).reactants[index] ?? index + 1} 的反应级数应在 0–4 之间。`);
  });
  if (totalReactionOrder(i) <= 0) errors.push("至少一个反应物的反应级数必须大于 0。");
  [
    [i.kRef, "参考速率常数 k_ref"],
    [i.temperature, "反应温度 T"],
    [i.refTemperature, "参考温度 T_ref"],
  ].forEach(([value, label]) => {
    if (!Number.isFinite(value as number) || (value as number) <= 0) errors.push(`${label} 必须大于 0。`);
  });
  if (i.reactor !== "BR" && (!Number.isFinite(i.fa0) || i.fa0 <= 0)) errors.push("入口 A 摩尔流率 F_A0 必须大于 0。");
  const maxX = maximumConversion(i);
  if (i.solveFor === "target" && (!Number.isFinite(i.targetX) || i.targetX <= 0 || i.targetX >= Math.min(0.999999, maxX))) {
    errors.push(`目标转化率 X 必须大于 0 且低于限制反应物的物理上限 ${format(Math.min(0.999999, maxX))}。`);
  }
  if (i.solveFor === "size" && (!Number.isFinite(i.size) || i.size <= 0)) errors.push("给定的反应器尺度必须大于 0。");
  const conversionForGasCheck = i.solveFor === "target" ? Math.min(i.targetX, maxX) : maxX * (1 - 1e-8);
  if (i.phase === "gas" && (!Number.isFinite(gasExpansion(i)) || 1 + gasExpansion(i) * conversionForGasCheck <= 0)) errors.push("气相计量关系失效：1 + εX 必须大于 0。");
  if (i.reactor === "PBR" && i.pressureDrop && (!Number.isFinite(i.alpha) || i.alpha <= 0)) errors.push("考虑压降时，压降参数 α 必须大于 0。");
  if (i.pressureDrop && (i.reactor !== "PBR" || i.phase !== "gas")) errors.push("变压模型仅适用于气相 PBR。");
  if (!i.isothermal) {
    if (i.reactantHeatCapacities.length !== i.reactantCount || i.productHeatCapacities.length !== i.productCount) errors.push("热容数量与组分数量不一致。");
    [...i.reactantHeatCapacities, ...i.productHeatCapacities, i.inertHeatCapacity].forEach((value, index) => {
      if (!Number.isFinite(value) || value <= 0) errors.push(`第 ${index + 1} 个定压热容必须大于 0。`);
    });
    if (i.reactor !== "PFR" && i.reactor !== "PBR") errors.push("V1.2 的非恒温稳态模型仅适用于 PFR 或 PBR。");
    if (!Number.isFinite(i.heatOfReaction)) errors.push("参考反应焓变 ΔH_ref 必须是有限值。");
    if (!Number.isFinite(i.environmentTemperature) || i.environmentTemperature <= 0) errors.push("外界温度 T_env 必须大于 0 K。");
    if (!Number.isFinite(i.heatTransferCoefficient) || i.heatTransferCoefficient < 0) errors.push("换热系数 U 不得为负。");
    if (!Number.isFinite(i.specificArea) || i.specificArea <= 0) errors.push("比表面积 a 必须大于 0。");
    if (i.reactor === "PBR" && (!Number.isFinite(i.catalystBulkDensity) || i.catalystBulkDensity <= 0)) errors.push("PBR 催化剂床层堆密度 ρ_b 必须大于 0。");
  }
  if (i.activationEnergy < 0) errors.push("活化能 E 不应为负值。");
  if (i.reversible && (!Number.isFinite(i.equilibriumConstant) || i.equilibriumConstant <= 0)) errors.push("参考平衡常数必须大于 0。");
  if (i.reversible && i.isothermal && i.solveFor === "target") {
    const equilibriumLimit = equilibriumConversion(i.temperature, 1, i);
    if (equilibriumLimit !== null && i.targetX >= equilibriumLimit * (1 - 1e-8)) errors.push(`目标转化率必须低于当前条件的平衡转化率 ${format(equilibriumLimit)}。`);
  }
  return errors;
}

function simpson(fn: (x: number) => number, end: number): number {
  const h = end / INTEGRATION_STEPS;
  let sum = fn(0) + fn(end);
  for (let n = 1; n < INTEGRATION_STEPS; n++) sum += (n % 2 === 0 ? 2 : 4) * fn(n * h);
  return sum * h / 3;
}

function reactionRateAt(x: number, p: number, temperature: number, i: Inputs): number {
  const state = componentConcentrations(x, p, i);
  const forwardRate = rateConstantAt(temperature, i) * state.reactants.reduce((rate, drivingForce, index) => (
    rate * Math.pow(Math.max(drivingForce, 0), i.reactantOrders[index])
  ), 1);
  if (!i.reversible) return forwardRate;
  return forwardRate * (1 - reactionQuotient(x, p, i) / equilibriumConstantAt(temperature, i));
}

function rateAt(x: number, p: number, temperature: number, i: Inputs): number {
  return basisStoichiometricCoefficient(i) * reactionRateAt(x, p, temperature, i);
}

function usesCoupledBalance(i: Inputs): boolean {
  return (!i.isothermal && (i.reactor === "PFR" || i.reactor === "PBR")) || (i.reactor === "PBR" && i.phase === "gas" && i.pressureDrop);
}

type CoupledVector = [number, number, number];

function coupledDerivatives(x: number, state: CoupledVector, i: Inputs): CoupledVector {
  const [, pressureRatio, temperature] = state;
  const safePressure = Math.max(pressureRatio, 1e-8);
  const limitingRate = rateAt(x, safePressure, temperature, i);
  if (!Number.isFinite(limitingRate) || limitingRate <= EPS) throw new Error("反应已到达平衡边界，无法继续提高正向转化率。");
  const progressRate = limitingRate / basisStoichiometricCoefficient(i);
  const dsDx = basisMolarFlow(i) / limitingRate;
  const totalFlowRatio = i.phase === "gas" ? 1 + gasExpansion(i) * x : 1;
  const dpDs = i.reactor === "PBR" && i.phase === "gas" && i.pressureDrop
    ? -i.alpha * totalFlowRatio * (temperature / i.temperature) / (2 * safePressure)
    : 0;
  let dTDs = 0;
  if (!i.isothermal) {
    const areaFactor = i.reactor === "PBR" ? i.specificArea / i.catalystBulkDensity : i.specificArea;
    const heatTransfer = i.heatTransferCoefficient * areaFactor * (i.environmentTemperature - temperature);
    const reactionHeat = -heatOfReactionAt(temperature, i) * progressRate;
    dTDs = (heatTransfer + reactionHeat) / Math.max(heatCapacityFlow(x, i), EPS);
  }
  return [dsDx, dpDs * dsDx, dTDs * dsDx];
}

function addVector(a: CoupledVector, b: CoupledVector, factor: number): CoupledVector {
  return [a[0] + factor * b[0], a[1] + factor * b[1], a[2] + factor * b[2]];
}

function rk4CoupledStep(x: number, state: CoupledVector, h: number, i: Inputs): CoupledVector {
  const k1 = coupledDerivatives(x, state, i);
  const k2 = coupledDerivatives(x + h / 2, addVector(state, k1, h / 2), i);
  const k3 = coupledDerivatives(x + h / 2, addVector(state, k2, h / 2), i);
  const k4 = coupledDerivatives(x + h, addVector(state, k3, h), i);
  return [
    state[0] + h * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6,
    state[1] + h * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6,
    state[2] + h * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) / 6,
  ];
}

function coupledToTarget(target: number, i: Inputs, collectPoints = false): { size: number; p: number; t: number; points: Point[] } {
  const steps = 2000;
  const h = target / steps;
  let state: CoupledVector = [0, 1, i.temperature];
  const points: Point[] = [];
  const record = (x: number) => points.push({
    s: state[0], x, state: concentration(x, state[1], i), rate: rateAt(x, state[1], state[2], i), p: state[1], t: state[2],
    xeq: equilibriumConversion(state[2], state[1], i), flows: flattenedMolarFlows(x, i),
  });
  if (collectPoints) record(0);
  for (let n = 0; n < steps; n++) {
    state = rk4CoupledStep(n * h, state, h, i);
    if (!Number.isFinite(state[0]) || !Number.isFinite(state[1]) || !Number.isFinite(state[2]) || state[1] <= 0.02 || state[2] < 150 || state[2] > 2500) {
      throw new Error("联立物料衡算、能量衡算或压降方程超出物理边界；请检查目标转化率、反应焓、换热和压降参数。");
    }
    if (collectPoints && (n + 1) % 20 === 0) record((n + 1) * h);
  }
  return { size: state[0], p: state[1], t: state[2], points };
}

function batchIntegrand(x: number, i: Inputs): number {
  const volumeRatio = i.phase === "gas" ? 1 + gasExpansion(i) * x : 1;
  const inletMolarConcentration = i.phase === "gas" ? basisConcentration(i) / (R_BAR_L * i.temperature) : basisConcentration(i);
  return inletMolarConcentration / Math.max(rateAt(x, 1, i.temperature, i) * volumeRatio, EPS);
}

function sizeToTarget(target: number, i: Inputs): number {
  if (usesCoupledBalance(i)) return coupledToTarget(target, i).size;
  if (i.reactor === "BR") return simpson(x => batchIntegrand(x, i), target);
  if (i.reactor === "CSTR") return basisMolarFlow(i) * target / Math.max(rateAt(target, 1, i.temperature, i), EPS);
  return basisMolarFlow(i) * simpson(x => 1 / Math.max(rateAt(x, 1, i.temperature, i), EPS), target);
}

function conversionAtSize(size: number, i: Inputs): number {
  let low = 0;
  let high = maximumConversion(i) * (1 - 1e-8);
  for (let n = 0; n < 70; n++) {
    const middle = (low + high) / 2;
    try {
      if (sizeToTarget(middle, i) < size) low = middle;
      else high = middle;
    } catch {
      high = middle;
    }
  }
  return (low + high) / 2;
}

function buildPoints(outletX: number, size: number, i: Inputs): Point[] {
  if (usesCoupledBalance(i)) return coupledToTarget(outletX, i, true).points;
  return Array.from({ length: 101 }, (_, n) => {
    const fraction = n / 100;
    const s = i.reactor === "CSTR" ? size * fraction : fraction === 0 ? 0 : sizeToTarget(outletX * fraction, { ...i, pressureDrop: false });
    const x = i.reactor === "CSTR" ? (n === 0 ? 0 : conversionAtSize(s, { ...i, pressureDrop: false })) : outletX * fraction;
    return { s, x, state: concentration(x, 1, i), rate: rateAt(x, 1, i.temperature, i), p: 1, t: i.temperature, xeq: equilibriumConversion(i.temperature, 1, i), flows: flattenedMolarFlows(x, i) };
  });
}

function rateLatex(i: Inputs): string {
  const labels = speciesLabels(i).reactants;
  const limiting = labels[basisIndex(i)];
  const coefficient = stoichiometricLabels(i).reactants[basisIndex(i)];
  const drivingSymbol = i.phase === "gas" ? "P" : "C";
  const factors = labels.map((symbol, index) => `${drivingSymbol}_${symbol}^{${compact(i.reactantOrders[index])}}`).join("");
  const driving = i.reversible ? `\\left(1-\\frac{Q}{K_${i.phase === "gas" ? "P" : "C"}(T)}\\right)` : "";
  return `r=k${factors}${driving},\\qquad -r_${limiting}=${coefficient}r`;
}

function stoichiometryLatex(i: Inputs): string {
  const limiting = speciesLabels(i).reactants[basisIndex(i)];
  const basisCoefficient = stoichiometricLabels(i).reactants[basisIndex(i)];
  const liquidRelations = `C_{R_j}^{*}=C_{R_j,0}-\\frac{s_{R_j}}{${basisCoefficient}}C_{${limiting}0}X,\\qquad C_{P_j}^{*}=C_{P_j,0}+\\frac{s_{P_j}}{${basisCoefficient}}C_{${limiting}0}X`;
  return i.phase === "gas"
    ? `\\begin{aligned}P_{R_j}^{*}&=P_{R_j,0}-\\frac{s_{R_j}}{${basisCoefficient}}P_{${limiting}0}X\\\\ P_{P_j}^{*}&=P_{P_j,0}+\\frac{s_{P_j}}{${basisCoefficient}}P_{${limiting}0}X\\\\ P_j&=P_j^{*}\\frac{P/P_0}{1+\\varepsilon X}\\end{aligned}`
    : liquidRelations.replaceAll("^{*}", "");
}

function equations(i: Inputs, k: number, target: number, scale: number): Result["equations"] {
  const limiting = speciesLabels(i).reactants[basisIndex(i)];
  const feedStateSymbol = `${i.phase === "gas" ? "P" : "C"}_{${limiting}0}`;
  const feedStateUnit = i.phase === "gas" ? "bar" : "mol\\,L^{-1}";
  const flowSymbol = `F_{${limiting}0}`;
  const rateSymbol = `-r_${limiting}`;
  const design: Record<Reactor, string> = {
    BR: i.phase === "gas"
      ? `\\displaystyle t=\\frac{${feedStateSymbol}}{RT_0}\\int\\limits_{0}^{X}\\frac{dX}{(${rateSymbol})(1+\\varepsilon X)}`
      : `\\displaystyle t=${feedStateSymbol}\\int\\limits_{0}^{X}\\frac{dX}{${rateSymbol}}`,
    CSTR: `V=\\frac{${flowSymbol}(X_{\\mathrm{out}}-X_{\\mathrm{in}})}{(${rateSymbol})_{\\mathrm{out}}}`,
    PFR: `\\displaystyle V=${flowSymbol}\\int\\limits_{0}^{X}\\frac{dX}{${rateSymbol}}`,
    PBR: `\\displaystyle W=${flowSymbol}\\int\\limits_{0}^{X}\\frac{dX}{-r'_${limiting}}`,
  };
  const reaction = reactionLatex(i) ?? "\\text{计量系数未完成}";
  const rows = [
    { name: "反应与速率方程", expression: `${reaction},\\qquad ${rateLatex(i)}`, substitution: `k(T)=${format(k)}` },
    { name: "化学计量关系", expression: stoichiometryLatex(i), substitution: `${feedStateSymbol}=${format(basisConcentration(i))}\\ \\mathrm{${feedStateUnit}},\\quad X=${format(target)}${i.phase === "gas" ? `,\\quad \\varepsilon=${format(gasExpansion(i))}` : ""}` },
    { name: "反应器设计方程", expression: design[i.reactor], substitution: `${i.reactor === "BR" ? "t" : i.reactor === "PBR" ? "W" : "V"}=${format(scale)}\\ \\mathrm{${reactorMeta[i.reactor].unit.replace("kg_cat", "kg_{cat}")}}` },
  ];
  if (i.reversible) rows.push({
    name: "可逆反应平衡",
    expression: `Q=\\frac{\\prod_m ${i.phase === "gas" ? "P" : "C"}_{P_m}^{s_{P_m}}}{\\prod_j ${i.phase === "gas" ? "P" : "C"}_{R_j}^{s_{R_j}}},\\qquad Q=K_${i.phase === "gas" ? "P" : "C"}(T)\\text{ 时 }r=0`,
    substitution: `K_{\\mathrm{ref}}=${format(i.equilibriumConstant)},\\quad X_{\\mathrm{eq,out}}=${format(equilibriumConversion(i.isothermal ? i.temperature : coupledToTarget(target, i).t, i.reactor === "PBR" && i.pressureDrop ? coupledToTarget(target, i).p : 1, i) ?? Number.NaN)}`,
  });
  if (!i.isothermal) rows.push({
    name: "稳态能量衡算",
    expression: i.reactor === "PBR"
      ? "\\frac{dT}{dW}=\\frac{(Ua/\\rho_b)(T_{\\mathrm{env}}-T)-\\Delta H(T)r'}{\\sum_iF_iC_{p,i}}"
      : "\\frac{dT}{dV}=\\frac{Ua(T_{\\mathrm{env}}-T)-\\Delta H(T)r}{\\sum_iF_iC_{p,i}}",
    substitution: `\\Delta C_p=${format(reactionHeatCapacityChange(i))}\\ \\mathrm{J\\,mol^{-1}K^{-1}},\\quad T_{\\mathrm{out}}=${format(coupledToTarget(target, i).t)}\\ \\mathrm{K}`,
  });
  if (i.reactor === "PBR" && i.pressureDrop) rows.push({ name: "压力降方程", expression: "\\frac{dp}{dW}=-\\frac{\\alpha}{2p}\\frac{F_T}{F_{T0}}\\frac{T}{T_0}", substitution: `\\alpha=${format(i.alpha)}\\ \\mathrm{kg_{cat}^{-1}}` });
  return rows;
}

function outletComponents(i: Inputs, outletX: number, pressure: number): OutletComponent[] {
  const labels = speciesLabels(i);
  const state = componentConcentrations(outletX, pressure, i);
  return [
    ...labels.reactants.map((symbol, index) => ({ symbol, role: "reactant" as const, inlet: i.reactantConcentrations[index], outlet: state.reactants[index] })),
    ...labels.products.map((symbol, index) => ({ symbol, role: "product" as const, inlet: i.productConcentrations[index], outlet: state.products[index] })),
    ...(i.inertConcentration > 0 ? [{ symbol: "I", role: "inert" as const, inlet: i.inertConcentration, outlet: state.inert }] : []),
  ];
}

function calculateMultipleResult(i: Inputs): Result {
  const solution = solveMultipleReactions(toMultipleReactionConfig(i));
  const meta = reactorMeta[i.reactor];
  const scaleSymbol = i.reactor === "BR" ? "t" : i.reactor === "PBR" ? "W" : "V";
  const symbols = networkSpeciesSymbols(i);
  const reactions = networkReactionLatexes(i);
  const desiredSymbol = symbols[i.networkDesiredSpecies];
  const referenceSymbol = symbols[i.networkReferenceSpecies];
  const conversionSymbol = symbols[i.networkConversionSpecies];
  const selectivityEnabled = hasValidSelectivityDefinition(i);
  const balance = i.reactor === "BR"
    ? "\\frac{dN_j}{dt}=R_jV"
    : i.reactor === "CSTR"
      ? "F_{j0}-F_j+R_jV=0"
      : i.reactor === "PBR"
        ? "\\frac{dF_j}{dW}=R'_j"
        : "\\frac{dF_j}{dV}=R_j";
  const rateExpressions = Array.from({ length: i.networkReactionCount }, (_, reaction) => {
    const powers = symbols.flatMap((symbol, species) => {
      const order = i.networkOrdersBySpecies[reaction]?.[species] ?? 0;
      return order > 0 ? [`a_${symbol}^{${compact(order)}}`] : [];
    }).join("");
    return `r_${reaction + 1}=k_${reaction + 1}${powers || ""}${i.networkReversible[reaction] ? `(1-Q_${reaction + 1}/K_${reaction + 1})` : ""}`;
  }).join(",\\quad ");
  let equationsRows: Result["equations"] = [
    {
      name: "多反应网络与逐反应速率",
      expression: `${reactions.join(",\\qquad ")},\\qquad ${rateExpressions}`,
      substitution: i.networkRateConstants.map((value, reaction) => `k_{${reaction + 1},\\mathrm{ref}}=${format(value)}`).join(",\\quad "),
    },
    {
      name: "物种净生成速率",
      expression: `R_j=\\sum_{m=1}^{${i.networkReactionCount}}\\nu_{mj}r_m=\\left(\\nu^T\\mathbf r\\right)_j`,
      substitution: symbols.map((symbol, species) => `R_${symbol}=${format(solution.outletNetRates[species])}`).join(",\\quad "),
    },
    {
      name: "多物种反应器衡算",
      expression: balance,
      substitution: `${scaleSymbol}=${format(solution.scale)}\\ \\mathrm{${meta.unit.replace("kg_cat", "kg_{cat}")}},\\quad X_{${conversionSymbol}}=${format(solution.outletX)}`,
    },
    {
      name: "选择性与收率",
      expression: `\\widetilde S_{${desiredSymbol}/${referenceSymbol}}=\\frac{F_${desiredSymbol}-F_{${desiredSymbol}0}}{F_${referenceSymbol}-F_{${referenceSymbol}0}},\\qquad Y_${desiredSymbol}=\\frac{F_${desiredSymbol}-F_{${desiredSymbol}0}}{F_{${conversionSymbol}0}}`,
      substitution: `\\widetilde S_{${desiredSymbol}/${referenceSymbol}}=${format(solution.overallSelectivity ?? Number.NaN)},\\quad Y_${desiredSymbol}=${format(solution.desiredYield)}`,
    },
  ];
  if (!selectivityEnabled) equationsRows = equationsRows.filter(row => row.name !== "选择性与收率");
  else {
    const selectionEquation = equationsRows.find(row => row.name === "选择性与收率");
    if (selectionEquation) {
      selectionEquation.expression = `S_{${desiredSymbol}/${referenceSymbol}}=\\frac{R_${desiredSymbol}}{R_${referenceSymbol}},\\qquad ${selectionEquation.expression}`;
      selectionEquation.substitution = `S_{${desiredSymbol}/${referenceSymbol},\\mathrm{out}}=${format(solution.instantaneousSelectivity ?? Number.NaN)},\\quad ${selectionEquation.substitution}`;
    }
  }
  if (i.networkEnforceConservation) equationsRows.push({
    name: "计量元素与电荷守恒",
    expression: "E\\nu^T=0,\\qquad \\sum_j z_j\\nu_{mj}=0",
    substitution: symbols.map((symbol, species) => `${symbol}=\\mathrm{${i.networkFormulas[species]}},\\ z_${symbol}=${i.networkCharges[species]}`).join(",\\quad "),
  });
  if (!i.isothermal) equationsRows.push({
    name: "多反应稳态能量衡算",
    expression: i.reactor === "PBR"
      ? "\\frac{dT}{dW}=\\frac{(Ua/\\rho_b)(T_{\\mathrm{env}}-T)-\\sum_m\\Delta H_m(T)r'_m}{\\sum_jF_jC_{P,j}}"
      : "\\frac{dT}{dV}=\\frac{Ua(T_{\\mathrm{env}}-T)-\\sum_m\\Delta H_m(T)r_m}{\\sum_jF_jC_{P,j}}",
    substitution: `T_{\\mathrm{out}}=${format(solution.outletTemperature)}\\ \\mathrm{K}`,
  });
  const outlet: OutletComponent[] = symbols.map((symbol, species) => {
    const produced = i.networkStoichiometry.some(row => row[species] > 0);
    const consumed = i.networkStoichiometry.some(row => row[species] < 0);
    const role: SpeciesRole = selectivityEnabled && species === i.networkDesiredSpecies && produced && consumed ? "intermediate"
      : selectivityEnabled && species === i.networkDesiredSpecies ? "desired"
      : selectivityEnabled && species === i.networkReferenceSpecies ? "undesired"
        : produced && consumed ? "intermediate"
          : consumed ? "reactant" : "product";
    return { symbol, role, inlet: i.networkFeed[species] ?? 0, outlet: solution.outletActivities[species] ?? 0 };
  });
  if (i.inertConcentration > 0) outlet.push({ symbol: "I", role: "inert", inlet: i.inertConcentration, outlet: solution.outletActivities[symbols.length] ?? 0 });
  const networkVolumetricFlow = i.phase === "gas"
    ? i.fa0 * R_BAR_L * i.temperature / i.networkFeed[i.networkConversionSpecies]
    : i.fa0 / i.networkFeed[i.networkConversionSpecies];
  const spaceTime = i.reactor === "CSTR" || i.reactor === "PFR" ? solution.scale / networkVolumetricFlow : null;
  const conversionNonmonotonic = solution.points.some((point, index) => index > 0 && point.x < solution.points[index - 1].x - 1e-7);
  const networkWarnings = [
    ...(i.networkReversible.some(Boolean) ? ["通用可逆网络不存在唯一的标量平衡转化率；程序按每条反应的 Qₘ/Kₘ 计算净速率。"] : []),
    ...(conversionNonmonotonic ? [`${conversionSymbol} 在当前网络中发生沿程再生，转化率并非单调；目标尺度按第一次达到目标的位置定义。`] : []),
    ...(!i.networkEnforceConservation ? ["当前采用拟组分模式，元素与电荷守恒未自动核查。"] : []),
  ];
  return {
    reactor: i.reactor,
    primaryLabel: i.solveFor === "target" ? `所需${meta.scale}` : `出口 ${conversionSymbol} 转化率`,
    primaryValue: i.solveFor === "target" ? solution.scale : solution.outletX,
    primaryUnit: i.solveFor === "target" ? meta.unit : "—",
    scale: solution.scale,
    scaleLabel: meta.scale,
    scaleUnit: meta.unit,
    outletX: solution.outletX,
    outletState: solution.outletActivities[i.networkConversionSpecies],
    outletRate: -solution.outletNetRates[i.networkConversionSpecies],
    limitingSymbols: [conversionSymbol],
    outletComponents: outlet,
    k: i.networkRateConstants[0],
    epsilon: 0,
    pressureRatio: solution.pressureRatio,
    outletTemperature: solution.outletTemperature,
    spaceTime,
    points: solution.points,
    equations: equationsRows,
    assumptions: [`${i.networkReactionCount} 条${i.networkReversible.some(Boolean) ? "含可逆步骤的" : "不可逆"}反应、${i.networkSpeciesCount} 个物种组成的计量网络`, i.isothermal ? "等温操作" : "逐反应热源求和的稳态能量衡算", i.phase === "liquid" ? "液相恒密度、浓度活度基准" : "理想气相、分压活度基准", `以物种摩尔数/摩尔流率为状态，${conversionSymbol} 转化率仅作为派生观察量`, i.networkEnforceConservation ? "计量矩阵已通过分子式元素与电荷守恒检查" : "拟组分模式：未启用分子式守恒检查"],
    conclusion: selectivityEnabled
      ? `${desiredSymbol} 被设为目标产物，${referenceSymbol} 为非目标产物；瞬时选择性按 R_${desiredSymbol}/R_${referenceSymbol}，总选择性按两者净生成量之比计算。`
      : "本案例未启用目标产物/非目标产物选择性定义；结果仅报告各反应速率与各物种净生成速率。",
    warnings: networkWarnings,
    method: solution.method,
    multiple: {
      networkType: i.networkType,
      speciesSymbols: symbols,
      conversionSymbol,
      desiredSymbol,
      referenceSymbol,
      reactionRates: solution.outletReactionRates,
      netRates: solution.outletNetRates,
      instantaneousSelectivity: solution.instantaneousSelectivity,
      overallSelectivity: solution.overallSelectivity,
      selectivityEnabled,
      desiredYield: solution.desiredYield,
      peakDesired: solution.peakDesired,
    },
  };
}

export function calculate(i: Inputs): Result {
  if (i.reactionMode === "multiple") return calculateMultipleResult(i);
  const problems = validate(i);
  if (problems.length) throw new Error(problems.join(" "));
  const k = rateConstant(i);
  const outletX = i.solveFor === "target" ? i.targetX : conversionAtSize(i.size, i);
  const scale = i.solveFor === "target" ? sizeToTarget(outletX, i) : i.size;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("数值求解没有得到有限正值，请检查输入量级和模型假设。");
  const points = buildPoints(outletX, scale, i);
  const end = points[points.length - 1];
  const meta = reactorMeta[i.reactor];
  const limiting = limitingAnalysis(i);
  const epsilon = gasExpansion(i);
  const warnings: string[] = [];
  if (i.phase === "gas" && Math.abs(epsilon) > 1) warnings.push("气相体积变化显著，结果对自动计算的 ε 较敏感。");
  if (i.reactor === "PBR" && i.pressureDrop) {
    if (end.p < 0.32) warnings.push("床层已接近压力降模型失效边界，请重新检查 α、床层尺度和入口压力。");
    else if (end.p < 0.8) warnings.push("出口压力下降超过 20%，忽略压降会明显高估反应速率。");
  }
  const conclusions: Record<Reactor, string> = {
    BR: i.phase === "gas" ? "气相分批体系按恒温恒压、变体积处理；各反应物分压和体积变化同时进入时间积分。" : "液相分批体系按恒温恒容处理，答案由多反应物浓度历程上的速率积分得到。",
    CSTR: `全釜按出口组成运行；所有反应物的出口${i.phase === "gas" ? "分压" : "浓度"}共同决定反应速率。`,
    PFR: i.isothermal ? "各反应物沿程按计量关系消耗，体积是速率倒数曲线的积分面积。" : "物料衡算与能量衡算联立；沿程温度同时改变 Arrhenius 速率常数与反应焓。",
    PBR: i.isothermal ? "催化剂质量是设计尺度；气相组成、惰性稀释和压降会共同影响速率。" : "物料、能量与所选压降条件联立；温度、分压和速率相互耦合。",
  };
  const spaceTime = i.reactor === "CSTR" || i.reactor === "PFR" ? scale / inletVolumetricFlow(i) : null;
  return {
    reactor: i.reactor,
    primaryLabel: i.solveFor === "target" ? `所需${meta.scale}` : "出口转化率",
    primaryValue: i.solveFor === "target" ? scale : outletX,
    primaryUnit: i.solveFor === "target" ? meta.unit : "—",
    scale,
    scaleLabel: meta.scale,
    scaleUnit: meta.unit,
    outletX,
    outletState: end.state,
    outletRate: end.rate,
    limitingSymbols: limiting.symbols,
    outletComponents: outletComponents(i, outletX, end.p),
    k,
    epsilon,
    pressureRatio: end.p,
    outletTemperature: end.t,
    spaceTime,
    points,
    equations: equations(i, k, outletX, scale),
    assumptions: [i.reversible ? "单一可逆反应；逆向驱动力由反应商和平衡常数确定" : "单一不可逆反应（支持多反应物与多产物）", i.isothermal ? "等温操作" : "稳态非恒温能量衡算，定压热容按输入值处理", i.phase === "liquid" ? "液相恒密度" : "理想气相，以各组分分压为动力学基准", i.reactor === "PBR" ? "速率以催化剂质量为基准" : "速率以反应体积为基准"],
    conclusion: conclusions[i.reactor],
    warnings,
    method: i.reactor === "CSTR"
      ? "代数方程求解"
      : usesCoupledBalance(i)
        ? `四阶 Runge–Kutta 联立物料${i.isothermal ? "" : "、能量"}${i.pressureDrop ? "与压降" : ""}方程`
        : "Simpson 数值积分与二分反求",
  };
}

export function compareCstrPfr(i: Inputs): [Result, Result] {
  return [
    calculate({ ...i, reactor: "CSTR", solveFor: "target", pressureDrop: false }),
    calculate({ ...i, reactor: "PFR", solveFor: "target", pressureDrop: false }),
  ];
}

export function levenspiel(i: Inputs): Array<{ x: number; y: number }> {
  return Array.from({ length: 101 }, (_, n) => {
    const x = i.targetX * n / 100;
    return { x, y: basisMolarFlow(i) / Math.max(rateAt(x, 1, i.temperature, i), EPS) };
  });
}

export function format(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 10000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) return value.toExponential(3);
  return value.toFixed(Math.abs(value) < 10 ? 4 : 2);
}
