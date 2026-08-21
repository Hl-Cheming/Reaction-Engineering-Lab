import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import katex from "katex";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const modelSource = await readFile(new URL("../src/core/models.ts", import.meta.url), "utf8");
const workflowSource = await readFile(new URL("../src/components/CaseWorkflow.tsx", import.meta.url), "utf8");

test("reaction commands render as operators instead of command text", () => {
  const html = katex.renderToString(String.raw`A\rightarrow\mathrm{Products}`);

  assert.match(html, /<mo[^>]*>→<\/mo>/);
  assert.match(html, /mathvariant="normal">P<\/mi>/);
  assert.doesNotMatch(html, />rightarrow</);
  assert.doesNotMatch(html, />mathrm</);
});

test("field symbols use KaTeX subscripts", () => {
  const html = katex.renderToString(String.raw`k_{\mathrm{ref}}`);

  assert.match(html, /<msub>/);
  assert.match(html, /mathvariant="normal">r<\/mi>/);
  assert.match(workflowSource, /<MathFormula latex=\{symbol\} className="field-symbol" \/>/);
  assert.doesNotMatch(workflowSource, /<i>\{symbol\}<\/i>/);
});

test("JSX LaTeX literals cannot reintroduce doubled command slashes", () => {
  assert.doesNotMatch(appSource, /latex="[^"]*\\\\[A-Za-z]/);
  assert.doesNotMatch(appSource, /String\.raw`[^`]*\\\\[A-Za-z]/);
  assert.doesNotMatch(workflowSource, /latex="[^"]*\\\\[A-Za-z]/);
  assert.doesNotMatch(workflowSource, /String\.raw`[^`]*\\\\[A-Za-z]/);
});

test("design integrals place limits above and below the integral sign", () => {
  assert.match(appSource, /\\\\int\\\\limits_\{0\}\^\{X\}/);
  assert.match(modelSource, /\\\\int\\\\limits_\{0\}\^\{X\}/);
  assert.doesNotMatch(appSource, /\\\\int_0\^X/);
  assert.doesNotMatch(modelSource, /\\\\int_0\^X/);
});

test("multi-character math subscripts are always grouped", () => {
  assert.doesNotMatch(appSource, /X_(?:out|in|target)\b/);
  assert.doesNotMatch(modelSource, /X_(?:out|in|target)\b/);
  assert.match(workflowSource, /X_\{\\mathrm\{target\}\}/);
  assert.match(appSource, /X_\{\\\\mathrm\{out\}\}/);
});

test("V1.2 thermodynamic symbols render grouped roman subscripts", () => {
  assert.match(workflowSource, /String\.raw`\\Delta H_\{\\mathrm\{ref\}\}`/);
  assert.match(workflowSource, /String\.raw`T_\{\\mathrm\{ref\}\}`/);
  assert.doesNotMatch(appSource, /_\{mathrm\{/);
});

test("the input form synchronizes elementary reaction orders with stoichiometry", () => {
  assert.match(workflowSource, /if \(next\.networkElementary\[index\]\)/);
  assert.match(workflowSource, /next\.networkOrdersBySpecies\[index\]\[species\]/);
  assert.doesNotMatch(appSource, /总反应级数/);
});

test("species count fields preserve an empty editing transition", () => {
  assert.doesNotMatch(workflowSource, /网络物种数|独立反应数/);
  assert.match(workflowSource, /event\.target\.value !== ""/);
  assert.match(workflowSource, /setText\(event\.target\.value\)/);
});

test("V1.2 condition hierarchy exposes phase, temperature and PBR pressure choices", () => {
  assert.match(workflowSource, /反应相态/);
  assert.match(workflowSource, /温度条件/);
  assert.match(workflowSource, /非恒温/);
  assert.match(workflowSource, /压力条件/);
  assert.match(workflowSource, /考虑压降/);
  assert.match(workflowSource, /反应方向/);
  assert.match(workflowSource, /可逆/);
});

test("gas feed and kinetics are presented on a partial-pressure basis", () => {
  assert.match(appSource, /气相幂律/);
  assert.match(appSource, /P_j\^\{n_j\}/);
  assert.match(workflowSource, /入口分压/);
  assert.match(appSource, /气相分压基准/);
});
