import { normalizeInputs, type Inputs } from "./models.ts";
import { toUnifiedNetwork } from "./caseConfiguration.ts";

export interface CaseFile {
  schemaVersion: 16;
  application: "reaction-engineering-solver";
  exportedAt: string;
  inputs: Inputs;
}

export function createCaseFile(inputs: Inputs): CaseFile {
  return { schemaVersion: 16, application: "reaction-engineering-solver", exportedAt: new Date().toISOString(), inputs: toUnifiedNetwork(inputs) };
}

export function parseCaseFile(text: string): Inputs {
  const parsed = JSON.parse(text) as Partial<CaseFile> | Inputs;
  const candidate = "inputs" in parsed ? parsed.inputs : parsed;
  if (!candidate || typeof candidate !== "object") throw new Error("案例文件中没有可识别的输入数据。");
  return toUnifiedNetwork(normalizeInputs(candidate as Inputs));
}
