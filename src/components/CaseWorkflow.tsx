import { useEffect, useMemo, useState } from "react";
import { MathFormula } from "./MathFormula.tsx";
import { networkConservationReport, networkReactionLatexes, networkSpeciesSymbols, type Inputs, type Result } from "../core/models.ts";
import { toProductMaterialStream, toUnifiedNetwork } from "../core/caseConfiguration.ts";
import { caseReadiness, speciesDependencies } from "../core/caseReadiness.ts";
import { activityFromCanonical, activityToCanonical, activityUnit, activityUnitLatex, bulkDensityFromSI, bulkDensityToSI, energyFromSI, energyToSI, flowFromCanonical, heatCapacityFromSI, heatCapacityToSI, heatTransferFromSI, heatTransferToSI, pressureFromBar, rateConstantFromCanonical, rateConstantToCanonical, rateConstantUnitLatex, secondsPerUnit, specificAreaFromSI, specificAreaToSI, timeFromSI, timeToSI, volumeFromLitres, volumeToLitres, volumeUnit } from "../core/units.ts";

type TaskId = "target" | "size" | "spaceTime" | "compare" | "pressure" | "pressureCompare";
type Dialog = "components" | "stream" | "reactor" | "specification" | "advanced" | null;

interface Props {
  inputs: Inputs;
  task: TaskId;
  spaceTime: number;
  setSpaceTime: (value: number) => void;
  commit: (next: Inputs) => void;
  changeTask: (task: TaskId) => void;
  result: Result | null;
}

