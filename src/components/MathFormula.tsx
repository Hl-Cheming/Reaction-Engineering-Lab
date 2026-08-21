import katex from "katex";

export function MathFormula({ latex, display = false, className = "" }: {
  latex: string;
  display?: boolean;
  className?: string;
}) {
  const html = katex.renderToString(latex, {
    displayMode: display,
    throwOnError: false,
    strict: "warn",
    trust: false,
  });

  return <span className={`math-formula ${display ? "math-display" : "math-inline"} ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
