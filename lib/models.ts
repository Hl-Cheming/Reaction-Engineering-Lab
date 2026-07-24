export type Reactor = "BR" | "CSTR" | "PFR" | "PBR";
export type Phase = "liquid" | "gas";

export interface Inputs {
  reactor: Reactor;
  phase: Phase;
  solveFor: "target" | "size";
  targetX: number;
  size: number;
  order: number;
  kRef: number;
  temperature: number;
  refTemperature: number;
  activationEnergy: number;
  ca0: number;
  fa0: number;
  epsilon: number;
  pressureDrop: boolean;
  alpha: number;
}

export interface Point {
  s: number;
  x: number;
  ca: number;
  rate: number;
  p: number;
}

export interface Result {
  reactor: Reactor;
  value: number;
  valueLabel: string;
  unit: string;
  outletX: number;
  outletCa: number;
  k: number;
  pressureRatio: number;
  points: Point[];
  equation: string;
  conclusion: string;
  warnings: string[];
}

const R = 8.314462618;
const EPS = 1e-10;

export const defaults: Inputs = {
  reactor: "PFR",
  phase: "liquid",
  solveFor: "target",
  targetX: 0.8,
  size: 8,
  order: 1,
  kRef: 0.25,
  temperature: 350,
  refTemperature: 350,
  activationEnergy: 52000,
  ca0: 2,
  fa0: 1,
  epsilon: 0,
  pressureDrop: false,
  alpha: 0.03,
};

export function rateConstant(i: Inputs): number {
  return i.kRef * Math.exp((-i.activationEnergy / R) * (1 / i.temperature - 1 / i.refTemperature));
}

export function concentration(x: number, p: number, i: Inputs): number {
  if (i.phase === "liquid") return i.ca0 * Math.max(0, 1 - x);
  const denominator = 1 + i.epsilon * x;
  if (denominator <= 0) return Number.NaN;
  return i.ca0 * Math.max(0, 1 - x) / denominator * p;
}

export function validate(i: Inputs): string[] {
  const errors: string[] = [];
  const positive: Array<[number, string]> = [
    [i.ca0, "入口浓度 C_A0"],
    [i.fa0, "入口摩尔流率 F_A0"],
    [i.kRef, "参考速率常数 k_ref"],
    [i.temperature, "反应温度 T"],
    [i.refTemperature, "参考温度 T_ref"],
  ];
  positive.forEach(([value, label]) => {
    if (!Number.isFinite(value) || value <= 0) errors.push(`${label} 必须大于 0。`);
  });
  if (!Number.isFinite(i.order) || i.order < 0 || i.order > 4) errors.push("反应级数 n 应在 0–4 之间。");
  if (i.targetX <= 0 || i.targetX >= 0.999999) errors.push("目标转化率 X 必须在 0 与 0.999999 之间。");
  if (i.solveFor === "size" && i.size <= 0) errors.push("给定的反应器尺度必须大于 0。");
  if (i.phase === "gas" && 1 + i.epsilon * i.targetX <= 0) {
    errors.push("气相计量关系失效：1 + εX 必须大于 0，请调整 ε 或目标转化率。");
  }
  if (i.reactor === "PBR" && i.pressureDrop && i.alpha <= 0) {
    errors.push("考虑压降时，压降参数 α 必须大于 0。");
  }
  if (i.activationEnergy < 0) errors.push("活化能 E 不应为负值。");
  return errors;
}

function simpsonIntegral(fn: (x: number) => number, end: number, n = 2000): number {
  const steps = n % 2 === 0 ? n : n + 1;
  const h = end / steps;
  let sum = fn(0) + fn(end);
  for (let j = 1; j < steps; j++) sum += (j % 2 === 0 ? 2 : 4) * fn(j * h);
  return (sum * h) / 3;
}

function pAtSize(s: number, i: Inputs): number {
  if (i.reactor !== "PBR" || !i.pressureDrop) return 1;
  return Math.sqrt(Math.max(EPS, 1 - i.alpha * s));
}

function rateAt(x: number, s: number, i: Inputs, k: number): number {
  const ca = concentration(x, pAtSize(s, i), i);
  return k * Math.pow(Math.max(ca, 0), i.order);
}

function sizeToTarget(target: number, i: Inputs, k: number): number {
  if (i.reactor === "BR") {
    return simpsonIntegral(
      x => i.ca0 / Math.max(k * Math.pow(concentration(x, 1, i), i.order), EPS),
      target,
    );
  }
  if (i.reactor === "CSTR") {
    return i.fa0 * target / Math.max(rateAt(target, 0, i, k), EPS);
  }
  if (i.reactor === "PFR" || (i.reactor === "PBR" && !i.pressureDrop)) {
    return i.fa0 * simpsonIntegral(x => 1 / Math.max(rateAt(x, 0, i, k), EPS), target);
  }

  // PBR with pressure drop: integrate dX/dW and dp/dW by RK4.
  let x = 0;
  let w = 0;
  const maxW = 0.999 / i.alpha;
  const h = maxW / 30000;
  while (x < target && w < maxW) {
    const deriv = (xx: number, ww: number) =>
      rateAt(Math.min(xx, 0.999999), ww, i, k) / i.fa0;
    const k1 = deriv(x, w);
    const k2 = deriv(x + (h * k1) / 2, w + h / 2);
    const k3 = deriv(x + (h * k2) / 2, w + h / 2);
    const k4 = deriv(x + h * k3, w + h);
    x += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    w += h;
  }
  if (x < target) throw new Error("在压力降模型失效前无法达到目标转化率。请降低目标 X、减小 α 或提高入口压力。");
  return w;
}

