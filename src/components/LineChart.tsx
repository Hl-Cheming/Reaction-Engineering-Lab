import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { format } from "../core/models";
import { MathFormula } from "./MathFormula";

export type ChartSeries = {
  name: string;
  legendLatex?: string;
  color: string;
  fill?: string;
  values: Array<{ x: number; y: number }>;
};

type SelectedPoint = {
  seriesIndex: number;
  pointIndex: number;
};

const HEIGHT = 320;
const PAD = { left: 92, right: 24, top: 28, bottom: 54 };

function geometry(width: number, series: ChartSeries[], target: { x: number; y: number } | undefined, includeZero: boolean, xDomain?: [number, number], yDomain?: [number, number]) {
  const values = series.flatMap(item => item.values).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  const rawX = [...values.map(item => item.x), ...(target ? [target.x] : [])];
  const rawY = [...values.map(item => item.y), ...(target ? [target.y] : [])];
  const dataMinX = Math.min(...rawX);
  const dataMaxX = Math.max(...rawX);
  const minX = xDomain?.[0] ?? Math.min(0, dataMinX);
  const maxX = xDomain?.[1] ?? Math.max(dataMaxX, minX + 1e-9);
  const rawMinY = Math.min(...rawY);
  const rawMaxY = Math.max(...rawY);
  const spanY = Math.max(rawMaxY - rawMinY, Math.abs(rawMaxY) * 0.04, 1e-9);
  const minY = yDomain?.[0] ?? (includeZero ? Math.min(0, rawMinY) : rawMinY - spanY * 0.12);
  const maxY = yDomain?.[1] ?? (rawMaxY + spanY * 0.12);
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const px = (value: number) => PAD.left + (value - minX) / (maxX - minX) * plotWidth;
  const py = (value: number) => HEIGHT - PAD.bottom - (value - minY) / (maxY - minY) * plotHeight;
  return { minX, maxX, minY, maxY, px, py };
}

