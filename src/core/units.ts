import type { EnergyUnit, Inputs, LengthUnit, PressureUnit, TimeUnit } from "./models";

export const secondsPerUnit: Record<TimeUnit, number> = { s: 1, min: 60, h: 3600 };
export const joulesPerUnit: Record<EnergyUnit, number> = { J: 1, kJ: 1000, kcal: 4184 };
export const pascalsPerUnit: Record<PressureUnit, number> = { Pa: 1, kPa: 1000, bar: 100000 };
export const litresPerVolumeUnit: Record<LengthUnit, number> = { m: 1000, dm: 1, mm: 1e-6 };
export const metresPerLengthUnit: Record<LengthUnit, number> = { m: 1, dm: 0.1, mm: 0.001 };

export function timeFromSI(value: number, units: Pick<Inputs, "timeUnit">): number {
  return value / secondsPerUnit[units.timeUnit];
}
export function timeToSI(value: number, units: Pick<Inputs, "timeUnit">): number {
  return value * secondsPerUnit[units.timeUnit];
}
export function energyFromSI(value: number, units: Pick<Inputs, "energyUnit">): number {
  return value / joulesPerUnit[units.energyUnit];
}
export function energyToSI(value: number, units: Pick<Inputs, "energyUnit">): number {
  return value * joulesPerUnit[units.energyUnit];
}
export function pressureFromBar(value: number, units: Pick<Inputs, "pressureUnit">): number {
  return value * pascalsPerUnit.bar / pascalsPerUnit[units.pressureUnit];
}
export function pressureToBar(value: number, units: Pick<Inputs, "pressureUnit">): number {
  return value * pascalsPerUnit[units.pressureUnit] / pascalsPerUnit.bar;
}
export function volumeFromLitres(value: number, units: Pick<Inputs, "lengthUnit">): number {
  return value / litresPerVolumeUnit[units.lengthUnit];
}
export function volumeToLitres(value: number, units: Pick<Inputs, "lengthUnit">): number {
  return value * litresPerVolumeUnit[units.lengthUnit];
}
export function activityFactor(units: Pick<Inputs, "phase" | "pressureUnit" | "lengthUnit">): number {
  return units.phase === "gas"
    ? pascalsPerUnit.bar / pascalsPerUnit[units.pressureUnit]
    : litresPerVolumeUnit[units.lengthUnit];
}
export function activityFromCanonical(value: number, units: Pick<Inputs, "phase" | "pressureUnit" | "lengthUnit">): number {
  return value * activityFactor(units);
}
export function activityToCanonical(value: number, units: Pick<Inputs, "phase" | "pressureUnit" | "lengthUnit">): number {
  return value / activityFactor(units);
}
export function activityUnit(units: Pick<Inputs, "phase" | "pressureUnit" | "lengthUnit">): string {
  return units.phase === "gas" ? units.pressureUnit : `mol·${units.lengthUnit}⁻³`;
}
export function activityUnitLatex(units: Pick<Inputs, "phase" | "pressureUnit" | "lengthUnit">): string {
  return units.phase === "gas" ? `\\mathrm{${units.pressureUnit}}` : `\\mathrm{mol\\,${units.lengthUnit}^{-3}}`;
}
export function volumeUnit(units: Pick<Inputs, "lengthUnit">): string { return `${units.lengthUnit}³`; }
export function flowFromCanonical(value: number, units: Pick<Inputs, "timeUnit">): number { return value * secondsPerUnit[units.timeUnit]; }
type RateUnits = Pick<Inputs, "reactor" | "phase" | "pressureUnit" | "lengthUnit" | "timeUnit">;

