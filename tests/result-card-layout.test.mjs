import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const chartSource = await readFile(new URL("../src/components/LineChart.tsx", import.meta.url), "utf8");
const workflowSource = await readFile(new URL("../src/components/CaseWorkflow.tsx", import.meta.url), "utf8");

test("result values share one responsive card layout and one numeric scale", () => {
  assert.match(styles, /\.answer-grid \{[^}]*repeat\(auto-fit, minmax\(240px, 1fr\)\)/);
  assert.match(styles, /\.answer-grid article > strong \{[^}]*font: 36px\/1 Georgia/);
  assert.doesNotMatch(styles, /\.answer-grid \.primary-answer > strong/);
  assert.doesNotMatch(styles, /grid-row:\s*span/);
});

test("valid results do not repeat a redundant status row", () => {
  assert.doesNotMatch(appSource, /计算状态：有效/);
});

test("temperature profiles use a local y-domain and include ambient temperature", () => {
  assert.match(chartSource, /includeZero = true/);
  assert.match(chartSource, /includeZero \? Math\.min\(0, rawMinY\)/);
  assert.match(appSource, /includeZero=\{false\}/);
  assert.match(appSource, /name: "环境温度"/);
});

test("distributed reactors expose molar-flow and equilibrium profiles against volume", () => {
  assert.match(appSource, /各组分摩尔流率分布/);
  assert.match(appSource, /inputs\.inertConcentration > 0 \? \["I"\] : \[\]/);
  assert.match(appSource, /床层体积 V_b \/ \$\{volumeUnit\(inputs\)\}/);
  assert.match(appSource, /实际转化率与平衡转化率/);
});

test("net species rates show a zero reference line and leave room for negative tick labels", () => {
  assert.match(appSource, /<LineChart showZeroLine series=.*point\.netRates/s);
  assert.match(chartSource, /showZeroLine && chart\.minY < 0 && chart\.maxY > 0/);
  assert.match(chartSource, /const PAD = \{ left: 92,/);
});

test("every conversion plot uses the physical zero-to-one y-domain", () => {
  const conversionCharts = appSource.match(/yLabel="[^"]*转化率[^"]*"[^>]*\/?>/g) ?? [];
  assert.ok(conversionCharts.length >= 4);
  assert.ok(conversionCharts.every(chart => /yDomain=\{\[0, 1\]\}/.test(chart)));
});

test("reversible reactions expose equilibrium conversion over T0 plus or minus 100 K", () => {
  assert.match(appSource, /inputs\.temperature - 100/);
  assert.match(appSource, /inputs\.temperature \+ 100/);
  assert.match(appSource, /平衡转化率—温度关系/);
  assert.match(appSource, /equilibriumConversion\(temperature, 1, inputs\)/);
});

test("charts select only nearby computed points and show a coordinate datatip", () => {
  assert.match(chartSource, /onClick=\{selectNearestPoint\}/);
  assert.match(chartSource, /best\.distance <= 12/);
  assert.match(chartSource, /chart-datatip/);
  assert.match(chartSource, /selectedSeries\.name/);
  assert.match(chartSource, /X: \{format\(selectedPoint\.x\)\}/);
  assert.match(chartSource, /Y: \{format\(selectedPoint\.y\)\}/);
});

test("V1.6 UI uses modal case objects instead of preset network counts", () => {
  assert.match(workflowSource, /单位基准/);
  assert.match(workflowSource, /组分与相态/);
  assert.match(workflowSource, /添加反应/);
  assert.match(workflowSource, /入口物流 FEED/);
  assert.match(workflowSource, /反应器 R-101/);
  assert.match(workflowSource, /计算规格/);
  assert.match(workflowSource, /sectionStatus\(readiness\.sections\.specification, calculationOption\)/);
  assert.doesNotMatch(workflowSource, /一个未知量/);
  assert.match(workflowSource, /高级选项/);
  assert.match(workflowSource, /保存并更新概览/);
  assert.doesNotMatch(workflowSource, /平行模板|串联模板|独立反应数/);
  assert.match(appSource, /result\.multiple\?\.selectivityEnabled/);
  assert.match(appSource, /瞬时选择性分布/);
  assert.match(workflowSource, /计算选择性与目标产物收率/);
  assert.match(workflowSource, /目标产物 D/);
  assert.match(workflowSource, /非目标产物 U/);
  assert.match(appSource, /各反应净速率/);
  assert.match(workflowSource, /转化率基准组分/);
  assert.match(workflowSource, /分子式守恒核查/);
  assert.match(workflowSource, /隐式刚性/);
});

test("workflow sequence numbers use stable tabular badges", () => {
  assert.match(workflowSource, /className="setup-index index-badge sequence-number"/);
  assert.match(appSource, /className="index-badge sequence-number"/);
  assert.match(styles, /\.sequence-number \{[^}]*font-variant-numeric: lining-nums tabular-nums/);
  assert.match(styles, /\.index-badge \{[^}]*width: 30px; height: 30px; flex: 0 0 30px/);
  assert.match(styles, /\.flowline \.index-badge \{ margin-bottom: 8px; \}/);
  assert.doesNotMatch(styles, /\.flowline b \{[^}]*Georgia/);
  assert.match(styles, /\.workflow-steps > div \{ min-width: 0; flex: 1; justify-content: center;/);
  assert.doesNotMatch(styles, /\.setup-card > header > div > span \{[^}]*Georgia/);
});