export function LineChart({ series, xLabel, yLabel, target, includeZero = true, showZeroLine = false, xDomain, yDomain }: {
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  target?: { x: number; y: number; label: string };
  includeZero?: boolean;
  showZeroLine?: boolean;
  xDomain?: [number, number];
  yDomain?: [number, number];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<SelectedPoint | null>(null);
  const [resizeVersion, setResizeVersion] = useState(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setResizeVersion(version => version + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (selected && !series[selected.seriesIndex]?.values[selected.pointIndex]) setSelected(null);
  }, [series, selected]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || series.length === 0) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * ratio;
    canvas.height = HEIGHT * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const chart = geometry(width, series, target, includeZero, xDomain, yDomain);
    ctx.clearRect(0, 0, width, HEIGHT);
    ctx.font = "12px system-ui";
    ctx.lineWidth = 1;
    for (let n = 0; n <= 4; n++) {
      const yValue = chart.minY + (chart.maxY - chart.minY) * n / 4;
      const xValue = chart.minX + (chart.maxX - chart.minX) * n / 4;
      ctx.strokeStyle = "#e6e0e8";
      ctx.beginPath();
      ctx.moveTo(PAD.left, chart.py(yValue));
      ctx.lineTo(width - PAD.right, chart.py(yValue));
      ctx.stroke();
      ctx.fillStyle = "#756d79";
      ctx.textAlign = "right";
      ctx.fillText(format(yValue), PAD.left - 10, chart.py(yValue) + 4);
      ctx.textAlign = n === 0 ? "left" : n === 4 ? "right" : "center";
      ctx.fillText(format(xValue), chart.px(xValue), HEIGHT - PAD.bottom + 18);
    }
    if (showZeroLine && chart.minY < 0 && chart.maxY > 0) {
      ctx.save();
      ctx.strokeStyle = "#918696";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD.left, chart.py(0));
      ctx.lineTo(width - PAD.right, chart.py(0));
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = "#39323b";
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top);
    ctx.lineTo(PAD.left, HEIGHT - PAD.bottom);
    ctx.lineTo(width - PAD.right, HEIGHT - PAD.bottom);
    ctx.stroke();
    series.forEach(item => {
      if (item.fill && item.values.length > 1) {
        ctx.fillStyle = item.fill;
        ctx.beginPath();
        ctx.moveTo(chart.px(item.values[0].x), chart.py(chart.minY));
        item.values.forEach(point => ctx.lineTo(chart.px(point.x), chart.py(point.y)));
        ctx.lineTo(chart.px(item.values[item.values.length - 1].x), chart.py(chart.minY));
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      item.values.forEach((point, index) => index === 0 ? ctx.moveTo(chart.px(point.x), chart.py(point.y)) : ctx.lineTo(chart.px(point.x), chart.py(point.y)));
      ctx.stroke();
    });
    if (target) {
      ctx.fillStyle = "#b65315";
      ctx.beginPath();
      ctx.arc(chart.px(target.x), chart.py(target.y), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "700 11px system-ui";
      ctx.textAlign = "right";
      ctx.fillText(target.label, chart.px(target.x) - 8, chart.py(target.y) - 8);
    }
    if (selected) {
      const point = series[selected.seriesIndex]?.values[selected.pointIndex];
      if (point) {
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = series[selected.seriesIndex].color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(chart.px(point.x), chart.py(point.y), 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#514a54";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(xLabel, PAD.left + (width - PAD.left - PAD.right) / 2, HEIGHT - 7);
    ctx.save();
    ctx.translate(17, PAD.top + (HEIGHT - PAD.top - PAD.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }, [series, target, xLabel, yLabel, includeZero, showZeroLine, xDomain, yDomain, selected, resizeVersion]);

  const selectNearestPoint = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = (event.clientX - rect.left) * canvas.clientWidth / rect.width;
    const clickY = (event.clientY - rect.top) * HEIGHT / rect.height;
    const chart = geometry(canvas.clientWidth, series, target, includeZero, xDomain, yDomain);
    let best: { distance: number; seriesIndex: number; pointIndex: number } | null = null;
    for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
      for (let pointIndex = 0; pointIndex < series[seriesIndex].values.length; pointIndex++) {
        const point = series[seriesIndex].values[pointIndex];
        const distance = Math.hypot(chart.px(point.x) - clickX, chart.py(point.y) - clickY);
        if (!best || distance < best.distance) best = { distance, seriesIndex, pointIndex };
      }
    }
    setSelected(best && best.distance <= 12 ? { seriesIndex: best.seriesIndex, pointIndex: best.pointIndex } : null);
  };

  const selectedSeries = selected ? series[selected.seriesIndex] : null;
  const selectedPoint = selectedSeries && selected ? selectedSeries.values[selected.pointIndex] : null;
  const tooltipPosition = (() => {
    const canvas = ref.current;
    if (!canvas || !selectedPoint) return null;
    const chart = geometry(canvas.clientWidth, series, target, includeZero, xDomain, yDomain);
    const x = chart.px(selectedPoint.x);
    const y = chart.py(selectedPoint.y);
    return { left: x, top: y, transform: `translate(${x > canvas.clientWidth * 0.68 ? "calc(-100% - 12px)" : "12px"}, ${y < 92 ? "12px" : "calc(-100% - 12px)"})` };
  })();

  return (
    <div className="chart">
      <div className="chart-plot">
        <canvas ref={ref} role="img" tabIndex={0} aria-label={`${yLabel} 随 ${xLabel} 的变化曲线；点击实际数据点可查看坐标`} onClick={selectNearestPoint} onKeyDown={event => { if (event.key === "Escape") setSelected(null); }} />
        {selectedSeries && selectedPoint && tooltipPosition && <div className="chart-datatip" style={tooltipPosition} role="status" aria-live="polite"><b>{selectedSeries.name}</b><span>X: {format(selectedPoint.x)}</span><span>Y: {format(selectedPoint.y)}</span></div>}
      </div>
      <div className="chart-legend">{series.map(item => <span key={item.name}><i style={{ background: item.color }} />{item.legendLatex ? <MathFormula latex={item.legendLatex} /> : item.name}</span>)}</div>
    </div>
  );
}
