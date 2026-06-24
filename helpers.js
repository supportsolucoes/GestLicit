import { ALERT_THRESHOLDS } from './constants.js';

export const byId = (id) => document.getElementById(id);
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatNumber(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatDate(value) {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR');
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function toDatetimeLocalValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function alertLevel(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return null;
  if (days < 0) return { level: 'vencido', days, label: 'Vencido' };
  for (const threshold of ALERT_THRESHOLDS) {
    if (days <= threshold) return { level: threshold, days, label: `${days} dia(s)` };
  }
  return null;
}

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function sumBy(list, fn) {
  return (list || []).reduce((acc, item) => acc + (Number(fn(item)) || 0), 0);
}

export function groupBy(list, fn) {
  const map = new Map();
  for (const item of list || []) {
    const key = fn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function calcSaldoAtaItem(item, consumos) {
  const consumido = sumBy(consumos.filter((c) => c.ata_item_id === item.id), (c) => c.quantidade);
  const total = Number(item.quantidade_total) || 0;
  const restante = Math.max(total - consumido, 0);
  const percentual = total > 0 ? Math.min((consumido / total) * 100, 100) : 0;
  return { consumido, restante, percentual };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\./g, '').replace(',', '.')) || Number(value) || 0;
}
