import type { Phase } from "./models.ts";

const R_BAR_L = 0.08314462618;
const EPS = 1e-12;

export interface MaterialStream {
  id: "feed" | "product";
  role: "inlet" | "outlet";
  phase: Phase;
  temperature: number;
  pressure: number;
  totalMolarFlow: number;
  componentMolarFlows: number[];
  moleFractions: number[];
  activities: number[];
  volumetricFlow: number;
  activityUnit: "bar" | "mol/L";
}

export interface StreamSource {
  phase: Phase;
  temperature: number;
  activities: number[];
  basisSpecies: number;
  basisMolarFlow: number;
}

/**
 * Converts the UI activity basis into one canonical material-stream state.
 * Gas activities are partial pressures; liquid activities are concentrations.
 */
export function materialStreamFromSource(source: StreamSource, id: MaterialStream["id"] = "feed"): MaterialStream {
  const activities = source.activities.map(value => Number.isFinite(value) ? Math.max(0, value) : 0);
  const basisActivity = activities[source.basisSpecies] ?? 0;
  const pressure = source.phase === "gas" ? activities.reduce((sum, value) => sum + value, 0) : 1;
  const volumetricFlow = basisActivity > EPS
    ? source.phase === "gas"
      ? source.basisMolarFlow * R_BAR_L * source.temperature / basisActivity
      : source.basisMolarFlow / basisActivity
    : 0;
  const componentMolarFlows = source.phase === "gas"
    ? pressure > EPS
      ? activities.map(value => volumetricFlow * value / (R_BAR_L * source.temperature))
      : activities.map(() => 0)
    : activities.map(value => value * volumetricFlow);
  const totalMolarFlow = componentMolarFlows.reduce((sum, value) => sum + value, 0);
  const moleFractions = totalMolarFlow > EPS
    ? componentMolarFlows.map(value => value / totalMolarFlow)
    : componentMolarFlows.map(() => 0);

  return {
    id,
    role: id === "feed" ? "inlet" : "outlet",
    phase: source.phase,
    temperature: source.temperature,
    pressure,
    totalMolarFlow,
    componentMolarFlows,
    moleFractions,
    activities,
    volumetricFlow,
    activityUnit: source.phase === "gas" ? "bar" : "mol/L",
  };
}

export function streamBasisMolarFlow(stream: MaterialStream, basisSpecies: number): number {
  return stream.componentMolarFlows[basisSpecies] ?? 0;
}
