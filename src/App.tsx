import { useEffect, useMemo, useState } from "react";
import { LineChart } from "./components/LineChart";
import { MathFormula } from "./components/MathFormula";
import { CaseWorkflow } from "./components/CaseWorkflow";
import { toCaseConfiguration, toUnifiedNetwork } from "./core/caseConfiguration";
import { caseReadiness } from "./core/caseReadiness";
import { activityFromCanonical, activityUnit, energyFromSI, flowFromCanonical, pressureFromBar, rateConstantFromCanonical, rateConstantUnitLatex, rateFromCanonical, rateUnit, timeFromSI, volumeFromLitres, volumeUnit } from "./core/units";
import {
  calculate,
  compareCstrPfr,
  defaults,
  equilibriumConversion,
  format,
  levenspiel,
  limitingAnalysis,
  inletVolumetricFlow,
  normalizeInputs,
  networkReactionLatexes,
  networkSpeciesSymbols,
  speciesLabels,
  type Inputs,
  type Reactor,
  type Result,
} from "./core/models";

type View = "home" | "calculator" | "announcements" | "formulas" | "cases" | "help";
type TaskId = "target" | "size" | "spaceTime" | "compare" | "pressure" | "pressureCompare";

const reactorInfo: Array<{ id: Reactor; name: string; feature: string; uses: string[] }> = [
  { id: "BR", name: "间歇反应器", feature: "封闭 · 全混 · 状态随时间变化", uses: ["求反应时间", "由时间求转化率"] },
  { id: "CSTR", name: "全混流反应器", feature: "连续进出 · 釜内等同出口", uses: ["求反应器体积", "由空间时间求转化率"] },
  { id: "PFR", name: "平推流反应器", feature: "稳态 · 无返混 · 轴向梯度", uses: ["求反应器体积", "查看轴向变化"] },
  { id: "PBR", name: "固定床反应器", feature: "气固催化 · 以催化剂质量计", uses: ["求催化剂质量", "比较压力降影响"] },
];

const tasks: Record<Reactor, Array<{ id: TaskId; title: string; output: string; description: string }>> = {
  BR: [
    { id: "target", title: "由目标转化率求反应时间", output: "输出 t 与 X–t 曲线", description: "支持液相恒容或气相恒温恒压变体积。" },
    { id: "size", title: "由反应时间求转化率", output: "输出 X 与组分状态/速率", description: "用于核对批次反应时间是否足够。" },
  ],
  CSTR: [
    { id: "target", title: "由目标转化率求体积", output: "输出 V、τ 与出口速率", description: "速率按出口状态计算。" },
    { id: "size", title: "由反应器体积求转化率", output: "输出稳态出口转化率", description: "只返回满足物理边界的根。" },
    { id: "spaceTime", title: "由空间时间求转化率", output: "输出出口转化率与 Da", description: "适合课堂演示 τ、Da 与 X 的关系。" },
    { id: "compare", title: "与 PFR 进行同条件对比", output: "输出体积表与 Levenspiel 图", description: "同一进料、动力学和目标转化率。" },
  ],
  PFR: [
    { id: "target", title: "由目标转化率求体积", output: "输出 V 与 X–V 曲线", description: "沿程速率积分得到反应器体积。" },
    { id: "size", title: "由反应器体积求转化率", output: "输出出口转化率、限制组分状态与速率", description: "同时生成轴向变化曲线。" },
    { id: "compare", title: "与 CSTR 进行同条件对比", output: "输出体积表与 Levenspiel 图", description: "比较结论随速率–转化率关系而定。" },
  ],
  PBR: [
    { id: "target", title: "由目标转化率求催化剂质量", output: "输出 W 与 X–W 曲线", description: "默认忽略压力降。" },
    { id: "size", title: "由催化剂质量求转化率", output: "输出出口转化率与出口速率", description: "速率采用催化剂质量基准。" },
    { id: "pressure", title: "考虑压力降的固定床计算", output: "输出 W、X–W 与 p–W", description: "联立转化率和压力比方程。" },
    { id: "pressureCompare", title: "比较忽略/考虑压力降", output: "输出两组结果与叠加曲线", description: "用于判断压力降是否可忽略。" },
  ],
};

