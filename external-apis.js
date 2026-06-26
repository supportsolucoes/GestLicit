// APIs públicas externas (Receita Federal via BrasilAPI/ReceitaWS, PNCP, Portal da Transparência).
// Nenhum dado consultado aqui é armazenado no Supabase — é sempre uma consulta ao vivo.

import { getState } from './state.js';

export function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

// ─── Receita Federal ─────────────────────────────────────────────────────────
// Tenta BrasilAPI; se falhar (instabilidade), cai para ReceitaWS como fallback.

function normalizeReceitaWS(d) {
  const abertura = d.abertura ? d.abertura.split('/').reverse().join('-') : null;
  const capital = parseFloat((d.capital_social || '0').replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
  return {
    cnpj: d.cnpj,
    razao_social: d.nome,
    nome_fantasia: d.fantasia || '',
    descricao_situacao_cadastral: d.situacao,
    porte: d.porte,
    natureza_juridica: d.natureza_juridica,
    capital_social: capital,
    data_inicio_atividade: abertura,
    opcao_pelo_simples: d.simples?.optante === 'Sim',
    cnae_fiscal_descricao: d.atividade_principal?.[0]?.text,
    cnaes_secundarios: d.atividades_secundarias || [],
    qsa: (d.qsa || []).map((s) => ({ nome_socio: s.nome, qualificacao_socio: s.qual })),
    logradouro: d.logradouro, numero: d.numero, complemento: d.complemento,
    bairro: d.bairro, municipio: d.municipio, uf: d.uf,
    ddd_telefone_1: d.telefone, email: d.email,
    _fonte: 'ReceitaWS',
  };
}

export async function fetchEmpresaCnpj(cnpjDigits) {
  // Fonte primária: BrasilAPI
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjDigits}`);
    if (res.status === 404) throw new Error('CNPJ não encontrado na Receita Federal.');
    if (!res.ok) throw new Error(`BrasilAPI HTTP ${res.status}`);
    return await res.json();
  } catch (errPrimario) {
    // Fallback: ReceitaWS
    try {
      const res2 = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpjDigits}`);
      if (!res2.ok) throw new Error(`ReceitaWS HTTP ${res2.status}`);
      const data = await res2.json();
      if (data.status === 'ERROR') throw new Error(data.message || 'CNPJ não encontrado.');
      return normalizeReceitaWS(data);
    } catch (errFallback) {
      throw new Error(`${errPrimario.message} · fallback: ${errFallback.message}`);
    }
  }
}

// ─── PNCP ────────────────────────────────────────────────────────────────────

async function fetchPncpDocumento(cnpjDigits, tipoDocumento, { maxPaginas = 6, tamPagina = 50 } = {}) {
  const items = [];
  let total = 0;
  for (let pagina = 1; pagina <= maxPaginas; pagina += 1) {
    const url = `https://pncp.gov.br/api/search/?q=${cnpjDigits}&tipos_documento=${tipoDocumento}&ordenacao=-data&pagina=${pagina}&tam_pagina=${tamPagina}`;
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

export async function fetchContratosPncp(cnpjDigits, opts = {}) {
  return fetchPncpDocumento(cnpjDigits, 'contrato', opts);
}

export async function fetchAtasPncp(cnpjDigits) {
  // Atas de registro de preço — retorna vazio silenciosamente se o PNCP não suportar
  return fetchPncpDocumento(cnpjDigits, 'ata', { maxPaginas: 3, tamPagina: 50 }).catch(() => ({ items: [], total: 0 }));
}

// ─── Portal da Transparência ─────────────────────────────────────────────────

function getPortalTransparenciaApiKey() {
  return getState().lookups.settings?.portal_transparencia_api_key || '';
}

async function fetchPortalEndpoint(endpoint, params, apiKey) {
  const qs = new URLSearchParams({ ...params, pagina: 1 }).toString();
  const res = await fetch(`https://api.portaldatransparencia.gov.br/api-de-dados/${endpoint}?${qs}`, {
    headers: { 'chave-api-dados': apiKey },
  });
  if (!res.ok) throw new Error(`${endpoint.toUpperCase()} HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchCertidoesPortalTransparencia(cnpjDigits) {
  const apiKey = getPortalTransparenciaApiKey();
  if (!apiKey) return { configured: false, ceis: [], cnep: [], ceaf: [], leniencia: [] };

  const [ceis, cnep, ceaf, leniencia] = await Promise.all([
    fetchPortalEndpoint('ceis',             { codigoSancionado: cnpjDigits }, apiKey).catch(() => []),
    fetchPortalEndpoint('cnep',             { codigoSancionado: cnpjDigits }, apiKey).catch(() => []),
    fetchPortalEndpoint('ceaf',             { cpfCnpj: cnpjDigits },          apiKey).catch(() => []),
    fetchPortalEndpoint('acordos-leniencia',{ cnpj: cnpjDigits },             apiKey).catch(() => []),
  ]);

  return { configured: true, ceis, cnep, ceaf, leniencia };
}
