const ATOMIC_WEIGHTS: Record<string, number> = {
  H: 1.00794, He: 4.002602, Li: 6.941, Be: 9.012182, B: 10.811,
  C: 12.0107, N: 14.0067, O: 15.9994, F: 18.9984032, Ne: 20.1797,
  Na: 22.989769, Mg: 24.305, Al: 26.981538, Si: 28.0855, P: 30.973761,
  S: 32.065, Cl: 35.453, Ar: 39.948, K: 39.0983, Ca: 40.078,
  Sc: 44.955912, Ti: 47.867, V: 50.9415, Cr: 51.9961, Mn: 54.938045,
  Fe: 55.845, Co: 58.933195, Ni: 58.6934, Cu: 63.546, Zn: 65.38,
  Ga: 69.723, Ge: 72.64, As: 74.9216, Se: 78.96, Br: 79.904,
  Kr: 83.798, Rb: 85.4678, Sr: 87.62, Ag: 107.8682, Cd: 112.411,
  Sn: 118.71, I: 126.90447, Ba: 137.327, Pt: 195.084, Au: 196.96657,
  Hg: 200.59, Pb: 207.2,
};
const VALID_ELEMENTS = new Set(
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" "),
);

export interface ParsedFormula {
  elements: Record<string, number>;
  molecularWeight: number | null;
}

export interface ConservationResidual {
  reaction: number;
  element: string;
  value: number;
}

export interface ConservationReport {
  parsed: ParsedFormula[];
  elements: string[];
  residuals: ConservationResidual[];
  chargeResiduals: Array<{ reaction: number; value: number }>;
  balanced: boolean;
}

function addComposition(target: Record<string, number>, source: Record<string, number>, factor = 1): void {
  for (const [element, count] of Object.entries(source)) target[element] = (target[element] ?? 0) + factor * count;
}

function readNumber(source: string, start: number): { value: number; end: number } {
  let end = start;
  while (end < source.length && /[0-9.]/.test(source[end])) end++;
  if (end === start) return { value: 1, end };
  const value = Number(source.slice(start, end));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`下标“${source.slice(start, end)}”无效。`);
  return { value, end };
}

function parseFormulaPart(source: string): Record<string, number> {
  let index = 0;
  const parseGroup = (closing?: string): Record<string, number> => {
    const composition: Record<string, number> = {};
    while (index < source.length) {
      const character = source[index];
      if (closing && character === closing) {
        index++;
        return composition;
      }
      if (character === "(" || character === "[") {
        index++;
        const inner = parseGroup(character === "(" ? ")" : "]");
        const multiplier = readNumber(source, index);
        index = multiplier.end;
        addComposition(composition, inner, multiplier.value);
        continue;
      }
      if (!/[A-Z]/.test(character)) throw new Error(`无法识别字符“${character}”。`);
      let symbol = character;
      index++;
      while (index < source.length && /[a-z]/.test(source[index])) symbol += source[index++];
      if (!VALID_ELEMENTS.has(symbol)) throw new Error(`“${symbol}”不是有效元素符号。`);
      const count = readNumber(source, index);
      index = count.end;
      addComposition(composition, { [symbol]: count.value });
    }
    if (closing) throw new Error(`缺少右括号“${closing}”。`);
    return composition;
  };
  return parseGroup();
}

export function parseChemicalFormula(raw: string): ParsedFormula {
  const formula = raw.replace(/\s+/g, "");
  if (!formula) throw new Error("分子式不能为空。");
  const elements: Record<string, number> = {};
  for (const segment of formula.split(/[·•]/)) {
    if (!segment) throw new Error("水合物分隔符两侧都必须有分子式。");
    const leading = segment.match(/^(\d+(?:\.\d+)?)(?=[A-Z[(])/);
    const factor = leading ? Number(leading[1]) : 1;
    const body = leading ? segment.slice(leading[1].length) : segment;
    addComposition(elements, parseFormulaPart(body), factor);
  }
  const molecularWeight = Object.entries(elements).every(([element]) => ATOMIC_WEIGHTS[element] !== undefined)
    ? Object.entries(elements).reduce((sum, [element, count]) => sum + ATOMIC_WEIGHTS[element] * count, 0)
    : null;
  return { elements, molecularWeight };
}

export function analyzeConservation(
  formulas: string[],
  charges: number[],
  stoichiometry: number[][],
): ConservationReport {
  const parsed = formulas.map(parseChemicalFormula);
  const elements = [...new Set(parsed.flatMap(item => Object.keys(item.elements)))].sort();
  const residuals: ConservationResidual[] = [];
  const chargeResiduals: Array<{ reaction: number; value: number }> = [];
  stoichiometry.forEach((row, reaction) => {
    elements.forEach(element => {
      const value = row.reduce((sum, coefficient, species) => sum + coefficient * (parsed[species]?.elements[element] ?? 0), 0);
      const scale = row.reduce((sum, coefficient, species) => sum + Math.abs(coefficient) * (parsed[species]?.elements[element] ?? 0), 0);
      if (Math.abs(value) > 1e-9 * Math.max(1, scale)) residuals.push({ reaction, element, value });
    });
    const charge = row.reduce((sum, coefficient, species) => sum + coefficient * (charges[species] ?? 0), 0);
    const chargeScale = row.reduce((sum, coefficient, species) => sum + Math.abs(coefficient) * Math.abs(charges[species] ?? 0), 0);
    if (Math.abs(charge) > 1e-9 * Math.max(1, chargeScale)) chargeResiduals.push({ reaction, value: charge });
  });
  return { parsed, elements, residuals, chargeResiduals, balanced: residuals.length === 0 && chargeResiduals.length === 0 };
}
