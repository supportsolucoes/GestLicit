// APIs públicas externas (Receita Federal via BrasilAPI, PNCP, Portal da Transparência).
// Nenhum dado consultado aqui é armazenado no Supabase — é sempre uma consulta ao vivo.

import { getState } from './state.js';

export function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

export async function fetchEmpresaCnpj(cnpjDigits) {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjDigits}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error('CNPJ não encontrado na Receita Federal.');
    throw new Error(`Erro ao consultar CNPJ (HTTP ${res.status}).`);
  }
  return res.json();
}

export async function fetchContratosPncp(cnpjDigits, { maxPaginas = 6, tamPagina = 50 } = {}) {
  const items = [];
  let total = 0;
  for (let pagina = 1; pagina <= maxPaginas; pagina += 1) {
    const url = `https://pncp.gov.br/api/search/?q=${cnpjDigits}&tipos_documento=contrato&ordenacao=-data&pagina=${pagina}&tam_pagina=${tamPagina}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Erro ao consultar o PNCP (HTTP ${res.status}).`);
    const data = await res.json();
    total = data.total ?? total;
    const pageItems = data.items || [];
    items.push(...pageItems);
    if (!pageItems.length || items.length >= total) break;
  }
  return { items, total };
}

function getPortalTransparenciaApiKey() {
  return getState().lookups.settings?.portal_transparencia_api_key || '';
}

async function fetchSancoes(endpoint, cnpjDigits, apiKey) {
  const res = await fetch(`https://api.portaldatransparencia.gov.br/api-de-dados/${endpoint}?codigoSancionado=${cnpjDigits}&pagina=1`, {
    headers: { 'chave-api-dados': apiKey },
  });
  if (!res.ok) throw new Error(`Erro ao consultar ${endpoint.toUpperCase()} (HTTP ${res.status}).`);
  return res.json();
}

export async function fetchCertidoesPortalTransparencia(cnpjDigits) {
  const apiKey = getPortalTransparenciaApiKey();
  if (!apiKey) {
    return { configured: false, ceis: [], cnep: [] };
  }
  const [ceis, cnep] = await Promise.all([
    fetchSancoes('ceis', cnpjDigits, apiKey),
    fetchSancoes('cnep', cnpjDigits, apiKey),
  ]);
  return { configured: true, ceis: Array.isArray(ceis) ? ceis : [], cnep: Array.isArray(cnep) ? cnep : [] };
}
