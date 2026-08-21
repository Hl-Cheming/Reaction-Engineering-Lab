import { analyzeConservation } from "./chemistry.ts";

export type MultipleReactor = "BR" | "CSTR" | "PFR" | "PBR";
export type MultiplePhase = "liquid" | "gas";
export type NetworkType = "parallel" | "series" | "custom";
export type NetworkSolver = "auto" | "rk45" | "implicit";

export interface MultipleReactionConfig {
  reactor: MultipleReactor;
  phase: MultiplePhase;
  solveFor: "target" | "size";
  targetX: number;
  size: number;
  networkType: NetworkType;
  speciesSymbols: string[];
  speciesFormulas: string[];
  speciesCharges: number[];
  enforceConservation: boolean;
  stoichiometry: number[][];
  feed: number[];
  inertFeed: number;
  fa0: number;
  kRef: number[];
  orders: number[][];
  reversible: boolean[];
  equilibriumConstants: number[];
  activationEnergies: number[];
  referenceTemperatures: number[];
  temperature: number;
  isothermal: boolean;
  heatOfReactions: number[];
  heatCapacities: number[];
  inertHeatCapacity: number;
  environmentTemperature: number;
  heatTransferCoefficient: number;
  specificArea: number;
  catalystBulkDensity: number;
  pressureDrop: boolean;
  alpha: number;
  conversionSpecies: number;
  selectivityEnabled: boolean;
  desiredSpecies: number;
  referenceSpecies: number;
  solver: NetworkSolver;
  relativeTolerance: number;
  absoluteTolerance: number;
}

export interface NetworkPoint {
  s: number;
  x: number;
  state: number;
  rate: number;
  p: number;
  t: number;
  xeq: null;
  flows: number[];
  activities: number[];
  reactionRates: number[];
  netRates: number[];
  instantaneousSelectivity: number | null;
}

export interface MultipleReactionSolution {
  scale: number;
  outletX: number;
  pressureRatio: number;
  outletTemperature: number;
  points: NetworkPoint[];
  outletActivities: number[];
  outletFlows: number[];
  outletReactionRates: number[];
  outletNetRates: number[];
  instantaneousSelectivity: number | null;
  overallSelectivity: number | null;
  desiredYield: number;
  peakDesired: { scale: number; value: number } | null;
  conversionSpecies: number;
  method: string;
}

const R = 8.314462618;
const R_BAR_L = 0.08314462618;
const EPS = 1e-12;

type State = number[];

function pressureIndex(config: MultipleReactionConfig): number {
  return config.speciesSymbols.length;
}

function temperatureIndex(config: MultipleReactionConfig): number {
  return config.speciesSymbols.length + 1;
}

function inletVolumetricFlow(config: MultipleReactionConfig): number {
  const basis = config.conversionSpecies;
  return config.phase === "gas"
    ? config.fa0 * R_BAR_L * config.temperature / config.feed[basis]
    : config.fa0 / config.feed[basis];
}

function inletSpeciesState(config: MultipleReactionConfig): number[] {
  if (config.reactor === "BR") {
    if (config.phase === "liquid") return [...config.feed];
    return config.feed.map(value => value / (R_BAR_L * config.temperature));
  }
  const factor = config.fa0 / config.feed[config.conversionSpecies];
  return config.feed.map(value => value * factor);
}

function inletInertState(config: MultipleReactionConfig): number {
  if (config.reactor === "BR") {
    return config.phase === "liquid" ? config.inertFeed : config.inertFeed / (R_BAR_L * config.temperature);
  }
  return config.inertFeed * config.fa0 / config.feed[config.conversionSpecies];
}

function inletPressure(config: MultipleReactionConfig): number {
  return config.feed.reduce((sum, value) => sum + value, config.inertFeed);
}