export function CaseWorkflow({ inputs, task, spaceTime, setSpaceTime, commit, changeTask, result }: Props) {
  const unified = useMemo(() => toUnifiedNetwork(inputs), [inputs]);
  const symbols = networkSpeciesSymbols(unified);
  const equations = networkReactionLatexes(unified);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reactionIndex, setReactionIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Inputs>(() => structuredClone(unified));
  const [draftTask, setDraftTask] = useState<TaskId>(task);
  const readiness = useMemo(() => caseReadiness(unified), [unified]);
  const product = useMemo(() => result ? toProductMaterialStream(unified, result) : null, [result, unified]);
  const draftReadiness = useMemo(() => caseReadiness(draft), [draft]);

  useEffect(() => setDraft(structuredClone(unified)), [unified, dialog]);

  const open = (next: Dialog) => {
    setReactionIndex(null);
    setDraft(structuredClone(unified));
    setDraftTask(task);
    setDialog(next);
  };
  const openReaction = (index: number) => {
    setDraft(structuredClone(unified));
    setReactionIndex(index);
    setDialog(null);
  };
  const beginAddReaction = () => {
    if (unified.networkReactionCount >= 8) return;
    const next = appendReaction(unified);
    setDraft(next);
    setReactionIndex(unified.networkReactionCount);
    setDialog(null);
  };
  const save = () => {
    commit(toUnifiedNetwork(draft));
    if (dialog === "specification" || dialog === "advanced") changeTask(draftTask);
    setDialog(null);
    setReactionIndex(null);
  };
  const conservation = (() => {
    if (!unified.networkEnforceConservation) return "未启用（拟组分模式）";
    try {
      const report = networkConservationReport(unified);
      return report?.balanced ? "元素与电荷守恒" : "存在不守恒反应";
    } catch {
      return "分子式待完善";
    }
  })();
  const phaseLabel = unified.phase === "gas" ? "气相 · 理想气体" : "液相 · 恒密度";
  const isDistributed = unified.reactor === "PFR" || unified.reactor === "PBR";
  const thermal = unified.isothermal ? `恒温 ${unified.temperature} K` : `非恒温 · 入口 ${unified.temperature} K`;
  const pressure = unified.reactor === "PBR" && unified.phase === "gas" && unified.pressureDrop ? "考虑压降" : "恒压";
  const spec = specificationSummary(unified, task, spaceTime, symbols);
  const calculationOption = taskOptions(unified.reactor).find(([value]) => value === task)?.[1] ?? "计算目标";

  return <div className="case-workflow">
    <div className="unit-basis" aria-label="计算单位基准">
      <b>单位基准</b>
      <UnitSelect label="时间" value={unified.timeUnit} options={["s", "min", "h"]} onChange={value => commit({ ...unified, timeUnit: value as Inputs["timeUnit"] })} />
      <UnitSelect label="能量" value={unified.energyUnit} options={["J", "kJ", "kcal"]} onChange={value => commit({ ...unified, energyUnit: value as Inputs["energyUnit"] })} />
      <UnitSelect label="压力" value={unified.pressureUnit} options={["Pa", "kPa", "bar"]} onChange={value => commit({ ...unified, pressureUnit: value as Inputs["pressureUnit"] })} />
      <UnitSelect label="长度" value={unified.lengthUnit} options={["m", "dm", "mm"]} onChange={value => commit({ ...unified, lengthUnit: value as Inputs["lengthUnit"] })} />
    </div>
    {unified.phase === "liquid" && unified.lengthUnit !== "dm" && <div className="unit-warning">当前长度基准不是 dm，液相浓度将使用 {activityUnit(unified)}，不再是 mol·L⁻¹。</div>}

    <div className="flowsheet" aria-label="当前流程">
      <button onClick={() => open("stream")}><small>{unified.reactor === "BR" ? "初始装料" : "入口物流"}</small><b>FEED</b><span>{phaseLabel}</span></button>
      <div className="stream-line" aria-hidden="true" />
      <button className="reactor-node" onClick={() => open("reactor")}><small>反应器</small><b className="reactor-title">R-101 <em>· {unified.reactor}</em></b><span>{thermal} · {pressure}</span></button>
      <div className="stream-line" aria-hidden="true" />
      <div className="product-node"><small>出口物流</small><b>PRODUCT</b><span>{product ? `${formatNumber(flowFromCanonical(product.totalMolarFlow, unified))} mol·${unified.timeUnit}⁻¹ · ${formatNumber(product.temperature)} K${product.phase === "gas" ? ` · ${formatNumber(pressureFromBar(product.pressure, unified))} ${unified.pressureUnit}` : ""}` : "计算后生成组成"}</span></div>
    </div>

    <div className="setup-cards">
      <SummaryCard number="01" title="组分与相态" status={sectionStatus(readiness.sections.components, conservation)} action={() => open("components")}>
        <strong>{phaseLabel}</strong>
        <p>{symbols.map((symbol, index) => `${symbol}${unified.networkNames[index] ? ` · ${unified.networkNames[index]}` : ""}${unified.networkFormulas[index] ? ` ↔ ${unified.networkFormulas[index]}` : ""}`).join("，")}</p>
      </SummaryCard>

      <section className="setup-card reactions-card">
        <header><div><span className="setup-index index-badge sequence-number" aria-hidden="true">02</span><div><h4>反应集合</h4><small>{sectionStatus(readiness.sections.reactions, `${unified.networkReactionCount} 条反应 · 无需预设总数`)}</small></div></div><button onClick={beginAddReaction}>＋ 添加反应</button></header>
        <div className="reaction-list">{equations.map((equation, index) => <article key={`reaction-${index}`}>
          <button className="reaction-main" onClick={() => openReaction(index)}><b>R{index + 1}</b><MathFormula latex={equation} /><span>{unified.networkReversible[index] ? "可逆" : "不可逆"} · {unified.networkElementary[index] ? "基元" : "经验级数"}</span></button>
          <button className="reaction-remove" disabled={unified.networkReactionCount <= 1} onClick={() => removeReaction(unified, index, commit)} aria-label={`删除反应 ${index + 1}`}>×</button>
        </article>)}</div>
      </section>

      <SummaryCard number="03" title={unified.reactor === "BR" ? "初始装料" : "入口物流"} status={sectionStatus(readiness.sections.stream, "已定义")} action={() => open("stream")}>
        <strong>{unified.phase === "gas" ? `总压约 ${formatNumber(pressureFromBar(unified.networkFeed.reduce((sum, value) => sum + value, 0), unified))} ${unified.pressureUnit}` : `${symbols[unified.networkConversionSpecies]} 基准浓度 ${formatNumber(activityFromCanonical(unified.networkFeed[unified.networkConversionSpecies], unified))} ${activityUnit(unified)}`}</strong>
        <p>{symbols.map((symbol, index) => `${symbol} ${formatNumber(activityFromCanonical(unified.networkFeed[index], unified))}`).join(" · ")} · {unified.temperature} K</p>
      </SummaryCard>

      <SummaryCard number="04" title="反应器与操作" status={sectionStatus(readiness.sections.reactor, `${thermal} · ${pressure}`)} action={() => open("reactor")}>
        <strong>R-101 · {unified.reactor}</strong>
        <p>{unified.reactor === "PBR" ? "催化剂质量为设计尺度" : unified.reactor === "BR" ? "按终止条件确定批次状态" : isDistributed ? "沿反应器体积分布求解" : "出口状态等同釜内状态"}</p>
      </SummaryCard>

      <SummaryCard number="05" title="计算目标" status={sectionStatus(readiness.sections.specification, calculationOption)} action={() => open("specification")}>
        <strong>{spec}</strong>
        <p>转化率基准：{symbols[unified.networkConversionSpecies]} · 数值方法：{unified.networkSolver === "auto" ? "自动" : unified.networkSolver === "rk45" ? "RK45" : "隐式刚性"}</p>
      </SummaryCard>
    </div>

    {dialog === "components" && <Modal title="组分与相态" subtitle="全体系采用同一相态；真实名称和分子式映射均为可选。" errors={draftReadiness.sections.components} onClose={() => setDialog(null)} onSave={save}>
      <Segment label="反应相态" value={draft.phase} options={[["liquid", "液相 · 恒密度"], ["gas", "气相 · 理想气体"]]} onChange={value => setDraft(old => ({ ...old, phase: value as Inputs["phase"], pressureDrop: value === "liquid" ? false : old.pressureDrop }))} />
      <label className="check-row"><input type="checkbox" checked={draft.networkEnforceConservation} onChange={event => setDraft(old => ({ ...old, networkEnforceConservation: event.target.checked }))} /><span><b>启用分子式守恒核查</b><small>启用后，所有参与反应的组分都必须填写可解析分子式和整数电荷。</small></span></label>
      <div className="editor-list">{networkSpeciesSymbols(draft).map((symbol, index) => <div className="component-editor" key={`component-${index}`}>
        <div className="component-symbol"><b>{symbol}</b><small>{draft.networkInertSpecies[index] ? "惰性" : "反应组分"}</small></div>
        <TextInput label="实际名称（可选）" value={draft.networkNames[index] ?? ""} placeholder="例如 methane" onChange={value => setArrayValue(draft, setDraft, "networkNames", index, value)} />
        <TextInput label="分子式（可选）" value={draft.networkFormulas[index] ?? ""} placeholder="例如 CH4" onChange={value => setArrayValue(draft, setDraft, "networkFormulas", index, value)} />
        <NumberInput label="电荷" value={draft.networkCharges[index] ?? 0} step={1} onChange={value => setArrayValue(draft, setDraft, "networkCharges", index, value)} />
        <label className="compact-check"><input type="checkbox" checked={draft.networkInertSpecies[index] ?? false} onChange={event => toggleInert(draft, setDraft, index, event.target.checked)} />惰性物质</label>
        <button className="icon-remove" title={speciesDependencies(draft, index).length ? `先解除依赖：${speciesDependencies(draft, index).join("、")}` : "删除组分"} disabled={draft.networkSpeciesCount <= 2 || speciesDependencies(draft, index).length > 0} onClick={() => setDraft(removeSpecies(draft, index))}>删除</button>
      </div>)}</div>
      <button className="add-row" disabled={draft.networkSpeciesCount >= 8} onClick={() => setDraft(addSpecies(draft))}>＋ 添加组分</button>
    </Modal>}

    {reactionIndex !== null && <ReactionModal draft={draft} setDraft={setDraft} index={reactionIndex} errors={draftReadiness.sections.reactions.filter(error => error.startsWith(`R${reactionIndex + 1}`))} onClose={() => setReactionIndex(null)} onSave={save} />}

    {dialog === "stream" && <Modal title={draft.reactor === "BR" ? "初始装料" : "入口物流 FEED"} subtitle={draft.phase === "gas" ? "输入各组分入口分压；默认理想气体，由总压和组成换算摩尔流率。" : "输入各组分入口浓度和流量基准；液相按恒密度处理。"} errors={draftReadiness.sections.stream} onClose={() => setDialog(null)} onSave={save}>
      <div className="modal-grid">{networkSpeciesSymbols(draft).map((symbol, index) => <NumberInput key={`feed-${index}`} label={`${symbol} ${draft.phase === "gas" ? "入口分压" : "入口浓度"}`} value={activityFromCanonical(draft.networkFeed[index], draft)} min={0} unitLatex={activityUnitLatex(draft)} onChange={value => setArrayValue(draft, setDraft, "networkFeed", index, activityToCanonical(value, draft))} />)}</div>
      <div className="modal-grid">
        <NumberInput label={draft.isothermal ? "反应温度" : "入口温度"} value={draft.temperature} min={1} step={1} unit="K" onChange={value => setDraft(old => ({ ...old, temperature: value }))} />
        {draft.reactor !== "BR" && <NumberInput label={`${networkSpeciesSymbols(draft)[draft.networkConversionSpecies]} 入口摩尔流率`} value={flowFromCanonical(draft.fa0, draft)} min={0} unitLatex={`\\mathrm{mol\\,${draft.timeUnit}^{-1}}`} onChange={value => setDraft(old => ({ ...old, fa0: value / secondsPerUnit[old.timeUnit] }))} />}
      </div>
      <div className="computed-note"><b>{draft.phase === "gas" ? "入口总压" : "输入基准"}</b><span>{draft.phase === "gas" ? `${formatNumber(pressureFromBar(draft.networkFeed.reduce((sum, value) => sum + value, 0), draft))} ${draft.pressureUnit}` : `由 ${activityUnit(draft)} 与基准摩尔流率换算体积流量`}</span></div>
    </Modal>}

    {dialog === "reactor" && <Modal title={`反应器 R-101 · ${draft.reactor}`} subtitle="在同一案例内选择设备类型和适用的操作条件。" errors={draftReadiness.sections.reactor} onClose={() => setDialog(null)} onSave={save}>
      <Segment label="反应器类型" value={draft.reactor} options={[["BR", "BR"], ["CSTR", "CSTR"], ["PFR", "PFR"], ["PBR", "PBR"]]} onChange={value => setDraft(old => ({ ...old, reactor: value as Inputs["reactor"], pressureDrop: value === "PBR" ? old.pressureDrop : false, isothermal: value === "BR" || value === "CSTR" ? true : old.isothermal }))} />
      <div className="reactor-choice"><div><b>{draft.reactor}</b><span>{reactorDescription(draft.reactor)}</span></div></div>
      {(draft.reactor === "PFR" || draft.reactor === "PBR") && <Segment label="温度条件" value={draft.isothermal ? "isothermal" : "nonisothermal"} options={[["isothermal", "恒温"], ["nonisothermal", "非恒温"]]} onChange={value => setDraft(old => ({ ...old, isothermal: value === "isothermal" }))} />}
      {draft.reactor === "CSTR" || draft.reactor === "BR" ? <div className="computed-note"><b>温度模型</b><span>当前版本采用恒温模型</span></div> : null}
      {draft.reactor === "PBR" && draft.phase === "gas" && <Segment label="压力条件" value={draft.pressureDrop ? "drop" : "constant"} options={[["constant", "恒压"], ["drop", "考虑压降"]]} onChange={value => setDraft(old => ({ ...old, pressureDrop: value === "drop" }))} />}
      {draft.reactor === "PBR" && draft.phase === "gas" && draft.pressureDrop && <NumberInput label="综合压降系数" symbol="\alpha" value={draft.alpha} min={0} unitLatex={String.raw`\mathrm{kg}_{\mathrm{cat}}^{-1}`} onChange={value => setDraft(old => ({ ...old, alpha: value }))} />}
      {!draft.isothermal && (draft.reactor === "PFR" || draft.reactor === "PBR") && <>
        <h5 className="modal-subtitle">换热边界</h5>
        <div className="modal-grid"><NumberInput label="外界温度" value={draft.environmentTemperature} min={1} unit="K" onChange={value => setDraft(old => ({ ...old, environmentTemperature: value }))} /><NumberInput label="总传热系数 U" value={heatTransferFromSI(draft.heatTransferCoefficient, draft)} min={0} unitLatex={`\\mathrm{${draft.energyUnit}\\,${draft.timeUnit}^{-1}\\,${draft.lengthUnit}^{-2}\\,K^{-1}}`} onChange={value => setDraft(old => ({ ...old, heatTransferCoefficient: heatTransferToSI(value, old) }))} /><NumberInput label="比换热面积 a" value={specificAreaFromSI(draft.specificArea, draft)} min={0} unitLatex={`\\mathrm{${draft.lengthUnit}^{-1}}`} onChange={value => setDraft(old => ({ ...old, specificArea: specificAreaToSI(value, old) }))} />{draft.reactor === "PBR" && <NumberInput label="床层堆密度 ρb" value={bulkDensityFromSI(draft.catalystBulkDensity, draft)} min={0} unitLatex={`\\mathrm{kg}_{\\mathrm{cat}}\\,\\mathrm{${draft.lengthUnit}^{-3}}`} onChange={value => setDraft(old => ({ ...old, catalystBulkDensity: bulkDensityToSI(value, old) }))} />}</div>
        <h5 className="modal-subtitle">组分定压热容</h5><div className="modal-grid">{networkSpeciesSymbols(draft).map((symbol, index) => <NumberInput key={`cp-${index}`} label={`${symbol} 的 Cp`} value={heatCapacityFromSI(draft.networkHeatCapacities[index], draft)} min={0} unitLatex={`\\mathrm{${draft.energyUnit}\\,mol^{-1}\\,K^{-1}}`} onChange={value => setArrayValue(draft, setDraft, "networkHeatCapacities", index, heatCapacityToSI(value, draft))} />)}</div>
      </>}
    </Modal>}

    {dialog === "specification" && <Modal title="计算规格" subtitle="明确一个已知条件和一个待求量，避免过度指定。" errors={draftReadiness.sections.specification} onClose={() => setDialog(null)} onSave={save}>
      <Segment label="计算目标" value={draftTask} options={taskOptions(draft.reactor)} onChange={value => { const nextTask = value as TaskId; setDraftTask(nextTask); setDraft(old => ({ ...old, solveFor: nextTask === "size" || nextTask === "spaceTime" ? "size" : "target", pressureDrop: nextTask === "pressure" || nextTask === "pressureCompare" ? true : old.pressureDrop })); }} />
      <SelectInput label="转化率基准组分" value={draft.networkConversionSpecies} options={networkSpeciesSymbols(draft).map((symbol, index) => [index, symbol] as [number, string])} onChange={value => setDraft(old => ({ ...old, networkConversionSpecies: value }))} />
      {(draftTask === "target" || draftTask === "pressure" || draftTask === "pressureCompare" || draftTask === "compare") && <NumberInput label="目标转化率" symbol={String.raw`X_{\mathrm{target}}`} value={draft.targetX} min={0} max={1} unit="—" onChange={value => setDraft(old => ({ ...old, targetX: value }))} />}
      {draftTask === "size" && <NumberInput label={draft.reactor === "BR" ? "给定反应时间" : draft.reactor === "PBR" ? "给定催化剂质量" : "给定反应器体积"} value={draft.reactor === "BR" ? timeFromSI(draft.size, draft) : draft.reactor === "PBR" ? draft.size : volumeFromLitres(draft.size, draft)} min={0} unit={draft.reactor === "BR" ? draft.timeUnit : draft.reactor === "PBR" ? "kg_cat" : volumeUnit(draft)} onChange={value => setDraft(old => ({ ...old, size: old.reactor === "BR" ? timeToSI(value, old) : old.reactor === "PBR" ? value : volumeToLitres(value, old) }))} />}
      {draftTask === "spaceTime" && <NumberInput label="空间时间 τ" value={timeFromSI(spaceTime, draft)} min={0} unit={draft.timeUnit} onChange={value => setSpaceTime(timeToSI(value, draft))} />}
      <button className="advanced-trigger" onClick={() => setDialog("advanced")}>高级选项 <span>数值求解器、容差和附加结果定义 →</span></button>
    </Modal>}

    {dialog === "advanced" && <Modal title="高级选项" subtitle="默认自动设置适用于大多数课堂计算；附加结果只有在显式启用并定义后才会计算。" errors={draftReadiness.sections.specification} onClose={() => setDialog(null)} onSave={save}>
      <Segment label="数值求解器" value={draft.networkSolver} options={[["auto", "自动"], ["rk45", "RK45"], ["implicit", "隐式刚性"]]} onChange={value => setDraft(old => ({ ...old, networkSolver: value as Inputs["networkSolver"] }))} />
      <div className="modal-grid"><NumberInput label="相对容差" value={draft.networkRelativeTolerance} min={0} unit="—" onChange={value => setDraft(old => ({ ...old, networkRelativeTolerance: value }))} /><NumberInput label="绝对容差" value={draft.networkAbsoluteTolerance} min={0} unit="—" onChange={value => setDraft(old => ({ ...old, networkAbsoluteTolerance: value }))} /></div>
      <label className="check-row"><input type="checkbox" checked={draft.networkSelectivityEnabled} onChange={event => setDraft(old => ({ ...old, networkSelectivityEnabled: event.target.checked }))} /><span><b>计算选择性与目标产物收率</b><small>启用后定义目标产物 D 与非目标产物 U；瞬时选择性 S_D/U=R_D/R_U，总选择性按两者净生成量之比计算。</small></span></label>
      {draft.networkSelectivityEnabled && <div className="modal-grid"><SelectInput label="目标产物 D" value={draft.networkDesiredSpecies} options={networkSpeciesSymbols(draft).map((symbol, index) => [index, symbol])} onChange={value => setDraft(old => ({ ...old, networkDesiredSpecies: value, networkReferenceSpecies: value === old.networkReferenceSpecies ? (value === 0 ? 1 : 0) : old.networkReferenceSpecies }))} /><SelectInput label="非目标产物 U" value={draft.networkReferenceSpecies} options={networkSpeciesSymbols(draft).flatMap((symbol, index) => index === draft.networkDesiredSpecies ? [] : [[index, symbol] as [number, string]])} onChange={value => setDraft(old => ({ ...old, networkReferenceSpecies: value }))} /></div>}
    </Modal>}
  </div>;
}