function conversionAtSize(size: number, i: Inputs, k: number): number {
  if (i.reactor === "BR" && i.order === 1 && i.phase === "liquid") return 1 - Math.exp(-k * size);
  let lo = 0;
  let hi = 0.999999;
  for (let j = 0; j < 70; j++) {
    const mid = (lo + hi) / 2;
    let required: number;
    try {
      required = sizeToTarget(mid, i, k);
    } catch {
      hi = mid;
      continue;
    }
    if (required < size) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function buildPoints(outletX: number, totalSize: number, i: Inputs, k: number): Point[] {
  const points: Point[] = [];
  const count = 80;
  if (i.reactor === "PBR" && i.pressureDrop) {
    let xValue = 0;
    const h = totalSize / count;
    for (let j = 0; j <= count; j++) {
      const s = j * h;
      const p = pAtSize(s, i);
      points.push({
        s,
        x: Math.min(xValue, outletX),
        ca: concentration(Math.min(xValue, outletX), p, i),
        rate: rateAt(Math.min(xValue, outletX), s, i, k),
        p,
      });
      if (j === count) break;
      const deriv = (xx: number, ww: number) =>
        rateAt(Math.min(xx, 0.999999), ww, i, k) / i.fa0;
      const k1 = deriv(xValue, s);
      const k2 = deriv(xValue + (h * k1) / 2, s + h / 2);
      const k3 = deriv(xValue + (h * k2) / 2, s + h / 2);
      const k4 = deriv(xValue + h * k3, s + h);
      xValue += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    }
    points[points.length - 1].x = outletX;
    return points;
  }
  for (let j = 0; j <= count; j++) {
    const x = outletX * j / count;
    let s: number;
    if (i.reactor === "CSTR") s = totalSize * j / count;
    else {
      const partial = x <= 0 ? 0 : sizeToTarget(x, { ...i, pressureDrop: false }, k);
      s = i.reactor === "PBR" && i.pressureDrop ? totalSize * j / count : partial;
    }
    const p = pAtSize(s, i);
    points.push({ s, x, ca: concentration(x, p, i), rate: rateAt(x, s, i, k), p });
  }
  return points;
}

const metadata: Record<Reactor, { label: string; unit: string; equation: string }> = {
  BR: {
    label: "所需反应时间",
    unit: "s",
    equation: "t = C_A0 ∫₀ˣ dX / (−r_A)；一级反应：t = ln[1/(1−X)] / k",
  },
  CSTR: {
    label: "所需反应器体积",
    unit: "L",
    equation: "V = F_A0 (X_out−X_in) / (−r_A)_out",
  },
  PFR: {
    label: "所需反应器体积",
    unit: "L",
    equation: "V = F_A0 ∫₀ˣ dX / (−r_A)",
  },
  PBR: {
    label: "所需催化剂质量",
    unit: "kg_cat",
    equation: "W = F_A0 ∫₀ˣ dX / (−r′_A)，dp/dW = −α/(2p)",
  },
};

export function calculate(i: Inputs): Result {
  const errors = validate(i);
  if (errors.length) throw new Error(errors.join(" "));
  const k = rateConstant(i);
  const outletX = i.solveFor === "target" ? i.targetX : conversionAtSize(i.size, i, k);
  const value = i.solveFor === "target" ? sizeToTarget(outletX, i, k) : i.size;
  if (!Number.isFinite(value) || value <= 0) throw new Error("数值求解未得到有限正值，请检查输入量级和模型假设。");
  const pressureRatio = pAtSize(value, i);
  const warnings: string[] = [];
  if (i.phase === "gas" && Math.abs(i.epsilon) > 1) warnings.push("气相体积变化显著，结果对 ε 较敏感。");
  if (i.reactor === "PBR" && i.pressureDrop) {
    if (1 - i.alpha * value <= 0.1) warnings.push("床层已接近压力降模型失效边界（1−αW ≤ 0.1）。");
    else if (pressureRatio < 0.8) warnings.push("出口压力下降超过 20%，忽略压降会高估反应速率。");
  }
  const conclusion =
    i.reactor === "CSTR"
      ? "全混使全釜按出口低浓度速率运行；高目标转化率时体积通常增长较快。"
      : i.reactor === "PFR"
        ? "沿程浓度逐步下降，入口高反应速率得到充分利用。"
        : i.reactor === "PBR"
          ? "催化剂质量是设计尺度；需同时权衡转化率、压降与颗粒传递限制。"
          : "分批体系无连续进出料，所需时间由整个浓度历程的速率积分决定。";
  const meta = metadata[i.reactor];
  return {
    reactor: i.reactor,
    value,
    valueLabel: i.solveFor === "target" ? meta.label : "给定反应器尺度",
    unit: meta.unit,
    outletX,
    outletCa: concentration(outletX, pressureRatio, i),
    k,
    pressureRatio,
    points: buildPoints(outletX, value, i, k),
    equation: meta.equation,
    conclusion,
    warnings,
  };
}

export function compareReactors(i: Inputs): Result[] {
  return (["BR", "CSTR", "PFR", "PBR"] as Reactor[]).map(reactor =>
    calculate({ ...i, reactor, solveFor: "target", pressureDrop: reactor === "PBR" && i.pressureDrop }),
  );
}

export function levenspiel(i: Inputs): Array<{ x: number; y: number }> {
  const k = rateConstant(i);
  return Array.from({ length: 81 }, (_, j) => {
    const x = i.targetX * j / 80;
    return { x, y: i.fa0 / Math.max(rateAt(x, 0, i, k), EPS) };
  });
}