function activities(state: State, config: MultipleReactionConfig): number[] {
  const count = config.speciesSymbols.length;
  const species = state.slice(0, count).map(value => Math.max(0, value));
  if (config.phase === "liquid") {
    if (config.reactor === "BR") return species;
    const volumetricFlow = inletVolumetricFlow(config);
    return species.map(value => value / volumetricFlow);
  }
  const inert = inletInertState(config);
  const total = species.reduce((sum, value) => sum + value, inert);
  const totalPressure = inletPressure(config) * Math.max(state[pressureIndex(config)], EPS);
  return species.map(value => totalPressure * value / Math.max(total, EPS));
}

function rateConstants(temperature: number, config: MultipleReactionConfig): number[] {
  return config.kRef.map((value, index) => value * Math.exp(
    (-config.activationEnergies[index] / R) * (1 / temperature - 1 / config.referenceTemperatures[index]),
  ));
}

function reactionHeatCapacityChange(reaction: number, config: MultipleReactionConfig): number {
  return config.stoichiometry[reaction].reduce(
    (sum, coefficient, species) => sum + coefficient * config.heatCapacities[species], 0,
  );
}

function heatOfReactionAt(reaction: number, temperature: number, config: MultipleReactionConfig): number {
  return config.heatOfReactions[reaction]
    + reactionHeatCapacityChange(reaction, config) * (temperature - config.referenceTemperatures[reaction]);
}

function equilibriumConstantAt(reaction: number, temperature: number, config: MultipleReactionConfig): number {
  if (!config.reversible[reaction]) return Number.POSITIVE_INFINITY;
  const deltaCp = reactionHeatCapacityChange(reaction, config);
  const tRef = config.referenceTemperatures[reaction];
  const integral = config.heatOfReactions[reaction] * (1 / tRef - 1 / temperature)
    + deltaCp * (Math.log(temperature / tRef) + tRef * (1 / temperature - 1 / tRef));
  return config.equilibriumConstants[reaction] * Math.exp(integral / R);
}

function reactionQuotient(reaction: number, driving: number[], config: MultipleReactionConfig): number {
  let logarithm = 0;
  let zeroProduct = false;
  let zeroReactant = false;
  for (let species = 0; species < config.speciesSymbols.length; species++) {
    const coefficient = config.stoichiometry[reaction][species];
    if (Math.abs(coefficient) <= EPS) continue;
    const value = driving[species];
    if (value <= EPS) {
      if (coefficient > 0) zeroProduct = true;
      else zeroReactant = true;
      continue;
    }
    logarithm += coefficient * Math.log(value);
  }
  if (zeroProduct) return 0;
  if (zeroReactant) return Number.POSITIVE_INFINITY;
  return Math.exp(Math.max(-700, Math.min(700, logarithm)));
}

function rates(state: State, config: MultipleReactionConfig): number[] {
  const driving = activities(state, config);
  const k = rateConstants(state[temperatureIndex(config)], config);
  return k.map((value, reaction) => {
    const forward = config.orders[reaction].reduce(
      (product, order, species) => product * Math.pow(Math.max(driving[species], 0), order), value,
    );
    if (!config.reversible[reaction]) return forward;
    const quotient = reactionQuotient(reaction, driving, config);
    const equilibrium = equilibriumConstantAt(reaction, state[temperatureIndex(config)], config);
    if (!Number.isFinite(quotient)) {
      const reverseActivity = config.stoichiometry[reaction].reduce(
        (product, coefficient, species) => coefficient > 0
          ? product * Math.pow(Math.max(driving[species], 0), coefficient)
          : product,
        1,
      );
      return -value * reverseActivity / equilibrium;
    }
    return forward * (1 - quotient / equilibrium);
  });
}

function netSpeciesRates(reactionRates: number[], config: MultipleReactionConfig): number[] {
  return Array.from({ length: config.speciesSymbols.length }, (_, species) => (
    config.stoichiometry.reduce((sum, row, reaction) => sum + row[species] * reactionRates[reaction], 0)
  ));
}

function heatCapacityFlow(state: State, config: MultipleReactionConfig): number {
  const species = state.slice(0, config.speciesSymbols.length);
  return species.reduce(
    (sum, value, index) => sum + Math.max(value, 0) * config.heatCapacities[index],
    inletInertState(config) * config.inertHeatCapacity,
  );
}