export function rateFromCanonical(value: number, units: RateUnits): number {
  const basisFactor = units.reactor === "PBR" ? 1 : activityFactor(units);
  return value * basisFactor * secondsPerUnit[units.timeUnit];
}
export function rateConstantFromCanonical(value: number, order: number, units: RateUnits): number {
  const activityPower = units.reactor === "PBR" ? -order : 1 - order;
  return value * secondsPerUnit[units.timeUnit] * Math.pow(activityFactor(units), activityPower);
}
export function rateConstantToCanonical(value: number, order: number, units: RateUnits): number {
  const activityPower = units.reactor === "PBR" ? -order : 1 - order;
  return value / (secondsPerUnit[units.timeUnit] * Math.pow(activityFactor(units), activityPower));
}
export function rateUnit(units: RateUnits): string {
  if (units.reactor === "PBR") return `mol·kg_cat⁻¹·${units.timeUnit}⁻¹`;
  return `${activityUnit(units)}·${units.timeUnit}⁻¹`;
}
export function rateUnitLatex(units: RateUnits): string {
  if (units.reactor === "PBR") return `\\mathrm{mol\\,kg_{cat}^{-1}\\,${units.timeUnit}^{-1}}`;
  return `${activityUnitLatex(units)}\\,\\mathrm{${units.timeUnit}^{-1}}`;
}
export function rateConstantUnitLatex(order: number, units: RateUnits): string {
  if (units.reactor === "PBR") {
    const orderText = Number.isInteger(order) ? String(order) : Number(order.toPrecision(5)).toString();
    if (Math.abs(order) < 1e-12) return `\\mathrm{mol\\,kg_{cat}^{-1}\\,${units.timeUnit}^{-1}}`;
    if (units.phase === "gas") return `\\mathrm{mol\\,kg_{cat}^{-1}\\,${units.pressureUnit}^{-${orderText}}\\,${units.timeUnit}^{-1}}`;
    const moleExponent = 1 - order;
    const lengthExponent = 3 * order;
    const moleText = Number.isInteger(moleExponent) ? String(moleExponent) : Number(moleExponent.toPrecision(5)).toString();
    const lengthText = Number.isInteger(lengthExponent) ? String(lengthExponent) : Number(lengthExponent.toPrecision(5)).toString();
    return `\\mathrm{mol^{${moleText}}\\,${units.lengthUnit}^{${lengthText}}\\,kg_{cat}^{-1}\\,${units.timeUnit}^{-1}}`;
  }
  const exponent = 1 - order;
  const exponentText = Number.isInteger(exponent) ? String(exponent) : Number(exponent.toPrecision(5)).toString();
  if (Math.abs(exponent) < 1e-12) return `\\mathrm{${units.timeUnit}^{-1}}`;
  if (units.phase === "gas") return `\\mathrm{${units.pressureUnit}^{${exponentText}}\\,${units.timeUnit}^{-1}}`;
  const lengthExponent = -3 * exponent;
  const lengthText = Number.isInteger(lengthExponent) ? String(lengthExponent) : Number(lengthExponent.toPrecision(5)).toString();
  return `\\mathrm{mol^{${exponentText}}\\,${units.lengthUnit}^{${lengthText}}\\,${units.timeUnit}^{-1}}`;
}
export function heatCapacityFromSI(value: number, units: Pick<Inputs, "energyUnit">): number { return energyFromSI(value, units); }
export function heatCapacityToSI(value: number, units: Pick<Inputs, "energyUnit">): number { return energyToSI(value, units); }
export function heatTransferFromSI(value: number, units: Pick<Inputs, "energyUnit" | "timeUnit" | "lengthUnit">): number {
  return value * secondsPerUnit[units.timeUnit] * metresPerLengthUnit[units.lengthUnit] ** 2 / joulesPerUnit[units.energyUnit];
}
export function heatTransferToSI(value: number, units: Pick<Inputs, "energyUnit" | "timeUnit" | "lengthUnit">): number {
  return value * joulesPerUnit[units.energyUnit] / (secondsPerUnit[units.timeUnit] * metresPerLengthUnit[units.lengthUnit] ** 2);
}
export function specificAreaFromSI(value: number, units: Pick<Inputs, "lengthUnit">): number { return value * 1000 * metresPerLengthUnit[units.lengthUnit]; }
export function specificAreaToSI(value: number, units: Pick<Inputs, "lengthUnit">): number { return value / (1000 * metresPerLengthUnit[units.lengthUnit]); }
export function bulkDensityFromSI(value: number, units: Pick<Inputs, "lengthUnit">): number { return value * litresPerVolumeUnit[units.lengthUnit]; }
export function bulkDensityToSI(value: number, units: Pick<Inputs, "lengthUnit">): number { return value / litresPerVolumeUnit[units.lengthUnit]; }