const formulaRows = [
  ["通用摩尔衡算", "F_{j0}-F_j+\\int_V r_j\\,dV=\\frac{dN_j}{dt}", "所有反应器；稳态时累积项为 0"],
  ["多反应净生成速率", "R_j=\\sum_{m=1}^{n_r}\\nu_{mj}r_m=(\\nu^T\\mathbf r)_j", "每个物种的净速率由全部反应路径共同决定"],
  ["计量元素守恒", "E\\nu^T=0,\\qquad \\sum_j z_j\\nu_{mj}=0", "E 为元素组成矩阵；后一式检查每条反应的电荷守恒"],
  ["自适应误差尺度", "w_i=\\mathrm{atol}+\\mathrm{rtol}\\max(|y_i|,|y_{i,\\mathrm{new}}|)", "RK45 与隐式步长控制使用同一尺度化误差准则"],
  ["多反应 PFR", "\\frac{dF_j}{dV}=R_j", "对每个物种联立摩尔流率 ODE"],
  ["多反应 CSTR", "F_{j0}-F_j+R_jV=0", "对全部出口物种联立非线性代数方程"],
  ["瞬时与总选择性", "S_{D/U}=\\frac{R_D}{R_U},\\qquad \\widetilde S_{D/U}=\\frac{F_D-F_{D0}}{F_U-F_{U0}},\\qquad Y_D=\\frac{F_D-F_{D0}}{F_{L0}}", "仅在显式定义目标产物 D 与非目标产物 U 后计算；入口产物进料从净生成量中扣除"],
  ["液相幂律", "r=k\\prod_j C_j^{n_j},\\quad -r_L=s_Lr", "液相以浓度为动力学基准"],
  ["气相幂律", "r=k\\prod_j P_j^{n_j},\\quad -r_L=s_Lr", "气相以各组分分压为动力学基准"],
  ["逐反应可逆净速率", "r_m=k_m(T)\\prod_j a_j^{\\alpha_{mj}}\\left(1-\\frac{Q_m}{K_m(T)}\\right)", "每条可逆步骤独立判断方向；Qₘ=Kₘ(T) 时该步净速率为零"],
  ["van't Hoff", "\\ln\\frac{K(T)}{K_{\\mathrm{ref}}}=\\frac{\\Delta H_{\\mathrm{ref}}}{R}\\left(\\frac1{T_{\\mathrm{ref}}}-\\frac1T\\right)+\\frac{\\Delta C_P}{R}\\left[\\ln\\frac{T}{T_{\\mathrm{ref}}}+T_{\\mathrm{ref}}\\left(\\frac1T-\\frac1{T_{\\mathrm{ref}}}\\right)\\right]", "常数定压热容；包含 ΔCₚ 修正"],
  ["Arrhenius 换算", "k(T)=k_{\\mathrm{ref}}\\exp\\!\\left[-\\frac{E}{R}\\left(\\frac1T-\\frac1{T_{\\mathrm{ref}}}\\right)\\right]", "动力学参数所在温度范围内"],
  ["液相计量", "C_{R_j}=C_{R_j,0}-\\frac{s_{R_j}}{s_L}C_{L0}X,\\quad C_{P_j}=C_{P_j,0}+\\frac{s_{P_j}}{s_L}C_{L0}X", "s_j 对应界面的 a、b、c…；L 为限制反应物"],
  ["气相计量", "P_j=P_j^{*}\\frac{P/P_0}{1+\\varepsilon X}", "P_j* 先按反应物减、产物加计算；ε 自动计算"],
  ["BR", "\\displaystyle t=C_{L0}\\int\\limits_{0}^{X}\\frac{dX}{-r_L}", "液相恒容、等温；L 为限制反应物"],
  ["CSTR", "V=\\frac{F_{L0}(X_{\\mathrm{out}}-X_{\\mathrm{in}})}{(-r_L)_{\\mathrm{out}}}", "稳态、全混"],
  ["PFR", "\\displaystyle V=F_{L0}\\int\\limits_{0}^{X}\\frac{dX}{-r_L}", "稳态、无轴向返混"],
  ["PBR", "\\displaystyle W=F_{L0}\\int\\limits_{0}^{X}\\frac{dX}{-r'_L}", "速率以 kg_cat 为基准"],
  ["PFR 能量衡算", "\\frac{dT}{dV}=\\frac{Ua(T_{\\mathrm{env}}-T)-\\Delta H(T)r}{\\sum_iF_iC_{p,i}}", "稳态非恒温"],
  ["PBR 能量衡算", "\\frac{dT}{dW}=\\frac{(Ua/\\rho_b)(T_{\\mathrm{env}}-T)-\\Delta H(T)r'}{\\sum_iF_iC_{p,i}}", "稳态非恒温"],
  ["PBR 压降", "\\frac{dp}{dW}=-\\frac{\\alpha}{2p}\\frac{F_T}{F_{T0}}\\frac{T}{T_0}", "仅气相 PBR；可与能量衡算联立"],
];

export default function App() {
  const [view, setView] = useState<View>("home");
  const [step, setStep] = useState(3);
  const [inputs, setInputs] = useState<Inputs>(() => toUnifiedNetwork(defaults));
  const [task, setTask] = useState<TaskId>("target");
  const [spaceTime, setSpaceTime] = useState(6);
  const [result, setResult] = useState<Result | null>(null);
  const [comparison, setComparison] = useState<Result[] | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [formulaQuery, setFormulaQuery] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("reaction-solver-inputs");
    if (saved) {
      try { setInputs(toUnifiedNetwork(normalizeInputs(JSON.parse(saved)))); } catch { /* Corrupted local cache is ignored. */ }
    }
  }, []);

  const update = <K extends keyof Inputs>(key: K, value: Inputs[K]) => {
    setInputs(old => {
      const next = { ...old, [key]: value };
      localStorage.setItem("reaction-solver-inputs", JSON.stringify(next));
      return next;
    });
    if (result || comparison) setStale(true);
    setError("");
  };

  const commitInputs = (next: Inputs) => {
    const normalized = toUnifiedNetwork(next);
    if (!tasks[normalized.reactor].some(item => item.id === task)) setTask("target");
    setInputs(normalized);
    localStorage.setItem("reaction-solver-inputs", JSON.stringify(normalized));
    localStorage.setItem("reaction-case-v16", JSON.stringify(toCaseConfiguration(normalized)));
    if (result || comparison) setStale(true);
    setError("");
  };

  const chooseReactor = (reactor: Reactor) => {
    setInputs(old => ({ ...old, reactor, pressureDrop: false, isothermal: reactor === "BR" || reactor === "CSTR" ? true : old.isothermal }));
    setTask("target");
    setResult(null);
    setComparison(null);
    setStale(false);
    setStep(3);
    setView("calculator");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const chooseTask = (id: TaskId) => {
    setTask(id);
    update("solveFor", id === "size" || id === "spaceTime" ? "size" : "target");
    update("pressureDrop", id === "pressure" || id === "pressureCompare");
    if (id === "compare" || id === "spaceTime") update("isothermal", true);
    setResult(null);
    setComparison(null);
    setStale(false);
  };

  const startCase = () => {
    setView("calculator");
    setStep(3);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const effectiveInputs = (): Inputs => {
    if (task === "spaceTime") {
      const volumetricFlow = inputs.reactionMode === "multiple"
        ? inputs.phase === "gas"
          ? inputs.fa0 * 0.08314462618 * inputs.temperature / inputs.networkFeed[inputs.networkConversionSpecies]
          : inputs.fa0 / inputs.networkFeed[inputs.networkConversionSpecies]
        : inletVolumetricFlow(inputs);
      return { ...inputs, solveFor: "size", size: spaceTime * volumetricFlow, pressureDrop: false };
    }
    return {
      ...inputs,
      solveFor: task === "size" ? "size" : "target",
      pressureDrop: inputs.reactor === "PBR" && inputs.phase === "gas" && (inputs.pressureDrop || task === "pressure" || task === "pressureCompare"),
    };
  };

  const run = () => {
    const readiness = caseReadiness(effectiveInputs());
    if (!readiness.ready) {
      setError(readiness.errors.slice(0, 4).join("；"));
      return;
    }
    try {
      if (task === "compare") {
        setComparison(compareCstrPfr({ ...inputs, solveFor: "target", pressureDrop: false }));
        setResult(null);
      } else if (task === "pressureCompare") {
        const base = { ...inputs, reactor: "PBR" as const, solveFor: "target" as const };
        setComparison([calculate({ ...base, pressureDrop: false }), calculate({ ...base, pressureDrop: true })]);
        setResult(null);
      } else {
        setResult(calculate(effectiveInputs()));
        setComparison(null);
      }
      setError("");
      setStale(false);
      setStep(4);
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 0);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "计算失败，请检查输入。");
    }
  };

  const reset = () => {
    const next = toUnifiedNetwork({ ...defaults, reactor: inputs.reactor });
    setInputs(next);
    setSpaceTime(6);
    setResult(null);
    setComparison(null);
    setStale(false);
    setError("");
    localStorage.setItem("reaction-solver-inputs", JSON.stringify(next));
  };

  const taskInfo = tasks[inputs.reactor].find(item => item.id === task);

  return (
    <div className="app-shell">
      <Header view={view} go={setView} start={startCase} />
      {view === "home" && <Home choose={chooseReactor} start={startCase} />}
      {view === "calculator" && (
        <Calculator
          step={step}
          inputs={inputs}
          task={task}
          taskInfo={taskInfo}
          chooseTask={chooseTask}
          spaceTime={spaceTime}
          setSpaceTime={value => { setSpaceTime(value); if (result || comparison) setStale(true); }}
          result={result}
          comparison={comparison}
          stale={stale}
          error={error}
          run={run}
          reset={reset}
          commitInputs={commitInputs}
        />
      )}
      {view === "announcements" && <Announcements />}
      {view === "formulas" && <FormulaPage query={formulaQuery} setQuery={setFormulaQuery} />}
      {view === "cases" && <Cases />}
      {view === "help" && <Help />}
      <Footer />
    </div>
  );
}

