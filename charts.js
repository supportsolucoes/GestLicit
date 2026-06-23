function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.width || 320;
  const height = rect.height || canvas.height || 220;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

export function drawBarChart(canvas, data, { color = '#2563EB', valueFormatter = (v) => v } = {}) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);
  if (!data.length) {
    ctx.fillStyle = '#94A3B8';
    ctx.font = '13px sans-serif';
    ctx.fillText('Sem dados suficientes.', 12, height / 2);
    return;
  }
  const padding = { top: 24, right: 12, bottom: 36, left: 12 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const gap = 14;
  const barW = (chartW - gap * (data.length - 1)) / data.length;

  data.forEach((d, i) => {
    const barH = (d.value / max) * chartH;
    const x = padding.left + i * (barW + gap);
    const y = padding.top + (chartH - barH);
    ctx.fillStyle = d.color || color;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 6);
    ctx.fill();

    ctx.fillStyle = '#334155';
    ctx.font = '11.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(valueFormatter(d.value), x + barW / 2, y - 8);

    ctx.fillStyle = '#64748B';
    ctx.font = '11px sans-serif';
    const label = d.label.length > 12 ? `${d.label.slice(0, 11)}…` : d.label;
    ctx.fillText(label, x + barW / 2, height - 14);
  });
  ctx.textAlign = 'left';
}

export function drawDonutChart(canvas, data, { centerLabel = '' } = {}) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);
  const total = data.reduce((acc, d) => acc + d.value, 0);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 6;
  const innerRadius = radius * 0.62;

  if (!total) {
    ctx.fillStyle = '#94A3B8';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sem dados suficientes.', cx, cy);
    ctx.textAlign = 'left';
    return;
  }

  let start = -Math.PI / 2;
  data.forEach((d) => {
    const slice = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    start += slice;
  });

  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  if (centerLabel) {
    ctx.fillStyle = '#0F172A';
    ctx.font = '700 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(centerLabel, cx, cy);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}