function SummaryCard({ number, title, status, action, children }: { number: string; title: string; status: string; action: () => void; children: React.ReactNode }) {
  return <section className="setup-card"><header><div><span className="setup-index index-badge sequence-number" aria-hidden="true">{number}</span><div><h4>{title}</h4><small>{status}</small></div></div><button onClick={action}>编辑</button></header><div className="setup-summary">{children}</div></section>;
}

function Modal({ title, subtitle, errors = [], onClose, onSave, children }: { title: string; subtitle: string; errors?: string[]; onClose: () => void; onSave: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", close);
    document.body.classList.add("modal-open");
    return () => { document.removeEventListener("keydown", close); document.body.classList.remove("modal-open"); };
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="case-modal" role="dialog" aria-modal="true" aria-label={title}>
    <header><div><small>案例配置</small><h3>{title}</h3><p>{subtitle}</p></div><button onClick={onClose} aria-label="关闭">×</button></header>
    <div className="modal-body">{children}{errors.length > 0 && <div className="modal-validation" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}</div>
    <footer><button className="modal-cancel" onClick={onClose}>取消</button><button className="modal-save" disabled={errors.length > 0} onClick={onSave}>保存并更新概览</button></footer>
  </section></div>;
}

function ReactionModal({ draft, setDraft, index, errors, onClose, onSave }: { draft: Inputs; setDraft: React.Dispatch<React.SetStateAction<Inputs>>; index: number; errors: string[]; onClose: () => void; onSave: () => void }) {
  const symbols = networkSpeciesSymbols(draft);
  const row = draft.networkStoichiometry[index] ?? Array(symbols.length).fill(0);
  const valid = row.some(value => value < 0) && row.some(value => value > 0);
  const equation = networkReactionLatexes(draft)[index];
  const totalOrder = (draft.networkOrdersBySpecies[index] ?? []).reduce((sum, value) => sum + value, 0);
  const setRole = (species: number, role: string) => {
    const next = structuredClone(draft);
    const magnitude = Math.max(1, Math.abs(next.networkStoichiometry[index][species] || 1));
    next.networkStoichiometry[index][species] = role === "reactant" ? -magnitude : role === "product" ? magnitude : 0;
    if (next.networkElementary[index]) next.networkOrdersBySpecies[index][species] = role === "reactant" ? magnitude : 0;
    setDraft(next);
  };
  const setCoefficient = (species: number, value: number) => {
    const next = structuredClone(draft);
    const sign = Math.sign(next.networkStoichiometry[index][species]);
    next.networkStoichiometry[index][species] = sign * Math.abs(value);
    if (next.networkElementary[index]) next.networkOrdersBySpecies[index][species] = sign < 0 ? Math.abs(value) : 0;
    setDraft(next);
  };
  const toggleElementary = (checked: boolean) => {
    const next = structuredClone(draft);
    next.networkElementary[index] = checked;
    if (checked) next.networkOrdersBySpecies[index] = next.networkStoichiometry[index].map(value => value < 0 ? Math.abs(value) : 0);
    setDraft(next);
  };
  return <Modal title={`反应 R${index + 1}`} subtitle="从组分库选择参与物质；负号由界面自动处理，无需直接编辑计量矩阵。" errors={valid ? errors : ["至少选择一种反应物和一种产物后才能保存。", ...errors]} onClose={onClose} onSave={() => valid && onSave()}>
    <div className={`reaction-preview ${valid ? "ready" : ""}`}><span>反应式预览</span><MathFormula latex={equation} /></div>
    <div className="reaction-species-table">{symbols.map((symbol, species) => <div key={`reaction-species-${species}`}>
      <b>{symbol}</b>
      <select value={row[species] < 0 ? "reactant" : row[species] > 0 ? "product" : "none"} disabled={draft.networkInertSpecies[species]} onChange={event => setRole(species, event.target.value)}><option value="none">不参与</option><option value="reactant">反应物</option><option value="product">产物</option></select>
      <NumberInput label="计量系数" value={Math.abs(row[species])} min={0} disabled={row[species] === 0} onChange={value => setCoefficient(species, value)} />
    </div>)}</div>
    {!valid && <p className="modal-error">至少选择一种反应物和一种产物后才能保存。</p>}
    <h5 className="modal-subtitle">动力学与热力学</h5>
    <label className="check-row"><input type="checkbox" checked={draft.networkElementary[index]} onChange={event => toggleElementary(event.target.checked)} /><span><b>基元反应</b><small>默认按反应物计量系数自动生成正向反应级数。</small></span></label>
    <div className="modal-grid"><NumberInput label="参考速率常数" symbol={String.raw`k_{\mathrm{ref}}`} value={rateConstantFromCanonical(draft.networkRateConstants[index], totalOrder, draft)} min={0} unitLatex={rateConstantUnitLatex(totalOrder, draft)} onChange={value => setArrayValue(draft, setDraft, "networkRateConstants", index, rateConstantToCanonical(value, totalOrder, draft))} /><NumberInput label="参考温度" symbol={String.raw`T_{\mathrm{ref}}`} value={draft.networkReferenceTemperatures[index]} min={1} step={1} unit="K" onChange={value => setArrayValue(draft, setDraft, "networkReferenceTemperatures", index, value)} /><NumberInput label="活化能" symbol="E" value={energyFromSI(draft.networkActivationEnergies[index], draft)} min={0} step={1} unitLatex={`\\mathrm{${draft.energyUnit}\\,mol^{-1}}`} onChange={value => setArrayValue(draft, setDraft, "networkActivationEnergies", index, energyToSI(value, draft))} /><NumberInput label="参考反应焓" symbol={String.raw`\Delta H_{\mathrm{ref}}`} value={energyFromSI(draft.networkHeatOfReactions[index], draft)} step={1} unitLatex={`\\mathrm{${draft.energyUnit}}\\,\\mathrm{mol}_{\\mathrm{rxn}}^{-1}`} onChange={value => setArrayValue(draft, setDraft, "networkHeatOfReactions", index, energyToSI(value, draft))} /></div>
    <Segment label="反应方向" value={draft.networkReversible[index] ? "reversible" : "irreversible"} options={[["irreversible", "不可逆"], ["reversible", "可逆"]]} onChange={value => setArrayValue(draft, setDraft, "networkReversible", index, value === "reversible")} />
    {draft.networkReversible[index] && <NumberInput label="参考平衡常数" symbol={String.raw`K_{\mathrm{ref}}`} value={draft.networkEquilibriumConstants[index]} min={0} unit="按当前反应商" onChange={value => setArrayValue(draft, setDraft, "networkEquilibriumConstants", index, value)} />}
    {!draft.networkElementary[index] && <><h5 className="modal-subtitle">经验反应级数</h5><div className="modal-grid">{symbols.map((symbol, species) => <NumberInput key={`order-${species}`} label={`${symbol} 的级数`} value={draft.networkOrdersBySpecies[index][species]} min={0} unit="—" onChange={value => updateMatrix(draft, setDraft, "networkOrdersBySpecies", index, species, value)} />)}</div></>}
  </Modal>;
}

function NumberInput({ label, symbol, value, onChange, unit, unitLatex, min, max, step = 0.01, disabled = false }: { label: string; symbol?: string; value: number; onChange: (value: number) => void; unit?: string; unitLatex?: string; min?: number; max?: number; step?: number; disabled?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return <label className="workflow-field"><span>{label}{symbol && <MathFormula latex={symbol} className="field-symbol" />}</span><div><input type="number" value={text} min={min} max={max} step={step} disabled={disabled} onChange={event => { setText(event.target.value); if (event.target.value !== "" && Number.isFinite(Number(event.target.value))) onChange(Number(event.target.value)); }} />{(unit || unitLatex) && <b className="workflow-unit">{unitLatex ? <MathFormula latex={unitLatex} /> : unit}</b>}</div></label>;
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="workflow-field"><span>{label}</span><div><input value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} /></div></label>;
}

function SelectInput({ label, value, options, onChange }: { label: string; value: number; options: Array<[number, string]>; onChange: (value: number) => void }) {
  return <label className="workflow-field"><span>{label}</span><div><select value={value} onChange={event => onChange(Number(event.target.value))}>{options.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></div></label>;
}

function UnitSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option}>{option}</option>)}</select></label>;
}