function Header({ view, go, start }: { view: View; go: (view: View) => void; start: () => void }) {
  const items: Array<[View, string]> = [["home", "首页"], ["calculator", "开始计算"], ["cases", "案例"], ["formulas", "公式与符号"]];
  return (
    <header className="topbar">
      <button className="brand" onClick={() => go("home")}><span>RE</span><div><b>反应工程智能求解器</b><small>LOCAL · V1.6</small></div></button>
      <nav>{items.map(([id, label]) => <button key={id} className={view === id ? "active" : ""} onClick={() => id === "calculator" ? start() : go(id)}>{label}</button>)}</nav>
      <div className="top-actions"><button onClick={() => go("announcements")}>公告</button><button onClick={() => go("help")}>使用说明</button><span>SI</span><button className="top-primary" onClick={start}>新建计算</button></div>
    </header>
  );
}

function Home({ choose, start }: { choose: (reactor: Reactor) => void; start: () => void }) {
  return (
    <main>
      <section className="solver-hero">
        <div>
          <p className="kicker">课堂计算 · 作业核对 · 参数演示</p>
          <h1>反应工程<br /><em>智能求解器</em></h1>
          <p className="hero-text">依次确认组分与反应、入口物流、反应器和计算规格，再获得主要答案、变化曲线与计算依据。网页负责繁琐计算，模型选择仍由你判断。</p>
          <button className="main-button" onClick={start}>开始新计算 <span>→</span></button>
          <div className="flowline">{["组分与反应", "物流与设备", "计算规格", "结果与依据"].map((text, index) => <span key={text}><b className="index-badge sequence-number">{String(index + 1).padStart(2, "0")}</b>{text}</span>)}</div>
        </div>
        <div className="hero-status">
          <p><i /> V1.6 本地版可用</p>
          <strong>4</strong><span>类基础反应器</span>
          <ul><li>弹窗式组分与反应编辑</li><li>动态添加反应，无需预设数量</li><li>入口—反应器—出口物流概览</li><li>高级数值选项默认折叠</li></ul>
          <small>当前为单反应器流程；自由组合设备将在后续版本开放</small>
        </div>
      </section>
      <section className="reactor-entry">
        <div className="section-title"><div><p className="kicker">可选快捷入口</p><h2>用反应器示例开始</h2></div><p>也可直接“开始新计算”，在案例工作流的第 4 张卡片中选择反应器。</p></div>
        <div className="reactor-grid">{reactorInfo.map(item => <ReactorCard key={item.id} item={item} onClick={() => choose(item.id)} />)}</div>
      </section>
      <section className="home-notice">
        <span>版本能力</span><div><b>当前为 V1.6：案例工作流版</b><p>用组分、反应、物流、设备和计算规格摘要替代长表单。</p></div><time>2026-08-20</time>
      </section>
    </main>
  );
}

function ReactorCard({ item, onClick }: { item: typeof reactorInfo[number]; onClick: () => void }) {
  return (
    <button className="reactor-card" onClick={onClick}>
      <div className={`reactor-icon ${item.id.toLowerCase()}`}><span>{item.id}</span></div>
      <p>{item.feature}</p><h3>{item.id}<small>{item.name}</small></h3>
      <ul>{item.uses.map(use => <li key={use}>{use}</li>)}</ul>
      <span className="card-link">选择该反应器 →</span>
    </button>
  );
}