function derivatives(state: State, config: MultipleReactionConfig): State {
  const count = config.speciesSymbols.length;
  const reactionRates = rates(state, config);
  const net = netSpeciesRates(reactionRates, config);
  let stateFactor = 1;
  if (config.reactor === "BR" && config.phase === "gas") {
    const totalMoles = state.slice(0, count).reduce((sum, value) => sum + Math.max(value, 0), inletInertState(config));
    stateFactor = totalMoles * R_BAR_L * state[temperatureIndex(config)]
      / Math.max(inletPressure(config) * state[pressureIndex(config)], EPS);
  }
  const speciesDerivatives = net.map(value => value * stateFactor);
  const total = state.slice(0, count).reduce((sum, value) => sum + Math.max(value, 0), inletInertState(config));
  const inletTotal = inletSpeciesState(config).reduce((sum, value) => sum + value, inletInertState(config));
  const dp = config.reactor === "PBR" && config.phase === "gas" && config.pressureDrop
    ? -config.alpha * (total / Math.max(inletTotal, EPS))
      * (state[temperatureIndex(config)] / config.temperature)
      / (2 * Math.max(state[pressureIndex(config)], EPS))
    : 0;
  let dT = 0;
  if (!config.isothermal && (config.reactor === "PFR" || config.reactor === "PBR")) {
    const areaFactor = config.reactor === "PBR" ? config.specificArea / config.catalystBulkDensity : config.specificArea;
    const heatTransfer = config.heatTransferCoefficient * areaFactor
      * (config.environmentTemperature - state[temperatureIndex(config)]);
    const reactionHeat = reactionRates.reduce(
      (sum, value, reaction) => sum - heatOfReactionAt(reaction, state[temperatureIndex(config)], config) * value, 0,
    );
    dT = (heatTransfer + reactionHeat) / Math.max(heatCapacityFlow(state, config), EPS);
  }
  return [...speciesDerivatives, dp, dT];
}

function addState(state: State, delta: State, factor: number): State {
  return state.map((value, index) => value + factor * delta[index]);
}

function combineState(state: State, h: number, terms: Array<[number, State]>): State {
  return state.map((value, index) => value + h * terms.reduce((sum, [factor, vector]) => sum + factor * vector[index], 0));
}

function physicalProblem(state: State, config: MultipleReactionConfig): string | null {
  for (let index = 0; index < config.speciesSymbols.length; index++) {
    if (!Number.isFinite(state[index])) return `${config.speciesSymbols[index]} 状态量不是有限值`;
    if (state[index] < -1e-8) return `${config.speciesSymbols[index]} 状态量变为负值`;
  }
  if (!Number.isFinite(state[pressureIndex(config)]) || state[pressureIndex(config)] <= 0.02) return "气相压力已越过模型边界";
  if (!Number.isFinite(state[temperatureIndex(config)]) || state[temperatureIndex(config)] < 150 || state[temperatureIndex(config)] > 2500) return "温度已越过 150–2500 K 的模型边界";
  return null;
}

function normalizedError(error: State, current: State, next: State, config: MultipleReactionConfig): number {
  const squared = error.reduce((sum, value, index) => {
    const weight = config.absoluteTolerance + config.relativeTolerance * Math.max(Math.abs(current[index]), Math.abs(next[index]));
    return sum + (value / Math.max(weight, EPS)) ** 2;
  }, 0);
  return Math.sqrt(squared / error.length);
}

