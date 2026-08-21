import { limitingAnalysis, networkReactionLatexes, networkSpeciesSymbols, normalizeInputs, type Inputs, type Phase, type Reactor } from "./models.ts";
import type { NetworkSolver } from "./multipleReactions.ts";
import { materialStreamFromSource, type MaterialStream } from "./materialStream.ts";

export interface ComponentDefinition {
  id: string;
  symbol: string;
  name: string;
  formula: string;
  charge: number;
  inert: boolean;
  heatCapacity: number;
}

export interface ReactionDefinition {
  id: string;
  equation: string;
  stoichiometry: number[];
  orders: number[];
  rateConstant: number;
  activationEnergy: number;
  referenceTemperature: number;
  reversible: boolean;
  equilibriumConstant: number;
  heatOfReaction: number;
}

export type MaterialStreamDefinition = MaterialStream;

export interface ReactorBlockDefinition {
  id: "R-101";
  type: Reactor;
  isothermal: boolean;
  pressureDrop: boolean;
  environmentTemperature: number;
  heatTransferCoefficient: number;
  specificArea: number;
  catalystBulkDensity: number;
  pressureDropCoefficient: number;
}

export interface SolveSpecification {
  mode: "target" | "size";
  conversionSpecies: number;
  targetConversion: number;
  size: number;
  solver: NetworkSolver;
  relativeTolerance: number;
  absoluteTolerance: number;
  selectivity: { desiredSpecies: number; referenceSpecies: number } | null;
}

export interface CaseConfiguration {
  schemaVersion: 16;
  phase: Phase;
  idealGas: boolean;
  conservationCheck: boolean;
  components: ComponentDefinition[];
  reactions: ReactionDefinition[];
  streams: MaterialStreamDefinition[];
  reactor: ReactorBlockDefinition;
  specification: SolveSpecification;
}

export function toUnifiedNetwork(value: Inputs): Inputs {
  const input = normalizeInputs(value);
  if (input.reactionMode === "multiple") return normalizeInputs({ ...input, networkType: "custom" });

  const reactantCount = input.reactantCount;
  const productCount = input.productCount;
  const includeInert = input.inertConcentration > 0 && reactantCount + productCount < 8;
  const count = reactantCount + productCount + (includeInert ? 1 : 0);
  const basis = limitingAnalysis(input).basisIndex;
  const basisFlow = input.fa0 * input.reactantConcentrations[basis] / Math.max(input.reactantConcentrations[0], 1e-12);
  const stoichiometry = [
    ...input.reactantStoich.map(value => -Math.abs(value)),
    ...input.productStoich.map(value => Math.abs(value)),
    ...(includeInert ? [0] : []),
  ];
  const orders = [
    ...input.reactantOrders,
    ...Array(productCount + (includeInert ? 1 : 0)).fill(0),
  ];

  return normalizeInputs({
    ...input,
    reactionMode: "multiple",
    networkType: "custom",
    networkSpeciesCount: count,
    networkReactionCount: 1,
    networkStoichiometry: [stoichiometry],
    networkOrdersBySpecies: [orders],
    networkFeed: [...input.reactantConcentrations, ...input.productConcentrations, ...(includeInert ? [input.inertConcentration] : [])],
    networkFormulas: Array(count).fill(""),
    networkNames: Array(count).fill(""),
    networkInertSpecies: [...Array(reactantCount + productCount).fill(false), ...(includeInert ? [true] : [])],
    networkCharges: Array(count).fill(0),
    networkHeatCapacities: [...input.reactantHeatCapacities, ...input.productHeatCapacities, ...(includeInert ? [input.inertHeatCapacity] : [])],
    networkRateConstants: [input.kRef],
    networkActivationEnergies: [input.activationEnergy],
    networkReferenceTemperatures: [input.refTemperature],
    networkElementary: [input.reactantOrders.every((order, index) => Math.abs(order - input.reactantStoich[index]) < 1e-12)],
    networkHeatOfReactions: [input.heatOfReaction],
    networkReversible: [input.reversible],
    networkEquilibriumConstants: [input.equilibriumConstant],
    networkDesiredSpecies: Math.min(reactantCount, count - 1),
    networkReferenceSpecies: basis === Math.min(reactantCount, count - 1) ? 0 : basis,
    networkConversionSpecies: basis,
    networkSelectivityEnabled: false,
    fa0: basisFlow,
    inertConcentration: includeInert ? 0 : input.inertConcentration,
  });
}