function Calculator(props: {
  step: number; inputs: Inputs;
  task: TaskId; taskInfo?: { title: string; output: string; description: string };
  chooseTask: (id: TaskId) => void; spaceTime: number; setSpaceTime: (v: number) => void; result: Result | null;
  comparison: Result[] | null; stale: boolean; error: string; run: () => void; reset: () => void;
  commitInputs: (next: Inputs) => void;
}) {
  const { inputs, task, taskInfo, chooseTask, spaceTime, setSpaceTime, result, comparison, stale, error, run, reset, commitInputs } = props;
  const readiness = caseReadiness(task === "spaceTime" ? { ...inputs, solveFor: "size", size: Math.max(spaceTime, 1e-12) } : inputs);
  return (
    <main className="calculator-page">
      <div className="calculator-head">
        <div><p className="kicker">新建计算</p><h1>反应器计算</h1></div>
        <div className="stepper workflow-steps">{["组分与反应", "入口物流", "设备与规格", "运行结果"].map((label, index) => <div key={label} className={index < 3 ? "done" : result || comparison ? "done" : readiness.ready ? "current" : ""}><b className="sequence-number">{index + 1}</b><span>{label}</span></div>)}</div>
      </div>
      {(
        <>
          <section className="input-stage">
            <div className="input-column">
              <CaseWorkflow inputs={inputs} task={task} spaceTime={spaceTime} setSpaceTime={setSpaceTime} commit={commitInputs} changeTask={chooseTask} result={stale ? null : result} />
              {!readiness.ready && <div className="readiness-panel"><b>还不能运行</b><ul>{readiness.errors.slice(0, 5).map(item => <li key={item}>{item}</li>)}</ul></div>}
              {error && <div className="error" role="alert"><b>暂时不能计算</b><p>{error}</p></div>}
              <div className="form-footer"><button className="reset" onClick={reset}>恢复示例值</button><button className="run" disabled={!readiness.ready} onClick={run}>{readiness.ready ? runLabel(inputs.reactor, task) : "请先完善案例"} <span>→</span></button></div>
            </div>
            <aside className="task-summary">
              <p className="kicker">当前任务</p><h3>{taskInfo?.title}</h3><dl><div><dt>反应器</dt><dd>{inputs.reactor}</dd></div><div><dt>相态</dt><dd>{inputs.phase === "liquid" ? "液相 · 浓度基准" : "气相 · 理想气体"}</dd></div><div><dt>反应集合</dt><dd>用户定义 · {inputs.networkReactionCount} 条</dd></div><div><dt>组分规模</dt><dd>{inputs.networkSpeciesCount} 个组分</dd></div><div><dt>转化率基准</dt><dd>{limitingAnalysis(inputs).symbols.join("、") || "待判定"}</dd></div><div><dt>热力条件</dt><dd>{inputs.isothermal ? `恒温 ${inputs.temperature} K` : `非恒温 · 入口 ${inputs.temperature} K`}</dd></div><div><dt>压力条件</dt><dd>{inputs.pressureDrop ? "变压" : "恒压"}</dd></div></dl>
              <div className="task-sentence">{summarySentence(inputs, task, spaceTime)}</div>
              <small>内部自动换算为统一基准；当前显示采用 {inputs.timeUnit}、{inputs.energyUnit}、{inputs.pressureUnit}、{inputs.lengthUnit}。</small>
            </aside>
          </section>
          {(result || comparison) && <Results inputs={inputs} task={task} result={result} comparison={comparison} stale={stale} rerun={run} />}
        </>
      )}
    </main>
  );
}

function Results({ inputs, task, result, comparison, stale, rerun }: { inputs: Inputs; task: TaskId; result: Result | null; comparison: Result[] | null; stale: boolean; rerun: () => void }) {
  return (
    <section id="results" className={`results ${stale ? "stale" : ""}`}>
      <div className="results-head"><div><p className="kicker">计算结果</p><h2>{comparison ? "对比结果" : result?.primaryLabel}</h2></div><div className="export-actions"><button onClick={() => downloadCalculationLog(inputs, task, result, comparison)}>导出计算日志</button><button onClick={() => window.print()}>打印摘要</button></div></div>
      {stale && <div className="stale-banner"><b>输入已修改，以下结果属于上一组参数。</b><button onClick={rerun}>按新参数重新计算</button></div>}
      {comparison ? <ComparisonResult inputs={inputs} task={task} results={comparison} /> : result && <SingleResult inputs={inputs} result={result} />}
    </section>
  );
}