function rk45Step(state: State, h: number, config: MultipleReactionConfig): { next: State; error: State } {
  const k1 = derivatives(state, config);
  const k2 = derivatives(combineState(state, h, [[1 / 5, k1]]), config);
  const k3 = derivatives(combineState(state, h, [[3 / 40, k1], [9 / 40, k2]]), config);
  const k4 = derivatives(combineState(state, h, [[44 / 45, k1], [-56 / 15, k2], [32 / 9, k3]]), config);
  const k5 = derivatives(combineState(state, h, [[19372 / 6561, k1], [-25360 / 2187, k2], [64448 / 6561, k3], [-212 / 729, k4]]), config);
  const k6 = derivatives(combineState(state, h, [[9017 / 3168, k1], [-355 / 33, k2], [46732 / 5247, k3], [49 / 176, k4], [-5103 / 18656, k5]]), config);
  const next = combineState(state, h, [[35 / 384, k1], [500 / 1113, k3], [125 / 192, k4], [-2187 / 6784, k5], [11 / 84, k6]]);
  const k7 = derivatives(next, config);
  const fourth = combineState(state, h, [[5179 / 57600, k1], [7571 / 16695, k3], [393 / 640, k4], [-92097 / 339200, k5], [187 / 2100, k6], [1 / 40, k7]]);
  return { next, error: next.map((value, index) => value - fourth[index]) };
}

function implicitEulerStep(state: State, h: number, config: MultipleReactionConfig): State {
  let next = addState(state, derivatives(state, config), h);
  const residual = (candidate: State) => {
    const slope = derivatives(candidate, config);
    return candidate.map((value, index) => value - state[index] - h * slope[index]);
  };
  for (let iteration = 0; iteration < 18; iteration++) {
    const current = residual(next);
    const residualScale = Math.max(...current.map(Math.abs));
    if (residualScale <= Math.max(config.absoluteTolerance * 0.1, 1e-11)) return next;
    const jacobian = Array.from({ length: state.length }, () => Array(state.length).fill(0));
    for (let column = 0; column < state.length; column++) {
      const increment = Math.max(1e-8, Math.abs(next[column]) * 1e-7);
      const perturbed = [...next];
      perturbed[column] += increment;
      const changed = residual(perturbed);
      for (let row = 0; row < state.length; row++) jacobian[row][column] = (changed[row] - current[row]) / increment;
    }
    const delta = solveLinear(jacobian, current.map(value => -value));
    let damping = 1;
    while (damping > 1e-5 && physicalProblem(next.map((value, index) => value + damping * delta[index]), config)) damping /= 2;
    next = next.map((value, index) => value + damping * delta[index]);
  }
  throw new Error("隐式步 Newton 迭代未收敛");
}

function implicitAdaptiveStep(state: State, h: number, config: MultipleReactionConfig): { next: State; error: State } {
  const full = implicitEulerStep(state, h, config);
  const firstHalf = implicitEulerStep(state, h / 2, config);
  const secondHalf = implicitEulerStep(firstHalf, h / 2, config);
  return { next: secondHalf, error: secondHalf.map((value, index) => value - full[index]) };
}

class StiffnessDetected extends Error {}

function integrateAdaptive(
  scale: number,
  config: MultipleReactionConfig,
  collectPoints: boolean,
  solver: Exclude<NetworkSolver, "auto">,
): { state: State; points: NetworkPoint[]; method: string } {
  let state = initialState(config);
  const points: NetworkPoint[] = collectPoints ? [point(0, state, config)] : [];
  if (scale <= 0) return { state, points, method: solver === "rk45" ? "自适应 Dormand–Prince RK45" : "自适应隐式后向欧拉（刚性）" };
  const intervals = collectPoints ? 100 : 1;
  const maximumStep = scale / 100;
  let position = 0;
  let stepSize = maximumStep;
  const minimumStep = Math.max(scale * 1e-13, 1e-15);
  let accepted = 0;
  let rejected = 0;
  for (let output = 1; output <= intervals; output++) {
    const target = scale * output / intervals;
    while (position < target - Math.max(1, target) * 1e-14) {
      if (solver === "rk45" && config.solver === "auto" && accepted >= 3000) throw new StiffnessDetected();
      if (accepted + rejected > 200000) throw new Error("自适应积分步数超过上限；请检查动力学量级或改用刚性求解。 ");
      const h = Math.min(stepSize, target - position);
      let trial: { next: State; error: State } | null = null;
      try {
        trial = solver === "rk45" ? rk45Step(state, h, config) : implicitAdaptiveStep(state, h, config);
      } catch {
        trial = null;
      }
      const problem = trial ? physicalProblem(trial.next, config) : "当前步未收敛";
      const error = trial && !problem ? normalizedError(trial.error, state, trial.next, config) : Number.POSITIVE_INFINITY;
      if (trial && !problem && error <= 1) {
        state = trial.next.map((value, index) => index < config.speciesSymbols.length && value < 0 ? 0 : value);
        position += h;
        accepted++;
        const exponent = solver === "rk45" ? -0.2 : -0.5;
        const factor = error === 0 ? 5 : Math.max(0.2, Math.min(5, 0.9 * error ** exponent));
        stepSize = Math.min(maximumStep, h * factor);
      } else {
        rejected++;
        stepSize = h * 0.25;
        if (solver === "rk45" && config.solver === "auto" && rejected >= 30 && rejected > accepted / 2) throw new StiffnessDetected();
        if (stepSize < minimumStep) {
          if (solver === "rk45" && config.solver === "auto") throw new StiffnessDetected();
          throw new Error(`积分无法在容差内跨越 ${position.toExponential(3)}；${problem ?? "局部误差过大"}。`);
        }
      }
    }
    if (collectPoints) points.push(point(target, state, config));
  }
  const method = solver === "rk45"
    ? `自适应 Dormand–Prince RK45（接受 ${accepted} 步，拒绝 ${rejected} 步）`
    : `自适应隐式后向欧拉（刚性；接受 ${accepted} 步，拒绝 ${rejected} 步）`;
  return { state, points, method };
}

