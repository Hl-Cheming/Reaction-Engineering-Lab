"use client";

import { useEffect, useRef } from "react";

type Series = {
  name: string;
  color: string;
  values: Array<{ x: number; y: number }>;
};

export function LineChart({
  series,
  xLabel,
  yLabel,
}: {
  series: Series[];
  xLabel: string;
  yLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !series.length) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = 300;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const pad = { left: 58, right: 22, top: 22, bottom: 48 };
    const all = series.flatMap(item => item.values);
    const maxX = Math.max(...all.map(p => p.x), 1e-9);
    const maxY = Math.max(...all.map(p => p.y), 1e-9);
    const x = (v: number) => pad.left + (v / maxX) * (width - pad.left - pad.right);
    const y = (v: number) => height - pad.bottom - (v / maxY) * (height - pad.top - pad.bottom);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#e5e0e8";
    ctx.lineWidth = 1;
    ctx.font = "12px system-ui";
    ctx.fillStyle = "#6f6874";
    ctx.textAlign = "right";
    for (let j = 0; j <= 4; j++) {
      const val = maxY * j / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, y(val));
      ctx.lineTo(width - pad.right, y(val));
      ctx.stroke();
      ctx.fillText(format(val), pad.left - 8, y(val) + 4);
    }
    ctx.strokeStyle = "#2d2630";
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, height - pad.bottom);
    ctx.lineTo(width - pad.right, height - pad.bottom);
    ctx.stroke();
    series.forEach(item => {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      item.values.forEach((point, index) => {
        if (index === 0) ctx.moveTo(x(point.x), y(point.y));
        else ctx.lineTo(x(point.x), y(point.y));
      });
      ctx.stroke();
    });
    ctx.fillStyle = "#3e3741";
    ctx.textAlign = "center";
    ctx.fillText(xLabel, pad.left + (width - pad.left - pad.right) / 2, height - 12);
    ctx.save();
    ctx.translate(15, pad.top + (height - pad.top - pad.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }, [series, xLabel, yLabel]);

  return (
    <div className="chart">
      <canvas ref={canvasRef} role="img" aria-label={`${yLabel} 随 ${xLabel} 变化曲线`} />
      <div className="legend">
        {series.map(item => (
          <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>
        ))}
      </div>
    </div>
  );
}

function format(value: number) {
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) return value.toExponential(1);
  return value.toFixed(value < 10 ? 2 : 0);
}
