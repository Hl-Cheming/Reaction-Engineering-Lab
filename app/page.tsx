"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChart } from "@/components/LineChart";
import {
  calculate,
  compareReactors,
  defaults,
  levenspiel,
  type Inputs,
  type Reactor,
  type Result,
} from "@/lib/models";

const reactors: Array<{ id: Reactor; name: string; short: string; detail: string }> = [
  { id: "BR", name: "分批反应器", short: "时间历程", detail: "闭系 · 非稳态 · 全混" },
  { id: "CSTR", name: "连续搅拌釜", short: "出口控制", detail: "开系 · 稳态 · 全混" },
  { id: "PFR", name: "平推流反应器", short: "轴向梯度", detail: "开系 · 稳态 · 无返混" },
  { id: "PBR", name: "填充床反应器", short: "催化床层", detail: "气固催化 · 压力降" },
];

const formulas = [
  { tag: "通用", title: "稳态摩尔衡算", formula: "Fⱼ₀ − Fⱼ + ∫ rⱼ dV = 0", note: "稳态、无累积；BR 需保留累积项。" },
  { tag: "动力学", title: "幂律速率", formula: "−r_A = k C_Aⁿ", note: "非基元反应的 n 由实验给出，不由计量数推断。" },
  { tag: "动力学", title: "Arrhenius 方程", formula: "k(T) = A exp(−E/RT)", note: "也可由参考温度下 k_ref 换算。" },
  { tag: "计量", title: "液相恒密度", formula: "C_A = C_A0(1 − X)", note: "恒温、恒密度、单一反应。" },
  { tag: "计量", title: "气相变容", formula: "C_A = C_A0 (1−X)/(1+εX) · P/P₀ · T₀/T", note: "必须满足 1+εX > 0。" },
  { tag: "BR", title: "分批设计式", formula: "t = C_A0 ∫₀ˣ dX/(−r_A)", note: "恒容时适用。" },
  { tag: "CSTR", title: "全混釜设计式", formula: "V = F_A0(X_out−X_in)/(−r_A)_out", note: "全釜按出口条件计算速率。" },
  { tag: "PFR", title: "平推流设计式", formula: "V = F_A0 ∫₀ˣ dX/(−r_A)", note: "稳态、无轴向返混。" },
  { tag: "PBR", title: "填充床设计式", formula: "W = F_A0 ∫₀ˣ dX/(−r′_A)", note: "速率基准必须是 kg_cat。" },
  { tag: "PBR", title: "简化压力降", formula: "p = √(1 − αW)", note: "等温、无总摩尔膨胀的简化关系。" },
];