function SingleResult({ inputs, result }: { inputs: Inputs; result: Result }) {
  const limitingSymbol = result.limitingSymbols[0] ?? "L";
  const displayOrder = result.multiple
    ? inputs.networkOrdersBySpecies[0]?.reduce((sum, value) => sum + value, 0) ?? 1
    : inputs.reactantOrders.reduce((sum, value) => sum + value, 0);
  const gasPhase = inputs.phase === "gas";
  const stateName = gasPhase ? "分压" : "浓度";
  const stateUnit = activityUnit(inputs);
  const displayScale = (scale: number) => inputs.reactor === "BR" ? timeFromSI(scale, inputs) : inputs.reactor === "PBR" ? scale : volumeFromLitres(scale, inputs);
  const scaleUnit = inputs.reactor === "BR" ? inputs.timeUnit : inputs.reactor === "PBR" ? "kg_cat" : volumeUnit(inputs);
  const scaleName = inputs.reactor === "BR" ? `时间 t / ${inputs.timeUnit}` : inputs.reactor === "PBR" ? "催化剂质量 W / kg_cat" : `体积 V / ${volumeUnit(inputs)}`;
  const chart = useMemo(() => [{ name: `转化率 X_${limitingSymbol}`, legendLatex: `X_{${limitingSymbol}}`, color: "#660874", values: result.points.map(point => ({ x: displayScale(point.s), y: point.x })) }], [result, limitingSymbol, inputs.timeUnit, inputs.lengthUnit]);
  const distributed = inputs.reactor === "PFR" || inputs.reactor === "PBR";
  const profileX = (scale: number) => volumeFromLitres(inputs.reactor === "PBR" ? scale / inputs.catalystBulkDensity : scale, inputs);
  const profileScaleName = inputs.reactor === "PBR" ? `床层体积 V_b / ${volumeUnit(inputs)}` : `体积 V / ${volumeUnit(inputs)}`;
  const componentNames = result.multiple
    ? [...result.multiple.speciesSymbols, ...(inputs.inertConcentration > 0 ? ["I"] : [])]
    : [...speciesLabels(inputs).reactants, ...speciesLabels(inputs).products, ...(inputs.inertConcentration > 0 ? ["I"] : [])];
  const componentColors = ["#660874", "#b65315", "#267855", "#3169a8", "#a3376d", "#7c6a16", "#5d4c91", "#237b78", "#706875"];
  const molarFlowSeries = componentNames.map((symbol, index) => ({ name: `${symbol} 摩尔流率`, legendLatex: `F_{${symbol}}`, color: componentColors[index % componentColors.length], values: result.points.map(point => ({ x: profileX(point.s), y: flowFromCanonical(point.flows[index], inputs) })) }));
  const inletPressure = [...(result.multiple ? inputs.networkFeed : [...inputs.reactantConcentrations, ...inputs.productConcentrations]), inputs.inertConcentration].reduce((sum, value) => sum + value, 0);
  const multipleScaleX = (scale: number) => distributed ? profileX(scale) : displayScale(scale);
  const multipleScaleName = distributed ? profileScaleName : scaleName;
  const equilibriumTemperatureDomain: [number, number] = [Math.max(1, inputs.temperature - 100), inputs.temperature + 100];
  const equilibriumTemperatureSeries = useMemo(() => {
    const [minimum, maximum] = equilibriumTemperatureDomain;
    return Array.from({ length: 81 }, (_, index) => {
      const temperature = minimum + (maximum - minimum) * index / 80;
      return { x: temperature, y: equilibriumConversion(temperature, 1, inputs) ?? 0 };
    });
  }, [inputs]);
  return (
    <>
      <div className="answer-grid">
        <article className="primary-answer"><span>{result.primaryLabel}</span><strong>{format(result.primaryUnit === "—" ? result.primaryValue : displayScale(result.primaryValue))}</strong><b>{result.primaryUnit === "—" ? "—" : scaleUnit}</b></article>
        {!result.primaryLabel.startsWith("出口") && <article><span>出口 {limitingSymbol} 转化率</span><strong>{(result.outletX * 100).toFixed(2)}</strong><b>%</b></article>}
        {inputs.reversible && <article><span>出口条件平衡转化率</span><strong>{(((result.points.at(-1)?.xeq ?? 0) * 100)).toFixed(2)}</strong><b>%</b></article>}
        {result.multiple?.selectivityEnabled && <article><span>{result.multiple.desiredSymbol}/{result.multiple.referenceSymbol} 总选择性</span><strong>{format(result.multiple.overallSelectivity ?? Number.NaN)}</strong><b>—</b></article>}
        {result.multiple?.selectivityEnabled && <article><span>{result.multiple.desiredSymbol} 总收率</span><strong>{(result.multiple.desiredYield * 100).toFixed(2)}</strong><b>%</b></article>}
        {result.multiple?.selectivityEnabled && <article><span>出口瞬时选择性</span><strong>{format(result.multiple.instantaneousSelectivity ?? Number.NaN)}</strong><b>R{result.multiple.desiredSymbol}/R{result.multiple.referenceSymbol}</b></article>}
        {result.multiple?.selectivityEnabled && result.multiple.peakDesired && <article><span>{result.multiple.desiredSymbol} 沿程峰值</span><strong>{format(activityFromCanonical(result.multiple.peakDesired.value, inputs))}</strong><b>{stateUnit} @ {format(displayScale(result.multiple.peakDesired.scale))} {scaleUnit}</b></article>}
        <article><span>出口{result.multiple ? `${limitingSymbol} ` : "限制组分"}{stateName} <MathFormula latex={`${gasPhase ? "P" : "C"}_${limitingSymbol}`} /></span><strong>{format(activityFromCanonical(result.outletState, inputs))}</strong><b>{stateUnit}</b></article>
        <article><span>{result.multiple ? `出口 ${limitingSymbol} 净消耗速率` : "出口反应速率"}</span><strong>{format(rateFromCanonical(result.outletRate, inputs))}</strong><b>{rateUnit(inputs)}</b></article>
        {!inputs.isothermal && <article><span>出口温度</span><strong>{format(result.outletTemperature)}</strong><b>K</b></article>}
        {result.spaceTime !== null && <article><span>空间时间 τ</span><strong>{format(timeFromSI(result.spaceTime, inputs))}</strong><b>{inputs.timeUnit}</b></article>}
        {inputs.reactor === "PBR" && inputs.pressureDrop && <article><span>出口压力比 p</span><strong>{format(result.pressureRatio)}</strong><b>P/P₀</b></article>}
      </div>
      <div className="composition-table-wrap"><table><thead><tr><th>组分</th><th>角色</th><th>入口{stateName} / {stateUnit}</th><th>出口{stateName} / {stateUnit}</th></tr></thead><tbody>{result.outletComponents.map(component => <tr key={`${component.role}-${component.symbol}`}><td><MathFormula latex={component.symbol} /></td><td>{{ reactant: "反应物", product: "产物", inert: "惰性物质", desired: "目标产物", undesired: "参照副产物", intermediate: "中间产物" }[component.role]}</td><td>{format(activityFromCanonical(component.inlet, inputs))}</td><td>{format(activityFromCanonical(component.outlet, inputs))}</td></tr>)}</tbody></table></div>
      {result.warnings.map(message => <div className="warning" key={message}><b>边界提示</b><p>{message}</p></div>)}
      <div className="result-body">
        <div className="plots">
          <div className="plot-card"><header><h3>默认结果曲线</h3><span>{result.method}</span></header><LineChart series={chart} xLabel={scaleName} yLabel="转化率 X / —" yDomain={[0, 1]} target={{ x: displayScale(result.scale), y: result.outletX, label: "出口点" }} /></div>
          {distributed && <div className="plot-card"><header><h3>各组分摩尔流率分布</h3><span>理想气体同样按 Fᵢ 计量</span></header><LineChart series={molarFlowSeries} xLabel={profileScaleName} yLabel={`摩尔流率 Fᵢ / mol·${inputs.timeUnit}⁻¹`} /></div>}
          {result.multiple && <div className="plot-card"><header><h3>各反应净速率</h3><span>负值表示该可逆步骤发生净逆向反应</span></header><LineChart series={Array.from({ length: inputs.networkReactionCount }, (_, reaction) => ({ name: `反应 ${reaction + 1}`, legendLatex: `r_{${reaction + 1}}`, color: componentColors[reaction % componentColors.length], values: result.points.map(point => ({ x: multipleScaleX(point.s), y: rateFromCanonical(point.reactionRates?.[reaction] ?? 0, inputs) })) }))} xLabel={multipleScaleName} yLabel={`反应速率 rₘ / ${rateUnit(inputs)}`} /></div>}
          {result.multiple && <div className="plot-card"><header><h3>各物种净生成速率</h3><span>Rⱼ=Σₘνₘⱼrₘ</span></header><LineChart showZeroLine series={result.multiple.speciesSymbols.map((symbol, species) => ({ name: `R_${symbol}`, legendLatex: `R_{${symbol}}`, color: componentColors[species % componentColors.length], values: result.points.map(point => ({ x: multipleScaleX(point.s), y: rateFromCanonical(point.netRates?.[species] ?? 0, inputs) })) }))} xLabel={multipleScaleName} yLabel={`净生成速率 Rⱼ / ${rateUnit(inputs)}`} /></div>}
          {result.multiple?.selectivityEnabled && <div className="plot-card"><header><h3>瞬时选择性分布</h3><span>S={result.multiple.desiredSymbol}/{result.multiple.referenceSymbol}=R{result.multiple.desiredSymbol}/R{result.multiple.referenceSymbol}</span></header><LineChart series={[{ name: `瞬时选择性 ${result.multiple.desiredSymbol}/${result.multiple.referenceSymbol}`, color: "#267855", values: result.points.flatMap(point => { const value = point.instantaneousSelectivity; return value !== null && value !== undefined && Number.isFinite(value) ? [{ x: multipleScaleX(point.s), y: value }] : []; }) }]} xLabel={multipleScaleName} yLabel="瞬时选择性 / —" /></div>}
          {distributed && inputs.reversible && <div className="plot-card"><header><h3>实际转化率与平衡转化率</h3><span>Q=K(T)</span></header><LineChart series={[{ name: "实际转化率", color: "#660874", values: result.points.map(point => ({ x: profileX(point.s), y: point.x })) }, { name: "平衡转化率", color: "#b65315", values: result.points.map(point => ({ x: profileX(point.s), y: point.xeq ?? 0 })) }]} xLabel={profileScaleName} yLabel="转化率 / —" yDomain={[0, 1]} /></div>}
          {inputs.reversible && <div className="plot-card"><header><h3>平衡转化率—温度关系</h3><span>{gasPhase ? "入口总压力基准" : "当前进料基准"} · T₀±100 K</span></header><LineChart series={[{ name: "平衡转化率", color: "#b65315", values: equilibriumTemperatureSeries }]} xLabel="温度 T / K" yLabel="平衡转化率 X_eq / —" xDomain={equilibriumTemperatureDomain} yDomain={[0, 1]} /></div>}
          {!inputs.isothermal && distributed && <div className="plot-card"><header><h3>稳态温度分布</h3><span>恒定外界温度边界</span></header><LineChart includeZero={false} series={[{ name: "反应物流温度", color: "#b65315", values: result.points.map(point => ({ x: profileX(point.s), y: point.t })) }, { name: "环境温度", color: "#267855", values: result.points.map(point => ({ x: profileX(point.s), y: inputs.environmentTemperature })) }]} xLabel={profileScaleName} yLabel="温度 T / K" /></div>}
          {inputs.reactor === "PBR" && inputs.pressureDrop && <div className="plot-card"><header><h3>床层压力变化</h3><span>P=pP₀</span></header><LineChart includeZero={false} series={[{ name: "总压力 P", legendLatex: "P", color: "#b65315", values: result.points.map(point => ({ x: profileX(point.s), y: pressureFromBar(point.p * inletPressure, inputs) })) }]} xLabel={profileScaleName} yLabel={`压力 P / ${inputs.pressureUnit}`} /></div>}
        </div>
        <aside className="result-interpretation"><div className="interpret"><b>与本题直接相关的解释</b><p>{result.conclusion}</p></div><dl><div><dt>{result.multiple ? "k₁(T₀)" : "k(T₀)"}</dt><dd>{format(rateConstantFromCanonical(result.k, displayOrder, inputs))} <MathFormula latex={rateConstantUnitLatex(displayOrder, inputs)} /></dd></div><div><dt>相态</dt><dd>{inputs.phase === "liquid" ? "液相恒密度" : "气相分压基准"}</dd></div><div><dt>温度</dt><dd>{inputs.isothermal ? "恒温" : `${format(inputs.temperature)} → ${format(result.outletTemperature)} K`}</dd></div>{inputs.phase === "gas" && !result.multiple && <div><dt>自动计算 ε</dt><dd>{format(result.epsilon)}</dd></div>}<div><dt>求解方法</dt><dd>{result.method}</dd></div></dl></aside>
      </div>
      <Evidence result={result} />
    </>
  );
}