function conversion(state: State, config: MultipleReactionConfig): number {
  const basis = config.conversionSpecies;
  const inlet = inletSpeciesState(config)[basis];
  return (inlet - state[basis]) / Math.max(inlet, EPS);
}

function selectivity(net: number[], config: MultipleReactionConfig): number | null {
  if (!config.selectivityEnabled) return null;
  const desired = net[config.desiredSpecies];
  const reference = net[config.referenceSpecies];
  return desired > EPS && reference > EPS ? desired / reference : null;
}

function point(scale: number, state: State, config: MultipleReactionConfig): NetworkPoint {
  const count = config.speciesSymbols.length;
  const reactionRates = rates(state, config);
  const net = netSpeciesRates(reactionRates, config);
  const driving = activities(state, config);
  const inert = inletInertState(config);
  const total = state.slice(0, count).reduce((sum, value) => sum + value, inert);
  const inertActivity = config.phase === "gas"
    ? inletPressure(config) * state[pressureIndex(config)] * inert / Math.max(total, EPS)
    : config.inertFeed;
  return {
    s: scale,
    x: conversion(state, config),
    state: driving[config.conversionSpecies],
    rate: -net[config.conversionSpecies],
    p: state[pressureIndex(config)],
    t: state[temperatureIndex(config)],
    xeq: null,
    flows: [...state.slice(0, count), ...(config.inertFeed > 0 ? [inert] : [])],
    activities: [...driving, ...(config.inertFeed > 0 ? [inertActivity] : [])],
    reactionRates,
    netRates: net,
    instantaneousSelectivity: selectivity(net, config),
  };
}

function initialState(config: MultipleReactionConfig): State {
  return [...inletSpeciesState(config), 1, config.temperature];
}

function integratePlugOrBatch(scale: number, config: MultipleReactionConfig, collectPoints: boolean): { state: State; points: NetworkPoint[]; method: string } {
  if (config.solver !== "auto") return integrateAdaptive(scale, config, collectPoints, config.solver);
  try {
    return integrateAdaptive(scale, config, collectPoints, "rk45");
  } catch (error) {
    if (!(error instanceof StiffnessDetected)) throw error;
    const result = integrateAdaptive(scale, config, collectPoints, "implicit");
    return { ...result, method: `${result.method}；自动模式由 RK45 切换` };
  }
}

function solveLinear(matrix: number[][], vector: number[]): number[] {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < vector.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < vector.length; row++) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    if (Math.abs(augmented[column][column]) < 1e-14) throw new Error("CSTR 多反应方程的雅可比矩阵接近奇异。");
    const divisor = augmented[column][column];
    for (let entry = column; entry <= vector.length; entry++) augmented[column][entry] /= divisor;
    for (let row = 0; row < vector.length; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry <= vector.length; entry++) augmented[row][entry] -= factor * augmented[column][entry];
    }
  }
  return augmented.map(row => row[vector.length]);
}