export default function Home() {
  const [inputs, setInputs] = useState<Inputs>(defaults);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState("lab");
  const [formulaQuery, setFormulaQuery] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("reaction-lab-inputs");
    if (saved) {
      try { setInputs({ ...defaults, ...JSON.parse(saved) }); } catch { /* Ignore corrupted local state. */ }
    }
  }, []);

  const update = <K extends keyof Inputs>(key: K, value: Inputs[K]) => {
    setInputs(old => {
      const next = { ...old, [key]: value };
      localStorage.setItem("reaction-lab-inputs", JSON.stringify(next));
      return next;
    });
    setResult(null);
    setError("");
  };

  const run = () => {
    try {
      setResult(calculate(inputs));
      setError("");
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "计算失败，请检查输入。");
    }
  };

  const chartSeries = useMemo(() => result ? [
    { name: "转化率 X", color: "#660874", values: result.points.map(p => ({ x: p.s, y: p.x })) },
  ] : [], [result]);

  const scrollTo = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => scrollTo("home")} aria-label="返回首页">
          <span className="brand-mark">RE</span>
          <span><strong>反应工程实验室</strong><small>Reaction Engineering Lab</small></span>
        </button>
        <nav aria-label="主导航">
          {[
            ["home", "学习地图"],
            ["lab", "计算实验室"],
            ["compare", "反应器对比"],
            ["theory", "理论与公式"],
          ].map(([id, label]) => (
            <button key={id} className={active === id ? "active" : ""} onClick={() => scrollTo(id)}>{label}</button>
          ))}
        </nav>
        <span className="scope">P0 + P1 核心模型</span>
      </header>

      <section id="home" className="hero">
        <div className="hero-copy">
          <p className="eyebrow">从方程到工程判断</p>
          <h1>不只算出一个数字，<br /><em>看懂反应器为何这样工作。</em></h1>
          <p className="lead">把摩尔衡算、动力学与计量关系连成一条可操作的学习路径。选择模型、输入条件、查看曲线，然后对结果作出工程判断。</p>
          <div className="hero-actions">
            <button className="primary" onClick={() => scrollTo("lab")}>开始一个示例 <span>→</span></button>
            <button className="secondary" onClick={() => scrollTo("theory")}>先复习核心公式</button>
          </div>
          <div className="method-strip" aria-label="计算流程">
            {["选择问题", "输入条件", "建立方程", "数值求解", "图形解释", "工程判断"].map((step, i) => (
              <span key={step}><b>{String(i + 1).padStart(2, "0")}</b>{step}</span>
            ))}
          </div>
        </div>
        <aside className="hero-panel">
          <p>本页当前支持</p>
          <strong>4</strong><span>类理想反应器</span>
          <div className="mini-grid">
            {reactors.map(r => <button key={r.id} onClick={() => { update("reactor", r.id); scrollTo("lab"); }}><b>{r.id}</b>{r.short}</button>)}
          </div>
          <div className="status-line"><i /> 解析解校核 · 输入边界检查 · 可复现计算</div>
        </aside>
      </section>

      <section className="learning-map">
        <div className="section-heading">
          <p className="eyebrow">学习地图</p>
          <h2>一条主线，串起反应工程计算</h2>
          <p>先判断物料如何流动，再选择数学模型；能量与传递修正建立在正确的摩尔衡算之上。</p>
        </div>
        <div className="map-grid">
          {[
            ["01", "摩尔衡算", "定义系统边界与累积、流入、流出、反应项。"],
            ["02", "速率方程", "把温度、浓度与反应速率连接起来。"],
            ["03", "计量关系", "用转化率 X 表示各组分浓度或流率。"],
            ["04", "反应器设计", "由目标 X 求时间、体积或催化剂质量。"],
            ["05", "工程修正", "加入温度、压力降与内外扩散的影响。"],
          ].map((item, i) => (
            <article key={item[0]} className={i < 4 ? "ready" : "future"}>
              <b>{item[0]}</b><h3>{item[1]}</h3><p>{item[2]}</p><span>{i < 4 ? "本版可用" : "后续扩展"}</span>
            </article>
          ))}
        </div>
      </section>

      <section id="lab" className="lab-section">
        <div className="section-heading light">
          <p className="eyebrow">交互计算实验室</p>
          <h2>选择你的反应器</h2>
          <p>默认案例：等温、液相恒密度、单一不可逆幂律反应。</p>
        </div>
        <div className="reactor-tabs">
          {reactors.map(r => (
            <button key={r.id} className={inputs.reactor === r.id ? "selected" : ""} onClick={() => update("reactor", r.id)}>
              <b>{r.id}</b><span>{r.name}<small>{r.detail}</small></span>
            </button>
          ))}
        </div>
        <div className="workbench">
          <div className="input-panel">
            <div className="panel-title"><span>01</span><div><h3>条件与参数</h3><p>单位在当前模型内保持一致</p></div></div>
            <div className="segmented">
              <button className={inputs.solveFor === "target" ? "on" : ""} onClick={() => update("solveFor", "target")}>由目标 X 求尺度</button>
              <button className={inputs.solveFor === "size" ? "on" : ""} onClick={() => update("solveFor", "size")}>由尺度求出口 X</button>
            </div>
            <div className="field-grid">
              <Field label={inputs.solveFor === "target" ? "目标转化率" : "给定尺度"} symbol={inputs.solveFor === "target" ? "X" : inputs.reactor === "BR" ? "t" : inputs.reactor === "PBR" ? "W" : "V"} unit={inputs.solveFor === "target" ? "—" : inputs.reactor === "BR" ? "s" : inputs.reactor === "PBR" ? "kg_cat" : "L"} value={inputs.solveFor === "target" ? inputs.targetX : inputs.size} onChange={v => update(inputs.solveFor === "target" ? "targetX" : "size", v)} />
              <Field label="反应级数" symbol="n" unit="—" value={inputs.order} onChange={v => update("order", v)} step={0.1} />
              <Field label="参考速率常数" symbol="k_ref" unit={inputs.order === 1 ? "s⁻¹" : "一致单位"} value={inputs.kRef} onChange={v => update("kRef", v)} />
              <Field label="入口浓度" symbol="C_A0" unit="mol·L⁻¹" value={inputs.ca0} onChange={v => update("ca0", v)} />
              <Field label="入口摩尔流率" symbol="F_A0" unit="mol·s⁻¹" value={inputs.fa0} onChange={v => update("fa0", v)} />
              <Field label="反应温度" symbol="T" unit="K" value={inputs.temperature} onChange={v => update("temperature", v)} step={1} />
              <Field label="参考温度" symbol="T_ref" unit="K" value={inputs.refTemperature} onChange={v => update("refTemperature", v)} step={1} />
              <Field label="活化能" symbol="E" unit="J·mol⁻¹" value={inputs.activationEnergy} onChange={v => update("activationEnergy", v)} step={1000} />
            </div>
            <div className="option-row">
              <label>相态与计量</label>
              <div className="segmented compact">
                <button className={inputs.phase === "liquid" ? "on" : ""} onClick={() => update("phase", "liquid")}>液相恒密度</button>
                <button className={inputs.phase === "gas" ? "on" : ""} onClick={() => update("phase", "gas")}>气相变容</button>
              </div>
            </div>
            {inputs.phase === "gas" && <Field label="体积膨胀率" symbol="ε" unit="—" value={inputs.epsilon} onChange={v => update("epsilon", v)} step={0.1} />}
            {inputs.reactor === "PBR" && (
              <div className="pressure-box">
                <label><input type="checkbox" checked={inputs.pressureDrop} onChange={e => update("pressureDrop", e.target.checked)} /> 考虑床层压力降</label>
                {inputs.pressureDrop && <Field label="压力降参数" symbol="α" unit="kg_cat⁻¹" value={inputs.alpha} onChange={v => update("alpha", v)} />}
              </div>
            )}
            {error && <div className="error-box" role="alert"><b>输入未通过检查</b>{error}</div>}
            <div className="form-actions">
              <button className="ghost" onClick={() => { setInputs(defaults); setResult(null); localStorage.removeItem("reaction-lab-inputs"); }}>恢复示例</button>
              <button className="calculate" onClick={run}>建立方程并计算 <span>→</span></button>
            </div>
          </div>

          <div className={`result-panel ${result ? "has-result" : ""}`}>
            {!result ? (
              <div className="result-empty">
                <span>Σ</span><h3>结果将在这里展开</h3><p>完成参数检查后，系统会依次显示关键数值、工程结论、变化曲线与模型假设。</p>
                <ul><li>不会输出负浓度或负压力</li><li>接近模型边界时主动警告</li><li>结果可导出为 CSV</li></ul>
              </div>
            ) : (
              <>
                <div className="result-top">
                  <p>计算完成 · {result.reactor}</p>
                  <button onClick={() => downloadCsv(result)}>导出 CSV</button>
                </div>
                <div className="metrics">
                  <article className="major"><span>{result.valueLabel}</span><strong>{fmt(result.value)}</strong><b>{result.unit}</b></article>
                  <article><span>出口转化率</span><strong>{(result.outletX * 100).toFixed(2)}</strong><b>%</b></article>
                  <article><span>出口浓度</span><strong>{fmt(result.outletCa)}</strong><b>mol·L⁻¹</b></article>
                  <article><span>k(T)</span><strong>{fmt(result.k)}</strong><b>{inputs.order === 1 ? "s⁻¹" : "一致单位"}</b></article>
                </div>
                <div className="engineering-tip"><b>工程判断</b><p>{result.conclusion}</p></div>
                {result.warnings.map(w => <div className="warning" key={w}><b>边界提示</b>{w}</div>)}
                <LineChart series={chartSeries} xLabel={inputs.reactor === "BR" ? "时间 t / s" : inputs.reactor === "PBR" ? "催化剂质量 W / kg_cat" : "体积 V / L"} yLabel="转化率 X / —" />
                {inputs.reactor === "PBR" && inputs.pressureDrop && (
                  <LineChart series={[{ name: "压力比 p", color: "#d16b22", values: result.points.map(p => ({ x: p.s, y: p.p })) }]} xLabel="催化剂质量 W / kg_cat" yLabel="压力比 p = P/P₀" />
                )}
                <details open><summary>使用的方程</summary><div className="formula-large">{result.equation}</div></details>
                <details><summary>假设与适用范围</summary><p>单一不可逆反应；等温；{inputs.phase === "liquid" ? "液相恒密度" : "理想气相、体积随转化率变化"}；动力学参数在所选温度范围有效。PBR 速率以催化剂质量为基准。</p></details>
              </>
            )}
          </div>
        </div>
      </section>

      <CompareSection inputs={inputs} onError={setError} />

      <section id="theory" className="theory-section">
        <div className="section-heading">
          <p className="eyebrow">理论学习与公式速查</p>
          <h2>先问“何时适用”，再记公式</h2>
          <p>每条公式同时标注物理含义与使用条件，避免把体积速率和催化剂质量速率混用。</p>
        </div>
        <div className="theory-layout">
          <aside>
            <h3>理想反应器怎么选？</h3>
            {reactors.map(r => <button key={r.id} onClick={() => { update("reactor", r.id); scrollTo("lab"); }}><b>{r.id}</b><span>{r.name}<small>{r.detail}</small></span><i>→</i></button>)}
            <div className="note"><b>常见误区</b><p>不能无条件断言 PFR 体积一定小于 CSTR。只有当反应速率随转化率单调下降时，PFR 才因利用入口高浓度而通常更小。</p></div>
          </aside>
          <div className="formula-library">
            <label className="search"><span>⌕</span><input value={formulaQuery} onChange={e => setFormulaQuery(e.target.value)} placeholder="搜索公式、符号或反应器，例如：PFR、压力降、Arrhenius" /></label>
            <div className="formula-list">
              {formulas.filter(f => `${f.tag}${f.title}${f.formula}${f.note}`.toLowerCase().includes(formulaQuery.toLowerCase())).map(f => (
                <article key={f.title}>
                  <span>{f.tag}</span><div><h3>{f.title}</h3><p className="formula">{f.formula}</p><small>{f.note}</small></div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div><span className="brand-mark">RE</span><p><strong>反应工程实验室</strong><br />面向化学工程学习者的交互式计算工具</p></div>
        <p>模型边界：单一反应 · 理想反应器 · 等温计算<br />结果用于教学与初步估算，不替代工程设计审查。</p>
      </footer>
    </main>
  );
}

function Field({ label, symbol, unit, value, onChange, step = 0.01 }: { label: string; symbol: string; unit: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="field"><span>{label} <i>{symbol}</i></span><div><input type="number" value={value} step={step} onChange={e => onChange(Number(e.target.value))} /><b>{unit}</b></div></label>
  );
}

function CompareSection({ inputs, onError }: { inputs: Inputs; onError: (message: string) => void }) {
  const [results, setResults] = useState<Result[] | null>(null);
  const runCompare = () => {
    try { setResults(compareReactors(inputs)); onError(""); }
    catch (e) { onError(e instanceof Error ? e.message : "对比计算失败。"); }
  };
  const lev = useMemo(() => results ? levenspiel(inputs) : [], [results, inputs]);
  return (
    <section id="compare" className="compare-section">
      <div className="section-heading">
        <p className="eyebrow">反应器横向对比</p>
        <h2>同一反应，在不同流动图景中</h2>
        <p>使用当前进料、动力学和目标转化率，比较所需尺度。BR 的时间、PBR 的催化剂质量与体积不可直接按数值排名。</p>
      </div>
      {!results ? (
        <div className="compare-cta"><div><b>当前目标 X = {(inputs.targetX * 100).toFixed(0)}%</b><p>计算 BR、CSTR、PFR 与 PBR，并生成 Levenspiel 图。</p></div><button onClick={runCompare}>运行对比分析 →</button></div>
      ) : (
        <div className="compare-content">
          <div className="compare-table-wrap"><table><thead><tr><th>模型</th><th>设计尺度</th><th>出口 C_A</th><th>流动特征</th></tr></thead><tbody>
            {results.map(r => <tr key={r.reactor}><td><b>{r.reactor}</b></td><td><strong>{fmt(r.value)}</strong> {r.unit}</td><td>{fmt(r.outletCa)} mol·L⁻¹</td><td>{reactors.find(item => item.id === r.reactor)?.detail}</td></tr>)}
          </tbody></table></div>
          <div className="levenspiel-card"><div><h3>Levenspiel 图</h3><p>曲线下面积为 PFR 体积；终点高度 × X 为单台 CSTR 的矩形面积。</p></div>
            <LineChart series={[{ name: "F_A0/(−r_A)", color: "#660874", values: lev }]} xLabel="转化率 X / —" yLabel="F_A0/(−r_A) / L" />
          </div>
          <div className="compare-insight"><b>条件化结论</b><p>当前幂律反应的速率随 A 浓度下降而减小，因此 PFR 利用入口高浓度，所需体积小于单台 CSTR。若速率随 X 上升、存在自催化或复杂温度效应，这一排序可能反转。</p></div>
        </div>
      )}
    </section>
  );
}

function fmt(value: number) {
  if (Math.abs(value) >= 10000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) return value.toExponential(3);
  return value.toFixed(value < 10 ? 4 : 2);
}

function downloadCsv(result: Result) {
  const rows = ["scale,X,C_A,rate,p", ...result.points.map(p => [p.s, p.x, p.ca, p.rate, p.p].join(","))];
  const blob = new Blob([`\ufeff${rows.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${result.reactor}_result.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