function Segment({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) {
  return <div className="workflow-segment"><b>{label}</b><div>{options.map(([id, name]) => <button className={value === id ? "selected" : ""} key={id} onClick={() => onChange(id)}>{name}</button>)}</div></div>;
}

function setArrayValue<K extends keyof Inputs>(draft: Inputs, setDraft: React.Dispatch<React.SetStateAction<Inputs>>, key: K, index: number, value: Inputs[K] extends Array<infer U> ? U : never) {
  const next = structuredClone(draft);
  const array = next[key] as unknown as Array<typeof value>;
  array[index] = value;
  setDraft(next);
}

function updateMatrix(draft: Inputs, setDraft: React.Dispatch<React.SetStateAction<Inputs>>, key: "networkOrdersBySpecies" | "networkStoichiometry", row: number, column: number, value: number) {
  const next = structuredClone(draft);
  next[key][row][column] = value;
  setDraft(next);
}

function addSpecies(input: Inputs): Inputs {
  const next = structuredClone(input);
  next.networkSpeciesCount += 1;
  next.networkFeed.push(0);
  next.networkFormulas.push("");
  next.networkNames.push("");
  next.networkInertSpecies.push(false);
  next.networkCharges.push(0);
  next.networkHeatCapacities.push(80);
  next.networkStoichiometry.forEach(row => row.push(0));
  next.networkOrdersBySpecies.forEach(row => row.push(0));
  return next;
}

function removeSpecies(input: Inputs, index: number): Inputs {
  const next = structuredClone(input);
  next.networkSpeciesCount -= 1;
  (["networkFeed", "networkFormulas", "networkNames", "networkInertSpecies", "networkCharges", "networkHeatCapacities"] as const).forEach(key => next[key].splice(index, 1));
  next.networkStoichiometry.forEach(row => row.splice(index, 1));
  next.networkOrdersBySpecies.forEach(row => row.splice(index, 1));
  const remap = (value: number) => value === index ? 0 : value > index ? value - 1 : value;
  next.networkConversionSpecies = remap(next.networkConversionSpecies);
  next.networkDesiredSpecies = remap(next.networkDesiredSpecies);
  next.networkReferenceSpecies = remap(next.networkReferenceSpecies);
  if (next.networkReferenceSpecies === next.networkDesiredSpecies) next.networkReferenceSpecies = next.networkDesiredSpecies === 0 ? 1 : 0;
  return next;
}

function toggleInert(input: Inputs, setDraft: React.Dispatch<React.SetStateAction<Inputs>>, index: number, inert: boolean) {
  const next = structuredClone(input);
  next.networkInertSpecies[index] = inert;
  if (inert) {
    next.networkStoichiometry.forEach(row => { row[index] = 0; });
    next.networkOrdersBySpecies.forEach(row => { row[index] = 0; });
  }
  setDraft(next);
}

function appendReaction(input: Inputs): Inputs {
  const next = structuredClone(input);
  next.networkReactionCount += 1;
  next.networkStoichiometry.push(Array(next.networkSpeciesCount).fill(0));
  next.networkOrdersBySpecies.push(Array(next.networkSpeciesCount).fill(0));
  next.networkRateConstants.push(0.1);
  next.networkActivationEnergies.push(0);
  next.networkReferenceTemperatures.push(next.temperature);
  next.networkHeatOfReactions.push(0);
  next.networkReversible.push(false);
  next.networkEquilibriumConstants.push(10);
  next.networkElementary.push(true);
  return next;
}

function removeReaction(input: Inputs, index: number, commit: (next: Inputs) => void) {
  if (input.networkReactionCount <= 1) return;
  const next = structuredClone(input);
  next.networkReactionCount -= 1;
  (["networkStoichiometry", "networkOrdersBySpecies", "networkRateConstants", "networkActivationEnergies", "networkReferenceTemperatures", "networkHeatOfReactions", "networkReversible", "networkEquilibriumConstants", "networkElementary"] as const).forEach(key => next[key].splice(index, 1));
  commit(next);
}

function specificationSummary(input: Inputs, task: TaskId, spaceTime: number, symbols: string[]): string {
  if (task === "size") return `由${input.reactor === "BR" ? "时间" : input.reactor === "PBR" ? "催化剂质量" : "体积"}求出口 ${symbols[input.networkConversionSpecies]} 转化率`;
  if (task === "spaceTime") return `空间时间 τ=${formatNumber(timeFromSI(spaceTime, input))} ${input.timeUnit} 时求出口转化率`;
  if (task === "compare") return `达到 ${symbols[input.networkConversionSpecies]} 转化率 ${formatNumber(input.targetX)} 时比较 CSTR/PFR`;
  if (task === "pressureCompare") return `达到目标转化率时比较压降影响`;
  return `达到 ${symbols[input.networkConversionSpecies]} 转化率 ${formatNumber(input.targetX)} 所需设备尺度`;
}

function sectionStatus(errors: string[], readyLabel: string): string {
  return errors.length ? `待完善 · ${errors[0]}` : readyLabel;
}

function taskOptions(reactor: Inputs["reactor"]): string[][] {
  if (reactor === "BR") return [["target", "由转化率求时间"], ["size", "由时间求转化率"]];
  if (reactor === "CSTR") return [["target", "由转化率求体积"], ["size", "由体积求转化率"], ["spaceTime", "由空间时间求转化率"], ["compare", "与 PFR 对比"]];
  if (reactor === "PFR") return [["target", "由转化率求体积"], ["size", "由体积求转化率"], ["compare", "与 CSTR 对比"]];
  return [["target", "由转化率求催化剂质量"], ["size", "由催化剂质量求转化率"], ["pressure", "考虑压降计算"], ["pressureCompare", "比较压降影响"]];
}

function reactorDescription(type: Inputs["reactor"]): string {
  return type === "BR" ? "间歇、全混、以时间为尺度" : type === "CSTR" ? "连续全混、釜内状态等同出口" : type === "PFR" ? "稳态平推流、沿体积存在分布" : "固定床、以催化剂质量为设计尺度";
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(5)).toString() : "—";
}