function cstrState(scale: number, config: MultipleReactionConfig, guess?: State): State {
  const inlet = inletSpeciesState(config);
  if (scale <= 0) return initialState(config);
  const count = config.speciesSymbols.length;
  let state = guess ? [...guess] : initialState(config);
  const residual = (candidate: State): number[] => {
    const net = netSpeciesRates(rates(candidate, config), config);
    return candidate.slice(0, count).map((value, index) => value - inlet[index] - scale * net[index]);
  };
  for (let iteration = 0; iteration < 60; iteration++) {
    const current = residual(state);
    if (Math.max(...current.map(Math.abs)) < 1e-10) return state;
    const jacobian = Array.from({ length: count }, () => Array(count).fill(0));
    for (let column = 0; column < count; column++) {
      const step = Math.max(1e-7, Math.abs(state[column]) * 1e-6);
      const perturbed = [...state];
      perturbed[column] += step;
      const changed = residual(perturbed);
      for (let row = 0; row < count; row++) jacobian[row][column] = (changed[row] - current[row]) / step;
    }
    const delta = solveLinear(jacobian, current.map(value => -value));
    let damping = 1;
    while (damping > 1e-6 && delta.some((value, index) => state[index] + damping * value < 0)) damping /= 2;
    for (let index = 0; index < count; index++) state[index] = Math.max(0, state[index] + damping * delta[index]);
    state[pressureIndex(config)] = 1;
    state[temperatureIndex(config)] = config.temperature;
  }
  throw new Error("CSTR 多反应耦合代数方程未收敛；请检查尺度和动力学量级。");
}

function evaluateScale(scale: number, config: MultipleReactionConfig, collectPoints = false): { state: State; points: NetworkPoint[]; method: string } {
  if (config.reactor !== "CSTR") return integratePlugOrBatch(scale, config, collectPoints);
  if (!collectPoints) return { state: cstrState(scale, config), points: [], method: "阻尼 Newton 联立代数方程" };
  const points: NetworkPoint[] = [];
  let guess: State | undefined;
  for (let index = 0; index <= 100; index++) {
    const currentScale = scale * index / 100;
    guess = cstrState(currentScale, config, guess);
    points.push(point(currentScale, guess, config));
  }
  return { state: guess as State, points, method: "阻尼 Newton 联立代数方程" };
}

function scaleForTarget(config: MultipleReactionConfig): number {
  const symbol = config.speciesSymbols[config.conversionSpecies];
  const cache = new Map<number, number>();
  const conversionAtScale = (scale: number) => {
    if (cache.has(scale)) return cache.get(scale) as number;
    try {
      const value = conversion(evaluateScale(scale, config, true).state, config);
      cache.set(scale, value);
      return value;
    } catch { return Number.NaN; }
  };
  let previousScale = 0;
  let previousResidual = -config.targetX;
  let bracket: [number, number] | null = null;
  let upper = 1e-6;
  for (let expansion = 0; expansion < 70 && !bracket; expansion++) {
    const start = expansion === 0 ? 0 : upper / 2;
    for (let sample = 1; sample <= 8; sample++) {
      const currentScale = start + (upper - start) * sample / 8;
      const current = conversionAtScale(currentScale);
      if (!Number.isFinite(current)) break;
      const residual = current - config.targetX;
      if (previousResidual < 0 && residual >= 0) {
        bracket = [previousScale, currentScale];
        break;
      }
      previousScale = currentScale;
      previousResidual = residual;
    }
    upper *= 2;
  }
  if (!bracket) throw new Error(`在可搜索尺度内未找到 ${symbol} 转化率第一次达到目标的位置；目标可能受到可逆平衡、再生路径或网络旁路限制。`);
  let [low, high] = bracket;
  for (let iteration = 0; iteration < 55; iteration++) {
    const middle = (low + high) / 2;
    const residual = conversionAtScale(middle) - config.targetX;
    if (!Number.isFinite(residual) || residual >= 0) high = middle;
    else low = middle;
  }
  return (low + high) / 2;
}

