import { hasValidSelectivityDefinition, networkConservationReport, networkSpeciesSymbols, validate, type Inputs } from "./models.ts";
import { toUnifiedNetwork } from "./caseConfiguration.ts";

export type ReadinessSection = "components" | "reactions" | "stream" | "reactor" | "specification";

export interface CaseReadiness {
  ready: boolean;
  errors: string[];
  sections: Record<ReadinessSection, string[]>;
}

export function caseReadiness(value: Inputs): CaseReadiness {
  const input = toUnifiedNetwork(value);
  const symbols = networkSpeciesSymbols(input);
  const sections: CaseReadiness["sections"] = { components: [], reactions: [], stream: [], reactor: [], specification: [] };

  if (input.networkSpeciesCount < 2) sections.components.push("至少需要两个组分。");
  if (input.networkEnforceConservation) {
    try {
      const report = networkConservationReport(input);
      if (!report?.balanced) sections.components.push("分子式或电荷不满足守恒。");
    } catch {
      sections.components.push("请为全部参与反应的组分填写可解析分子式。");
    }
  }

  input.networkStoichiometry.forEach((row, reaction) => {
    if (!row.some(value => value < 0) || !row.some(value => value > 0)) sections.reactions.push(`R${reaction + 1} 必须同时包含反应物和产物。`);
    if (!(input.networkRateConstants[reaction] > 0)) sections.reactions.push(`R${reaction + 1} 的参考速率常数必须大于 0。`);
    if (!(input.networkReferenceTemperatures[reaction] > 0)) sections.reactions.push(`R${reaction + 1} 的参考温度必须大于 0 K。`);
    if (input.networkReversible[reaction] && !(input.networkEquilibriumConstants[reaction] > 0)) sections.reactions.push(`R${reaction + 1} 的平衡常数必须大于 0。`);
  });

  if (!(input.temperature > 0)) sections.stream.push("入口温度必须大于 0 K。");
  if (!input.networkFeed.some(value => value > 0)) sections.stream.push("入口物流不能为空。");
  if (!(input.networkFeed[input.networkConversionSpecies] > 0)) sections.stream.push(`转化率基准组分 ${symbols[input.networkConversionSpecies]} 必须存在于入口物流。`);
  if (input.reactor !== "BR" && !(input.fa0 > 0)) sections.stream.push("基准组分入口摩尔流率必须大于 0。");

  const basis = input.networkConversionSpecies;
  const basisCoefficients = input.networkStoichiometry.map(row => row[basis] ?? 0);
  if (basisCoefficients.some(value => value > 0) && basisCoefficients.every(value => value >= 0)) {
    sections.specification.push(`转化率基准组分 ${symbols[basis]} 只作为产物出现，不能用于定义反应物转化率。`);
  } else if (!basisCoefficients.some(value => value < 0)) {
    sections.specification.push(`转化率基准组分 ${symbols[basis]} 未在任何反应中被消耗。`);
  } else if (input.networkReactionCount === 1) {
    const row = input.networkStoichiometry[0];
    const reactants = row.flatMap((coefficient, species) => coefficient < 0 && input.networkFeed[species] > 0
      ? [{ species, ratio: input.networkFeed[species] / Math.abs(coefficient) }]
      : []);
    if (reactants.length) {
      const minimum = Math.min(...reactants.map(item => item.ratio));
      const tolerance = Math.max(1, Math.abs(minimum)) * 1e-9;
      const limiting = reactants.filter(item => Math.abs(item.ratio - minimum) <= tolerance).map(item => item.species);
      if (!limiting.includes(basis)) sections.specification.push(`单反应的转化率基准必须是限制性反应物 ${limiting.map(species => symbols[species]).join("、")}。`);
    }
  }

  if (input.pressureDrop && (input.reactor !== "PBR" || input.phase !== "gas")) sections.reactor.push("压降模型仅适用于气相 PBR。");
  if (input.pressureDrop && !(input.alpha > 0)) sections.reactor.push("考虑压降时，压降系数必须大于 0。");
  if (!input.isothermal && input.reactor !== "PFR" && input.reactor !== "PBR") sections.reactor.push("当前非恒温模型仅适用于 PFR 或 PBR。");
  if (!input.isothermal && (!(input.environmentTemperature > 0) || input.heatTransferCoefficient < 0 || !(input.specificArea > 0))) sections.reactor.push("请完善非恒温换热边界。");

  if (input.solveFor === "target" && (!(input.targetX > 0) || input.targetX >= 1)) sections.specification.push("目标转化率必须在 0–1 之间。");
  if (input.solveFor === "size" && !(input.size > 0)) sections.specification.push("给定的反应器尺度必须大于 0。");
  if (input.networkSelectivityEnabled && !hasValidSelectivityDefinition(input)) sections.specification.push("选择性需要定义两个不同且在反应中生成的目标产物与非目标产物。");

  const sectionErrors = Object.values(sections).flat();
  const modelErrors = validate(input);
  const errors = [...sectionErrors, ...modelErrors.filter(error => !sectionErrors.includes(error))];
  return { ready: errors.length === 0, errors, sections };
}

export function speciesDependencies(input: Inputs, species: number): string[] {
  const dependencies: string[] = [];
  input.networkStoichiometry.forEach((row, reaction) => {
    if (Math.abs(row[species] ?? 0) > 1e-12 || Math.abs(input.networkOrdersBySpecies[reaction]?.[species] ?? 0) > 1e-12) dependencies.push(`R${reaction + 1}`);
  });
  if (input.networkConversionSpecies === species) dependencies.push("转化率基准");
  if (input.networkSelectivityEnabled && input.networkDesiredSpecies === species) dependencies.push("目标产物");
  if (input.networkSelectivityEnabled && input.networkReferenceSpecies === species) dependencies.push("非目标产物");
  return dependencies;
}