export function toCaseConfiguration(value: Inputs): CaseConfiguration {
  const input = toUnifiedNetwork(value);
  const symbols = networkSpeciesSymbols(input);
  const equations = networkReactionLatexes(input);
  const feed = materialStreamFromSource({
    phase: input.phase,
    temperature: input.temperature,
    activities: input.networkFeed,
    basisSpecies: input.networkConversionSpecies,
    basisMolarFlow: input.fa0,
  });
  return {
    schemaVersion: 16,
    phase: input.phase,
    idealGas: input.phase === "gas",
    conservationCheck: input.networkEnforceConservation,
    components: symbols.map((symbol, index) => ({
      id: `species-${index + 1}`,
      symbol,
      name: input.networkNames[index] ?? "",
      formula: input.networkFormulas[index] ?? "",
      charge: input.networkCharges[index] ?? 0,
      inert: input.networkInertSpecies[index] ?? false,
      heatCapacity: input.networkHeatCapacities[index] ?? 80,
    })),
    reactions: Array.from({ length: input.networkReactionCount }, (_, index) => ({
      id: `reaction-${index + 1}`,
      equation: equations[index],
      stoichiometry: [...input.networkStoichiometry[index]],
      orders: [...input.networkOrdersBySpecies[index]],
      rateConstant: input.networkRateConstants[index],
      activationEnergy: input.networkActivationEnergies[index],
      referenceTemperature: input.networkReferenceTemperatures[index],
      reversible: input.networkReversible[index],
      equilibriumConstant: input.networkEquilibriumConstants[index],
      heatOfReaction: input.networkHeatOfReactions[index],
    })),
    streams: [feed, { ...feed, id: "product", role: "outlet", componentMolarFlows: [], moleFractions: [], activities: [], totalMolarFlow: 0, volumetricFlow: 0 }],
    reactor: {
      id: "R-101",
      type: input.reactor,
      isothermal: input.isothermal,
      pressureDrop: input.pressureDrop,
      environmentTemperature: input.environmentTemperature,
      heatTransferCoefficient: input.heatTransferCoefficient,
      specificArea: input.specificArea,
      catalystBulkDensity: input.catalystBulkDensity,
      pressureDropCoefficient: input.alpha,
    },
    specification: {
      mode: input.solveFor,
      conversionSpecies: input.networkConversionSpecies,
      targetConversion: input.targetX,
      size: input.size,
      solver: input.networkSolver,
      relativeTolerance: input.networkRelativeTolerance,
      absoluteTolerance: input.networkAbsoluteTolerance,
      selectivity: input.networkSelectivityEnabled
        ? { desiredSpecies: input.networkDesiredSpecies, referenceSpecies: input.networkReferenceSpecies }
        : null,
    },
  };
}

export function toProductMaterialStream(value: Inputs, outlet: { outletX: number; outletTemperature: number; pressureRatio: number; outletComponents: Array<{ outlet: number }> }): MaterialStream {
  const input = toUnifiedNetwork(value);
  const basisOutletFlow = input.fa0 * Math.max(0, 1 - outlet.outletX);
  const stream = materialStreamFromSource({
    phase: input.phase,
    temperature: outlet.outletTemperature,
    activities: outlet.outletComponents.slice(0, input.networkSpeciesCount).map(component => component.outlet),
    basisSpecies: input.networkConversionSpecies,
    basisMolarFlow: basisOutletFlow,
  }, "product");
  const inletPressure = input.networkFeed.reduce((sum, activity) => sum + activity, 0);
  return { ...stream, pressure: input.phase === "gas" ? inletPressure * outlet.pressureRatio : stream.pressure };
}