function sameRow(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) <= 1e-12);
}

export function validateMultipleReactionConfig(config: MultipleReactionConfig): string[] {
  const errors: string[] = [];
  const speciesCount = config.speciesSymbols.length;
  const reactionCount = config.stoichiometry.length;
  if (speciesCount < 2 || speciesCount > 8) errors.push("通用网络的物种数必须为 2–8。");
  if (reactionCount < 1 || reactionCount > 8) errors.push("通用网络的反应数必须为 1–8。");
  if ([config.feed, config.heatCapacities, config.speciesFormulas, config.speciesCharges].some(values => values.length !== speciesCount)) errors.push("物种进料、热容或守恒信息数组与物种数不一致。");
  config.feed.forEach((value, index) => {
    if (!Number.isFinite(value) || value < 0) errors.push(`物种 ${config.speciesSymbols[index] ?? index + 1} 的入口状态量无效。`);
  });
  config.speciesCharges.forEach((value, index) => {
    if (!Number.isFinite(value) || !Number.isInteger(value)) errors.push(`物种 ${config.speciesSymbols[index] ?? index + 1} 的电荷数必须是整数。`);
  });
  if (config.stoichiometry.some(row => row.length !== speciesCount)) errors.push("计量矩阵列数必须等于物种数。");
  config.stoichiometry.forEach((row, reaction) => {
    if (row.some(value => !Number.isFinite(value))) errors.push(`反应 ${reaction + 1} 的计量数无效。`);
    if (!row.some(value => value < 0) || !row.some(value => value > 0)) errors.push(`反应 ${reaction + 1} 必须同时包含反应物和产物。`);
    for (let other = 0; other < reaction; other++) if (sameRow(row, config.stoichiometry[other])) errors.push(`反应 ${reaction + 1} 与反应 ${other + 1} 完全重复。`);
  });
  if ([config.kRef, config.orders, config.reversible, config.equilibriumConstants, config.activationEnergies, config.referenceTemperatures, config.heatOfReactions].some(values => values.length !== reactionCount)) errors.push("逐反应参数数量与反应数不一致。");
  config.kRef.forEach((value, index) => {
    if (!Number.isFinite(value) || value <= 0) errors.push(`反应 ${index + 1} 的参考速率常数必须大于 0。`);
  });
  config.orders.forEach((row, reaction) => {
    if (row.length !== speciesCount || row.some(value => !Number.isFinite(value) || value < 0)) errors.push(`反应 ${reaction + 1} 的级数矩阵行无效。`);
  });
  config.activationEnergies.forEach((value, index) => {
    if (!Number.isFinite(value) || value < 0) errors.push(`反应 ${index + 1} 的活化能不得为负。`);
  });
  config.referenceTemperatures.forEach((value, index) => {
    if (!Number.isFinite(value) || value <= 0) errors.push(`反应 ${index + 1} 的参考温度必须大于 0 K。`);
  });
  config.reversible.forEach((value, index) => {
    if (value && (!Number.isFinite(config.equilibriumConstants[index]) || config.equilibriumConstants[index] <= 0)) errors.push(`可逆反应 ${index + 1} 的参考平衡常数必须大于 0。`);
  });
  if (config.selectivityEnabled && (!Number.isInteger(config.desiredSpecies) || config.desiredSpecies < 0 || config.desiredSpecies >= speciesCount)) errors.push("目标产物索引无效。");
  if (config.selectivityEnabled && (!Number.isInteger(config.referenceSpecies) || config.referenceSpecies < 0 || config.referenceSpecies >= speciesCount || config.referenceSpecies === config.desiredSpecies)) errors.push("非目标产物索引无效。");
  if (!Number.isInteger(config.conversionSpecies) || config.conversionSpecies < 0 || config.conversionSpecies >= speciesCount) errors.push("转化率观察组分索引无效。");
  else {
    const symbol = config.speciesSymbols[config.conversionSpecies];
    if (!(config.feed[config.conversionSpecies] > 0)) errors.push(`转化率观察组分 ${symbol} 的入口状态量必须大于 0。`);
    if (!config.stoichiometry.some(row => row[config.conversionSpecies] < 0)) errors.push(`至少一条反应必须消耗 ${symbol}，才能定义其转化率。`);
  }
  if (config.enforceConservation && errors.length === 0) {
    try {
      const report = analyzeConservation(config.speciesFormulas, config.speciesCharges, config.stoichiometry);
      report.residuals.forEach(item => errors.push(`反应 ${item.reaction + 1} 的 ${item.element} 元素不守恒（净计量数 ${item.value}）。`));
      report.chargeResiduals.forEach(item => errors.push(`反应 ${item.reaction + 1} 的电荷不守恒（净电荷 ${item.value}）。`));
    } catch (error) {
      errors.push(`分子式解析失败：${error instanceof Error ? error.message : "请检查输入"}`);
    }
  }
  if (config.solveFor === "target" && (!Number.isFinite(config.targetX) || config.targetX <= 0 || config.targetX >= 1)) errors.push("目标转化率必须在 0 与 1 之间。");
  if (config.solveFor === "size" && (!Number.isFinite(config.size) || config.size <= 0)) errors.push("给定尺度必须大于 0。");
  if (!(["auto", "rk45", "implicit"] as string[]).includes(config.solver)) errors.push("数值求解器选项无效。");
  if (!Number.isFinite(config.relativeTolerance) || config.relativeTolerance <= 0 || config.relativeTolerance >= 0.1) errors.push("相对容差必须在 0 与 0.1 之间。");
  if (!Number.isFinite(config.absoluteTolerance) || config.absoluteTolerance <= 0 || config.absoluteTolerance >= 0.1) errors.push("绝对容差必须在 0 与 0.1 之间。");
  if (config.reactor === "CSTR" && !config.isothermal) errors.push("V1.5 暂不启用多反应非等温 CSTR。");
  return errors;
}