function ComparisonResult({ inputs, task, results }: { inputs: Inputs; task: TaskId; results: Result[] }) {
  const isPressure = task === "pressureCompare";
  const isMultiple = inputs.reactionMode === "multiple";
  const labels = isPressure ? ["忽略压降", "考虑压降"] : ["CSTR", "PFR"];
  const lev = isMultiple ? [] : levenspiel(inputs);
  const displayResultScale = (item: Result, value: number) => item.reactor === "BR" ? timeFromSI(value, inputs) : item.reactor === "PBR" ? value : volumeFromLitres(value, inputs);
  const resultScaleUnit = (item: Result) => item.reactor === "BR" ? inputs.timeUnit : item.reactor === "PBR" ? "kg_cat" : volumeUnit(inputs);
  return (
    <>
      <div className="comparison-table-wrap"><table><thead><tr><th>比较项</th>{labels.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        <tr><td>{isPressure ? "所需催化剂质量" : "所需体积"}</td>{results.map((item, index) => <td key={index}><strong>{format(displayResultScale(item, item.scale))}</strong> {resultScaleUnit(item)}</td>)}</tr>
        <tr><td>出口转化率</td>{results.map((item, index) => <td key={index}>{(item.outletX * 100).toFixed(2)}%</td>)}</tr>
        <tr><td>出口{inputs.phase === "gas" ? "分压" : "浓度"}</td>{results.map((item, index) => <td key={index}>{format(activityFromCanonical(item.outletState, inputs))} {activityUnit(inputs)}</td>)}</tr>
        {!inputs.isothermal && <tr><td>出口温度</td>{results.map((item, index) => <td key={index}>{format(item.outletTemperature)} K</td>)}</tr>}
        <tr><td>出口反应速率</td>{results.map((item, index) => <td key={index}>{format(rateFromCanonical(item.outletRate, inputs))} {rateUnit(inputs)}</td>)}</tr>
        {isPressure && <tr><td>出口压力比</td>{results.map((item, index) => <td key={index}>{format(item.pressureRatio)}</td>)}</tr>}
      </tbody></table></div>
      <div className="comparison-plots">
        <div className="plot-card"><header><h3>{isPressure ? "X–W 曲线叠加" : isMultiple ? `多反应 X_${networkSpeciesSymbols(inputs)[inputs.networkConversionSpecies]}–尺度曲线` : "Levenspiel 图"}</h3><span>目标 X={inputs.targetX}</span></header>
          {isPressure || isMultiple
            ? <LineChart series={results.map((item, index) => ({ name: labels[index], color: index === 0 ? "#660874" : "#b65315", values: item.points.map(point => ({ x: displayResultScale(item, point.s), y: point.x })) }))} xLabel={isPressure ? "催化剂质量 W / kg_cat" : `反应器体积 V / ${volumeUnit(inputs)}`} yLabel="转化率 X / —" yDomain={[0, 1]} />
            : <LineChart series={[
                { name: "PFR 积分面积", color: "#660874", fill: "rgba(102,8,116,.12)", values: lev },
                { name: "CSTR 矩形面积", color: "#b65315", fill: "rgba(182,83,21,.10)", values: [{ x: 0, y: lev[lev.length - 1].y }, { x: inputs.targetX, y: lev[lev.length - 1].y }] },
              ]} xLabel="转化率 X / —" yLabel="F_L0/(−r_L) / L" />}
        </div>
        <div className="compare-note"><b>结论必须带条件</b><p>{isPressure ? "压力下降会降低反应物分压与速率，因此达到同一目标转化率通常需要更多催化剂；差异大小取决于 α、各反应物级数、温度和气相膨胀。" : "当前幂律模型中反应物状态量沿程下降，PFR 可利用入口较高的反应物状态。若速率随 X 上升或有复杂温度效应，体积排序可能改变。"}</p></div>
      </div>
      <details className="evidence"><summary>查看本次计算依据与假设</summary><div className="evidence-grid">{results[0].equations.map(row => <article key={row.name}><b>{row.name}</b><MathFormula latex={row.expression} display /><small><MathFormula latex={row.substitution} /></small></article>)}</div></details>
    </>
  );
}

function Evidence({ result }: { result: Result }) {
  return <details className="evidence"><summary>查看本次计算依据、代入值与假设</summary><div className="evidence-grid">{result.equations.map(row => <article key={row.name}><b>{row.name}</b><MathFormula latex={row.expression} display /><small><MathFormula latex={row.substitution} /></small></article>)}</div><div className="assumptions"><b>关键假设</b>{result.assumptions.map(item => <span key={item}>{item}</span>)}</div></details>;
}

function Announcements() {
  return <main className="content-page"><p className="kicker">公告</p><h1>当前版本与课堂通知</h1><article className="announcement"><span>版本能力</span><time>2026-08-20</time><h2>V1.6 案例工作流版</h2><p>新增弹窗式组分、反应、物流、反应器与计算规格配置；反应按需添加，高级数值选项默认折叠。</p></article><article className="announcement muted"><span>教师通知</span><h2>通知内容由教师在后续版本配置</h2><p>当前页面保留公告结构，但不预置虚构作业或截止日期。</p></article></main>;
}

function FormulaPage({ query, setQuery }: { query: string; setQuery: (value: string) => void }) {
  const rows = formulaRows.filter(row => row.join("").toLowerCase().includes(query.toLowerCase()));
  return <main className="content-page"><p className="kicker">公式与符号</p><h1>计算依据速查</h1><p className="page-lead">这里用于核对模型，不承担完整课程讲解。计算完成后，结果页只展示本次实际使用的方程。</p><label className="formula-search">⌕<input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索多反应、选择性、PFR…" /></label><div className="formula-table">{rows.map(row => <article key={row[0]}><b>{row[0]}</b><MathFormula latex={row[1]} display /><small>{row[2]}</small></article>)}</div><section className="symbols"><h2>常用符号</h2><div>{[["X_{L}","观察组分 L 的净消耗转化率","—"],["R_j","物种 j 在全部反应中的净生成速率","一致单位"],["\\nu_{mj}","反应 m 中物种 j 的带符号计量数","—"],["\\widetilde S_{B/C}","B 相对于 C 的总选择性","—"],["Y_B","以入口观察组分为基准的 B 总收率","—"],["C_j","液相组分 j 的浓度","mol·L⁻¹"],["P_j","气相组分 j 的分压","bar"],["C_{P,j}","组分 j 的定压摩尔热容","J·mol⁻¹·K⁻¹"],["\\Delta H_R","反应焓；负值表示放热","J·mol_rxn⁻¹"],["U","总传热系数","W·m⁻²·K⁻¹"],["a","单位反应器体积的换热面积","m²·L⁻¹"],["V","反应器体积","L"],["W","催化剂质量","kg_cat"],["\\tau","空间时间","s"]].map(item => <span key={item[0]}><b><MathFormula latex={item[0]} /></b>{item[1]}<small>{item[2]}</small></span>)}</div></section></main>;
}

function Cases() {
  return <main className="content-page empty-page"><p className="kicker">案例</p><h1>案例功能将在后续版本开放</h1><p>V1.6 已统一案例配置结构；课件例题可在后续直接保存为组分—反应—物流—设备案例。</p><div className="tag-cloud">{["动态反应集合","选择性 / 收率","BR / CSTR / PFR / PBR","恒温 / 非恒温","液相 / 理想气体"].map(tag => <span key={tag}>{tag}</span>)}</div></main>;
}

function Help() {
  return <main className="content-page"><p className="kicker">使用说明</p><h1>四步完成一次计算</h1><div className="help-grid">{[["01","定义组分","选择统一相态，按需填写实际名称、分子式与惰性标记。"],["02","添加反应","逐条选择参与组分、计量系数、动力学、可逆性和反应热。"],["03","配置物流与设备","点击流程节点编辑入口组成、操作条件和计算规格。"],["04","核对结果","确认概览后运行，核对出口组成、速率及已启用的附加结果。"]].map(item => <article key={item[0]}><b>{item[0]}</b><h2>{item[1]}</h2><p>{item[2]}</p></article>)}</div><section className="limits"><h2>当前模型边界</h2><ul><li>动态反应集合支持最多 8 个组分和 8 条反应，不需要预先填写数量。</li><li>所有反应组分采用统一相态；气相默认理想气体。</li><li>当前流程为单入口—单反应器—单出口，自由反应器组合尚未开放。</li><li>多反应非恒温 CSTR、半间歇和膜反应器仍留待后续版本。</li></ul></section></main>;
}

function Footer() {
  return <footer><div><span>RE</span><p><b>反应工程智能求解器</b><small>仅在 localhost 运行 · V1.6</small></p></div><p>计算正确 · 图形可用 · 依据可查<br />不替代教师讲解与工程设计审查</p></footer>;
}

function runLabel(reactor: Reactor, task: TaskId) {
  if (task === "compare" || task === "pressureCompare") return "生成对比";
  if (task === "size" || task === "spaceTime") return "计算出口转化率";
  if (reactor === "BR") return "计算所需时间";
  if (reactor === "PBR") return "计算催化剂质量";
  return "计算反应器体积";
}

function summarySentence(inputs: Inputs, task: TaskId, tau: number) {
  const phase = inputs.phase === "liquid" ? "液相浓度基准" : "气相分压基准";
  const limiting = limitingAnalysis(inputs).symbols.join("、") || "待判定组分";
  const reaction = `${inputs.networkReactionCount} 条用户定义反应${inputs.networkReversible.some(Boolean) ? "（含可逆步骤）" : ""}`;
  const basis = inputs.reactionMode === "multiple" ? `以 ${networkSpeciesSymbols(inputs)[inputs.networkConversionSpecies]} 的净消耗为转化率观察基准` : `以 ${limiting} 为限制基准`;
  const base = `${inputs.isothermal ? "恒温" : "稳态非恒温"}、${inputs.pressureDrop ? "变压" : "恒压"} ${phase}、${reaction}，${basis}，在 ${inputs.reactor} 中`;
  if (task === "size") return `${base}由已知尺度反求出口转化率。`;
  if (task === "spaceTime") return `${base}由空间时间 τ=${format(timeFromSI(tau, inputs))} ${inputs.timeUnit} 求出口转化率。`;
  if (task === "compare") return `同一组进料与动力学，在 CSTR 和 PFR 中达到 X=${inputs.targetX} 的体积对比。`;
  if (task === "pressureCompare") return `${base}比较达到 X=${inputs.targetX} 时忽略与考虑压降的结果。`;
  return `${base}由目标 X=${inputs.targetX} 求设计尺度。`;
}

function downloadCalculationLog(inputs: Inputs, task: TaskId, result: Result | null, comparison: Result[] | null) {
  const symbols = networkSpeciesSymbols(inputs);
  const equations = networkReactionLatexes(inputs).map(equation => equation.replaceAll("\\rightarrow", "→").replaceAll("\\rightleftharpoons", "⇌"));
  const displayScale = (item: Result) => item.reactor === "BR" ? timeFromSI(item.scale, inputs) : item.reactor === "PBR" ? item.scale : volumeFromLitres(item.scale, inputs);
  const displayScaleUnit = (item: Result) => item.reactor === "BR" ? inputs.timeUnit : item.reactor === "PBR" ? "kg_cat" : volumeUnit(inputs);
  const lines = [
    "反应工程计算日志",
    `生成时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    "【单位基准】",
    `时间：${inputs.timeUnit}    能量：${inputs.energyUnit}    压力：${inputs.pressureUnit}    长度：${inputs.lengthUnit}`,
    `浓度/分压：${activityUnit(inputs)}    速率：${rateUnit(inputs)}`,
    "",
    "【计算输入】",
    `计算任务：${task}`,
    `反应器：${inputs.reactor}    相态：${inputs.phase === "liquid" ? "液相（恒密度）" : "气相（理想气体）"}`,
    `温度：${format(inputs.temperature)} K    温度条件：${inputs.isothermal ? "恒温" : "非恒温"}`,
    `压力条件：${inputs.pressureDrop ? "考虑压降" : "恒压"}`,
    `入口基准摩尔流率：${format(flowFromCanonical(inputs.fa0, inputs))} mol·${inputs.timeUnit}⁻¹`,
    `入口组成：${symbols.map((symbol, index) => `${symbol}=${format(activityFromCanonical(inputs.networkFeed[index], inputs))} ${activityUnit(inputs)}`).join("；")}`,
    `转化率基准：${symbols[inputs.networkConversionSpecies]}    目标转化率：${format(inputs.targetX)}`,
    ...equations.flatMap((equation, index) => {
      const order = inputs.networkOrdersBySpecies[index].reduce((sum, value) => sum + value, 0);
      return [`反应 R${index + 1}：${equation}`, `  k_ref=${format(rateConstantFromCanonical(inputs.networkRateConstants[index], order, inputs))}；E=${format(energyFromSI(inputs.networkActivationEnergies[index], inputs))} ${inputs.energyUnit}·mol⁻¹；ΔH_ref=${format(energyFromSI(inputs.networkHeatOfReactions[index], inputs))} ${inputs.energyUnit}·mol_rxn⁻¹`];
    }),
    "",
    "【计算输出】",
  ];
  const output = (item: Result) => [
    `${item.reactor}：${item.primaryLabel} = ${item.primaryUnit === "—" ? format(item.primaryValue) : `${format(displayScale(item))} ${displayScaleUnit(item)}`}`,
    `出口转化率：${format(item.outletX * 100)} %`,
    `出口${inputs.phase === "gas" ? "分压" : "浓度"}：${format(activityFromCanonical(item.outletState, inputs))} ${activityUnit(inputs)}`,
    `出口反应速率：${format(rateFromCanonical(item.outletRate, inputs))} ${rateUnit(inputs)}`,
    `出口温度：${format(item.outletTemperature)} K`,
    `求解方法：${item.method}`,
    `出口组成：${item.outletComponents.map(component => `${component.symbol}=${format(activityFromCanonical(component.outlet, inputs))}`).join("；")} ${activityUnit(inputs)}`,
    ...(item.warnings.length ? [`提示：${item.warnings.join("；")}`] : []),
  ];
  (comparison ?? (result ? [result] : [])).forEach((item, index) => lines.push(...(comparison ? [`--- 结果 ${index + 1} ---`] : []), ...output(item)));
  const blob = new Blob([`\ufeff${lines.join("\r\n")}`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `反应工程计算日志-${new Date().toISOString().slice(0, 10)}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}