export function solveMultipleReactions(config: MultipleReactionConfig): MultipleReactionSolution {
  const errors = validateMultipleReactionConfig(config);
  if (errors.length) throw new Error(errors.join(" "));
  const scale = config.solveFor === "target" ? scaleForTarget(config) : config.size;
  const evaluated = evaluateScale(scale, config, true);
  const end = point(scale, evaluated.state, config);
  const inlet = inletSpeciesState(config);
  const deltaDesired = config.selectivityEnabled ? evaluated.state[config.desiredSpecies] - inlet[config.desiredSpecies] : 0;
  const deltaReference = config.selectivityEnabled ? evaluated.state[config.referenceSpecies] - inlet[config.referenceSpecies] : 0;
  const overallSelectivity = config.selectivityEnabled && deltaDesired > EPS && deltaReference > EPS ? deltaDesired / deltaReference : null;
  const desiredYield = config.selectivityEnabled ? Math.max(0, deltaDesired) / Math.max(inlet[config.conversionSpecies], EPS) : 0;
  const peakPoint = evaluated.points.reduce((best, current) => current.activities[config.desiredSpecies] > best.activities[config.desiredSpecies] ? current : best, evaluated.points[0]);
  const inletDesired = evaluated.points[0].activities[config.desiredSpecies];
  const peakDesired = config.selectivityEnabled && peakPoint.activities[config.desiredSpecies] > inletDesired + 1e-10
    ? { scale: peakPoint.s, value: peakPoint.activities[config.desiredSpecies] }
    : null;
  return {
    scale,
    outletX: end.x,
    pressureRatio: end.p,
    outletTemperature: end.t,
    points: evaluated.points,
    outletActivities: end.activities,
    outletFlows: end.flows,
    outletReactionRates: end.reactionRates,
    outletNetRates: end.netRates,
    instantaneousSelectivity: end.instantaneousSelectivity,
    overallSelectivity,
    desiredYield,
    peakDesired,
    conversionSpecies: config.conversionSpecies,
    method: evaluated.method,
  };
}
