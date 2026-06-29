import * as Service from '../supabase-service.js';
import { getState, canWrite, isAdmin, currentUser, refreshLookups } from '../state.js';
import { byId, escapeHtml, formatDate, formatDateTime, formatNumber, formatMoneyInputValue, parseNumber, formatCurrency, toDatetimeLocalValue, daysUntil, sumBy } from '../helpers.js';
import { openModal, closeModal, confirmDialog, showToast, badge, renderEmptyState } from '../ui.js';
import { MODALIDADES, MODOS_DISPUTA, STATUS_LICITACAO, STATUS_COLOR, TIPOS_AGENDA, UFS, ICONS } from '../constants.js';

const STATUS_PERDA = ['Declinou', 'Desclassificado', 'Fracassado', 'Revogado'];

let cache = [];
let itemsByLicitacao = new Map();
let tagsByLicitacao = new Map();
let agendaByLicitacao = new Map();
let editingItems = [];
let originalItemIds = new Set();
let editingLicitacaoId = null;
let resultadoItems = [];
let atestadoSumByProduto = new Map();
let _habId = null;
let _habDocs = [];
let _monId = null;
let _monTarefas = [];
let _monHistorico = [];

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Licitações</h1>
        <p>Editais disputados, itens, precificação, agenda e resultado.</p>
      </div>
      ${canWrite() ? `<button class="btn btn-primary" data-action="licitacoes.novo">${ICONS.plus}Nova Licitação</button>` : ''}
    </div>

    <div class="card no-sticky" style="margin-bottom:16px;">
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div class="form-field" style="flex:2; min-width:260px; margin:0;">
          <label>Buscar</label>
          <input type="text" id="lic-filtro-busca" placeholder="Pregão, processo, órgão ou objeto..." />
        </div>
        <div class="form-field" style="min-width:90px; margin:0;">
          <label>UF</label>
          <select id="lic-filtro-uf"><option value="">Todas</option></select>
        </div>
        <div class="form-field" style="min-width:170px; margin:0;">
          <label>Modalidade</label>
          <select id="lic-filtro-modalidade">
            <option value="">Todas</option>
            ${MODALIDADES.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field" style="flex:1; min-width:170px; margin:0;">
          <label>Órgão</label>
          <select id="lic-filtro-orgao"><option value="">Todos</option></select>
        </div>
        <div class="form-field" style="min-width:155px; margin:0;">
          <label>Status do item</label>
          <select id="lic-filtro-status">
            <option value="">Qualquer</option>
            ${STATUS_LICITACAO.map((s) => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-field" style="min-width:140px; margin:0;">
          <label>Tag</label>
          <select id="lic-filtro-tag"><option value="">Todas</option></select>
        </div>
        <div class="form-field" style="min-width:138px; margin:0;">
          <label>Abertura de</label>
          <input type="date" id="lic-filtro-data-ini" />
        </div>
        <div class="form-field" style="min-width:138px; margin:0;">
          <label>Abertura até</label>
          <input type="date" id="lic-filtro-data-fim" />
        </div>
        <div class="form-field" style="min-width:145px; margin:0;">
          <label>Habilitação</label>
          <select id="lic-filtro-hab">
            <option value="">Qualquer</option>
            <option value="Aguardando">Aguardando</option>
            <option value="Habilitado">Habilitado</option>
            <option value="Inabilitado">Inabilitado</option>
          </select>
        </div>
        <div class="form-field" style="min-width:155px; margin:0;">
          <label>Monitoramento</label>
          <select id="lic-filtro-mon">
            <option value="">Qualquer</option>
            <option value="Em andamento">Em andamento</option>
            <option value="Encerrado">Encerrado</option>
            <option value="Suspenso">Suspenso</option>
          </select>
        </div>
        <div style="align-self:flex-end; padding-bottom:1px; flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" data-action="licitacoes.limparFiltros">Limpar</button>
        </div>
      </div>
      <div id="lic-filtro-resumo" style="margin-top:8px; font-size:12px; color:var(--gray-500); min-height:16px;"></div>
    </div>

    <div id="lic-cards-container"></div>
  `;

  const inputs = ['lic-filtro-busca','lic-filtro-uf','lic-filtro-modalidade','lic-filtro-orgao',
    'lic-filtro-status','lic-filtro-tag','lic-filtro-data-ini','lic-filtro-data-fim',
    'lic-filtro-hab','lic-filtro-mon'];
  inputs.forEach((id) => {
    const el = byId(id);
    if (el) el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', renderCards);
  });

  await reload();
}

async function reload() {
  const [licitacoes, allItems, licitacaoTags, agendaEventos] = await Promise.all([
    Service.listLicitacoes(),
    Service.listAllLicitacaoItens(),
    Service.listLicitacaoTags(),
    Service.AgendaEventos.list(),
  ]);
  cache = licitacoes;

  itemsByLicitacao = new Map();
  for (const item of allItems) {
    const arr = itemsByLicitacao.get(item.licitacao_id) || [];
    arr.push(item);
    itemsByLicitacao.set(item.licitacao_id, arr);
  }

  tagsByLicitacao = new Map();
  for (const row of licitacaoTags) {
    if (!row.tag) continue;
    const arr = tagsByLicitacao.get(row.licitacao_id) || [];
    arr.push(row.tag);
    tagsByLicitacao.set(row.licitacao_id, arr);
  }

  agendaByLicitacao = new Map();
  for (const ev of agendaEventos) {
    if (ev.referencia_tipo !== 'licitacao' || !ev.referencia_id) continue;
    const arr = agendaByLicitacao.get(ev.referencia_id) || [];
    arr.push(ev);
    agendaByLicitacao.set(ev.referencia_id, arr);
  }
  for (const arr of agendaByLicitacao.values()) arr.sort((a, b) => (a.data > b.data ? 1 : -1));

  populateFilterSelects();
  renderCards();
}

function populateFilterSelects() {
  const saveVal = (id) => byId(id)?.value || '';
  const setVal = (id, v) => { const el = byId(id); if (el) el.value = v; };

  // Tags
  const tagSel = byId('lic-filtro-tag');
  if (tagSel) {
    const prev = tagSel.value;
    tagSel.innerHTML = `<option value="">Todas as tags</option>${getState().lookups.tags.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('')}`;
    tagSel.value = prev;
  }

  // UFs presentes na base
  const ufsNoCache = [...new Set(cache.map((l) => l.uf).filter(Boolean))].sort();
  const ufSel = byId('lic-filtro-uf');
  if (ufSel) {
    const prev = saveVal('lic-filtro-uf');
    ufSel.innerHTML = `<option value="">Todas</option>${ufsNoCache.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('')}`;
    setVal('lic-filtro-uf', prev);
  }

  // Órgãos presentes na base
  const orgaoMap = new Map();
  cache.forEach((l) => { if (l.orgao?.id) orgaoMap.set(l.orgao.id, l.orgao.nome); });
  const orgaos = [...orgaoMap.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  const orgaoSel = byId('lic-filtro-orgao');
  if (orgaoSel) {
    const prev = saveVal('lic-filtro-orgao');
    orgaoSel.innerHTML = `<option value="">Todos</option>${orgaos.map(([id, nome]) => `<option value="${id}">${escapeHtml(nome)}</option>`).join('')}`;
    setVal('lic-filtro-orgao', prev);
  }
}

function renderCards() {
  const busca        = (byId('lic-filtro-busca')?.value || '').toLowerCase();
  const statusFiltro = byId('lic-filtro-status')?.value || '';
  const tagFiltro    = byId('lic-filtro-tag')?.value || '';
  const ufFiltro     = byId('lic-filtro-uf')?.value || '';
  const modFiltro    = byId('lic-filtro-modalidade')?.value || '';
  const orgFiltro    = byId('lic-filtro-orgao')?.value || '';
  const dataIni      = byId('lic-filtro-data-ini')?.value || '';
  const dataFim      = byId('lic-filtro-data-fim')?.value || '';
  const habFiltro    = byId('lic-filtro-hab')?.value || '';
  const monFiltro    = byId('lic-filtro-mon')?.value || '';

  const filtradas = cache.filter((l) => {
    if (busca) {
      const haystack = `${l.numero_pregao} ${l.numero_processo || ''} ${l.orgao?.nome || ''} ${l.objeto || ''}`.toLowerCase();
      if (!haystack.includes(busca)) return false;
    }
    if (statusFiltro) {
      const itens = itemsByLicitacao.get(l.id) || [];
      if (!itens.some((i) => i.status === statusFiltro)) return false;
    }
    if (tagFiltro) {
      const tags = tagsByLicitacao.get(l.id) || [];
      if (!tags.some((t) => String(t.id) === String(tagFiltro))) return false;
    }
    if (ufFiltro && l.uf !== ufFiltro) return false;
    if (modFiltro && l.modalidade !== modFiltro) return false;
    if (orgFiltro && String(l.orgao?.id) !== orgFiltro) return false;
    if (dataIni || dataFim) {
      const dataRef = (l.data_abertura || l.data_sessao || '').slice(0, 10);
      if (dataIni && dataRef < dataIni) return false;
      if (dataFim && dataRef > dataFim) return false;
    }
    if (habFiltro && (l.habilitacao_status || 'Aguardando') !== habFiltro) return false;
    if (monFiltro && (l.monitoramento_status || 'Em andamento') !== monFiltro) return false;
    return true;
  });

  const resumo = byId('lic-filtro-resumo');
  if (resumo) {
    const temFiltro = busca || statusFiltro || tagFiltro || ufFiltro || modFiltro || orgFiltro || dataIni || dataFim || habFiltro || monFiltro;
    resumo.textContent = temFiltro ? `${filtradas.length} de ${cache.length} licitações` : '';
  }

  const wrap = byId('lic-cards-container');
  if (!filtradas.length) {
    wrap.innerHTML = `<div class="card">${renderEmptyState('Nenhuma licitação encontrada.')}</div>`;
    return;
  }
  wrap.innerHTML = filtradas.map(cardHtml).join('');
}

function cardHtml(l) {
  const itens = [...(itemsByLicitacao.get(l.id) || [])].sort((a, b) => (a.item_numero || 0) - (b.item_numero || 0));
  const contagem = new Map();
  itens.forEach((i) => contagem.set(i.status, (contagem.get(i.status) || 0) + 1));
  const statusBadges = [...contagem.entries()]
    .map(([status, qtd]) => badge(`${status}${qtd > 1 ? ` ×${qtd}` : ''}`, STATUS_COLOR[status] || 'muted'))
    .join(' ');

  const tags = tagsByLicitacao.get(l.id) || [];
  const tagPills = tags
    .map((t) => `<span class="tag-pill" style="background:${t.cor}1a; color:${t.cor}; border-color:${t.cor}55;">${escapeHtml(t.nome)}</span>`)
    .join('');

  const eventos = agendaByLicitacao.get(l.id) || [];
  const agendaHtml = eventos.length
    ? eventos.slice(0, 3).map((ev) => {
        const dias = daysUntil(ev.data);
        const urgente = dias !== null && dias >= 0 && dias <= 7;
        const vencido = dias !== null && dias < 0;
        const diasLabel = dias === null ? '' : vencido ? 'vencido' : dias === 0 ? 'hoje' : `${dias}d`;
        const diasColor = vencido ? 'var(--danger)' : urgente ? 'var(--warning)' : 'var(--gray-500)';
        const dotClass = vencido ? ' danger' : urgente ? ' warning' : '';
        return `<div class="lic-agenda-item">
          <div class="lic-agenda-dot${dotClass}"></div>
          <span class="lic-agenda-titulo">${escapeHtml(ev.titulo)}</span>
          <span class="lic-agenda-data">${formatDate(ev.data)}${diasLabel ? ` · <span style="color:${diasColor};font-weight:600;">${diasLabel}</span>` : ''}</span>
        </div>`;
      }).join('') + (eventos.length > 3 ? `<span class="lic-agenda-mais">+${eventos.length - 3} mais</span>` : '')
    : `<span class="lic-agenda-empty">Nenhum lembrete vinculado.</span>`;

  return `
    <div class="card lic-card" data-id="${l.id}">
      <div class="lic-card-head">
        <div class="lic-card-tags">
          <span class="lic-modalidade-chip">${escapeHtml(l.modalidade)}</span>
          ${tagPills}
          ${canWrite() ? `<button type="button" class="link-btn" data-action="licitacoes.tags" data-id="${l.id}">+ tag</button>` : ''}
        </div>
        <div class="row-actions">
          <button class="icon-btn" data-action="licitacoes.editar" data-id="${l.id}" title="Gerenciar">${ICONS.edit}</button>
          ${isAdmin() ? `<button class="icon-btn" data-action="licitacoes.excluir" data-id="${l.id}" title="Excluir">${ICONS.trash}</button>` : ''}
        </div>
      </div>

      <div class="lic-card-identity">
        <h3 class="lic-card-title">${escapeHtml(l.numero_pregao)} — ${escapeHtml(l.orgao?.nome || 'Sem órgão')}</h3>
        ${l.uf ? `<span class="lic-uf-badge">${escapeHtml(l.uf)}</span>` : ''}
      </div>
      <p class="lic-card-objeto">${escapeHtml(l.objeto || 'Sem objeto cadastrado.')}</p>

      <div class="lic-card-facts">
        <div><span>Valor estimado</span><strong>${formatCurrency(l.valor_total_estimado)}</strong></div>
        <div><span>Abertura</span><strong>${formatDateTime(l.data_abertura)}</strong></div>
        <div><span>Modo de disputa</span><strong>${escapeHtml(l.modo_disputa || '-')}</strong></div>
        <div><span>Reg. de preço</span><strong>${l.registro_preco ? 'Sim' : 'Não'}</strong></div>
      </div>

      ${statusBadges ? `<div class="lic-items-row"><span class="lic-items-label">Itens</span>${statusBadges}</div>` : ''}

      <div class="lic-card-agenda">
        <div class="lic-card-agenda-head">
          <strong>Compromissos</strong>
          ${canWrite() ? `<button type="button" class="link-btn" data-action="licitacoes.lembrete" data-id="${l.id}">+ Lembrete</button>` : ''}
        </div>
        <div class="lic-card-agenda-list">${agendaHtml}</div>
      </div>

      <div class="lic-card-footer">
        <button class="btn btn-primary btn-sm" data-action="licitacoes.editar" data-id="${l.id}">Gerenciar</button>
        <button class="btn btn-ghost btn-sm" data-action="licitacoes.resultado" data-id="${l.id}">Resultado</button>
        <button class="btn btn-ghost btn-sm" data-action="licitacoes.habilitacao" data-id="${l.id}">Habilitação${l.habilitacao_status && l.habilitacao_status !== 'Aguardando' ? ` ${badge(l.habilitacao_status, l.habilitacao_status === 'Habilitado' ? 'success' : 'danger')}` : ''}</button>
        <button class="btn btn-ghost btn-sm" data-action="licitacoes.monitoramento" data-id="${l.id}">Monitorar${l.monitoramento_status === 'Encerrado' ? ` ${badge('Encerrado', 'muted')}` : l.monitoramento_status === 'Suspenso' ? ` ${badge('Suspenso', 'warning')}` : ''}</button>
        <button type="button" class="link-btn" id="toggle-btn-${l.id}" data-action="licitacoes.toggleItens" data-id="${l.id}">↓ Ver itens</button>
      </div>

      <div class="lic-card-itens" id="lic-itens-${l.id}" hidden>
        ${itens.length ? `
          <table class="data-table">
            <thead><tr><th>Item</th><th>Descrição</th><th>Qtd</th><th>Valor Mínimo</th><th>Valor Inicial</th><th>Resultado</th></tr></thead>
            <tbody>
              ${itens.map((i) => `
                <tr>
                  <td>${i.item_numero}</td>
                  <td>${escapeHtml(i.produto_descricao || '-')}</td>
                  <td>${formatNumber(i.quantidade, 0)}</td>
                  <td>${formatCurrency(i.valor_minimo)}</td>
                  <td>${formatCurrency(i.valor_inicial)}</td>
                  <td>${badge(i.status, STATUS_COLOR[i.status] || 'muted')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : renderEmptyState('Nenhum item cadastrado.')}
      </div>
    </div>
  `;
}

function toggleItens(target) {
  const el = byId(`lic-itens-${target.dataset.id}`);
  if (!el) return;
  el.hidden = !el.hidden;
  target.textContent = el.hidden ? '↓ Ver itens' : '↑ Ocultar itens';
}

async function reloadAtestados() {
  if (!byId('f-exige-atestado')?.checked) {
    atestadoSumByProduto = new Map();
    return;
  }
  const ids = [...new Set(editingItems.map((i) => i.produto_id).filter(Boolean))];
  if (!ids.length) { atestadoSumByProduto = new Map(); return; }
  const atests = await Service.listAtestadosByProdutos(ids);
  atestadoSumByProduto = new Map();
  for (const a of atests) {
    const k = String(a.produto_id);
    atestadoSumByProduto.set(k, (atestadoSumByProduto.get(k) || 0) + Number(a.quantidade_atestada || 0));
  }
}

function acervoStatusItem(item, percentual) {
  if (!item.produto_id || !item.quantidade) return '';
  const qtdNecessaria = parseNumber(item.quantidade) * percentual / 100;
  if (qtdNecessaria <= 0) return '';
  const qtdAtestada = atestadoSumByProduto.get(String(item.produto_id)) || 0;
  if (qtdAtestada >= qtdNecessaria) {
    return `<span style="color:var(--success)" title="✓ ${formatNumber(qtdAtestada, 0)} atestadas / ${formatNumber(qtdNecessaria, 0)} necessárias">✅ ${formatNumber(qtdAtestada, 0)}</span>`;
  }
  if (qtdAtestada > 0) {
    return `<span style="color:var(--warning)" title="⚠ ${formatNumber(qtdAtestada, 0)} atestadas / ${formatNumber(qtdNecessaria, 0)} necessárias">⚠️ ${formatNumber(qtdAtestada, 0)}</span>`;
  }
  return `<span style="color:var(--danger)" title="Sem atestado. Necessário: ${formatNumber(qtdNecessaria, 0)} un.">❌</span>`;
}

async function abrirFormulario(licitacaoId) {
  editingLicitacaoId = licitacaoId || null;
  let licitacao = {
    numero_pregao: '', numero_processo: '', orgao_id: '', uf: '', modalidade: 'Pregão Eletrônico',
    registro_preco: false, valor_total_estimado: '', modo_disputa: '', data_abertura: '', data_sessao: '', hora_sessao: '',
    prazo_entrega: '', prazo_pagamento: '', validade_proposta: '',
    nome_pregoeiro: '', telefone_pregoeiro: '', email_pregoeiro: '', enderecos: '',
    objeto: '', recurso_contrarrazao: false, motivo_rc: '', deferido_indeferido: '', observacoes: '',
    exige_atestado: false, percentual_atestado: 50,
  };
  editingItems = [];
  originalItemIds = new Set();
  atestadoSumByProduto = new Map();

  if (licitacaoId) {
    licitacao = cache.find((l) => l.id === licitacaoId) || await Service.getLicitacao(licitacaoId);
    const itens = await Service.listLicitacaoItens(licitacaoId);
    editingItems = itens.map((it) => ({ ...it }));
    originalItemIds = new Set(itens.map((it) => it.id));
    if (licitacao.exige_atestado && editingItems.length) {
      const ids = [...new Set(editingItems.map((i) => i.produto_id).filter(Boolean))];
      if (ids.length) {
        const atests = await Service.listAtestadosByProdutos(ids);
        for (const a of atests) {
          const k = String(a.produto_id);
          atestadoSumByProduto.set(k, (atestadoSumByProduto.get(k) || 0) + Number(a.quantidade_atestada || 0));
        }
      }
    }
  }

  const orgaosOptions = getState().lookups.orgaos
    .map((o) => `<option value="${o.id}" ${String(o.id) === String(licitacao.orgao_id) ? 'selected' : ''}>${escapeHtml(o.nome)}</option>`)
    .join('');

  const bodyHtml = `
    <form id="licitacao-form">
      <div class="form-section-title">Dados gerais</div>
      <div class="form-grid cols-3">
        <div class="form-field"><label>Nº do Pregão *</label><input required id="f-numero-pregao" value="${escapeHtml(licitacao.numero_pregao || '')}" /></div>
        <div class="form-field"><label>Nº do Processo</label><input id="f-numero-processo" value="${escapeHtml(licitacao.numero_processo || '')}" /></div>
        <div class="form-field"><label>Órgão</label><select id="f-orgao-id"><option value="">Selecione...</option>${orgaosOptions}</select></div>
        <div class="form-field"><label>UF</label><select id="f-uf"><option value="">-</option>${UFS.map((uf) => `<option ${uf === licitacao.uf ? 'selected' : ''}>${uf}</option>`).join('')}</select></div>
        <div class="form-field"><label>Modalidade</label><select id="f-modalidade">${MODALIDADES.map((m) => `<option ${m === licitacao.modalidade ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="form-field"><label>Modo de Disputa</label><select id="f-modo-disputa"><option value="">-</option>${MODOS_DISPUTA.map((m) => `<option ${m === licitacao.modo_disputa ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="form-field"><label>Valor Total Estimado</label><div class="input-currency-wrap"><input id="f-valor-total-estimado" value="${formatMoneyInputValue(licitacao.valor_total_estimado)}" placeholder="0,00" /></div></div>
        <div class="form-field">
          <label>Registro de Preço?</label>
          <div class="checkbox-field" style="height:38px;"><input type="checkbox" id="f-registro-preco" ${licitacao.registro_preco ? 'checked' : ''} /> Sim</div>
        </div>
        <div class="form-field">
          <label>Exige Acervo Técnico?</label>
          <div class="checkbox-field" style="height:38px;"><input type="checkbox" id="f-exige-atestado" ${licitacao.exige_atestado ? 'checked' : ''} /> Sim</div>
        </div>
        <div class="form-field" id="f-wrap-percentual" ${!licitacao.exige_atestado ? 'style="display:none"' : ''}>
          <label>% Mínimo do Acervo</label>
          <input type="number" min="1" max="100" id="f-percentual-atestado" value="${licitacao.percentual_atestado ?? 50}" />
        </div>
      </div>

      <div class="form-section-title">Datas e prazos</div>
      <div class="form-grid cols-3">
        <div class="form-field"><label>Abertura (data/hora)</label><input type="datetime-local" id="f-data-abertura" value="${toDatetimeLocalValue(licitacao.data_abertura)}" /></div>
        <div class="form-field"><label>Data da Sessão Pública</label><input type="date" id="f-data-sessao" value="${licitacao.data_sessao || ''}" /></div>
        <div class="form-field"><label>Hora da Sessão Pública</label><input type="time" id="f-hora-sessao" value="${licitacao.hora_sessao || ''}" /></div>
        <div class="form-field"><label>Validade da Proposta</label><input id="f-validade-proposta" value="${escapeHtml(licitacao.validade_proposta || '')}" placeholder="Ex: 60 dias" /></div>
        <div class="form-field"><label>Prazo de Entrega</label><input id="f-prazo-entrega" value="${escapeHtml(licitacao.prazo_entrega || '')}" /></div>
        <div class="form-field"><label>Prazo de Pagamento</label><input id="f-prazo-pagamento" value="${escapeHtml(licitacao.prazo_pagamento || '')}" /></div>
      </div>

      <div class="form-section-title">Pregoeiro e contato</div>
      <div class="form-grid cols-3">
        <div class="form-field"><label>Nome do Pregoeiro</label><input id="f-nome-pregoeiro" value="${escapeHtml(licitacao.nome_pregoeiro || '')}" /></div>
        <div class="form-field"><label>Telefone</label><input id="f-telefone-pregoeiro" value="${escapeHtml(licitacao.telefone_pregoeiro || '')}" /></div>
        <div class="form-field"><label>Email</label><input id="f-email-pregoeiro" value="${escapeHtml(licitacao.email_pregoeiro || '')}" /></div>
        <div class="form-field span-3"><label>Endereços</label><input id="f-enderecos" value="${escapeHtml(licitacao.enderecos || '')}" /></div>
      </div>

      <div class="form-section-title">Objeto e recurso</div>
      <div class="form-grid cols-3">
        <div class="form-field span-3"><label>Objeto</label><textarea id="f-objeto">${escapeHtml(licitacao.objeto || '')}</textarea></div>
        <div class="form-field">
          <label>Houve Recurso/Contrarrazão?</label>
          <div class="checkbox-field" style="height:38px;"><input type="checkbox" id="f-recurso" ${licitacao.recurso_contrarrazao ? 'checked' : ''} /> Sim</div>
        </div>
        <div class="form-field">
          <label>Deferido/Indeferido</label>
          <select id="f-deferido"><option value="">-</option><option ${licitacao.deferido_indeferido === 'Deferido' ? 'selected' : ''}>Deferido</option><option ${licitacao.deferido_indeferido === 'Indeferido' ? 'selected' : ''}>Indeferido</option></select>
        </div>
        <div class="form-field span-3"><label>Motivo do Recurso/Contrarrazão</label><input id="f-motivo-rc" value="${escapeHtml(licitacao.motivo_rc || '')}" /></div>
        <div class="form-field span-3"><label>Observações</label><textarea id="f-observacoes">${escapeHtml(licitacao.observacoes || '')}</textarea></div>
      </div>

      <div class="card items-table-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div>
            <strong>Itens do edital — Precificação</strong>
            <div style="color:var(--gray-500); font-size:12px;">Vincule o produto para puxar o custo, informe a margem e o Valor Mínimo é calculado automaticamente.</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-action="licitacoes.addItem">${ICONS.plus} Adicionar item</button>
        </div>
        <div id="licitacao-itens-table"></div>
      </div>
    </form>
  `;

  openModal(licitacaoId ? 'Editar Licitação' : 'Nova Licitação', bodyHtml, {
    size: 'xl',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="licitacoes.salvar">Salvar</button>
    `,
  });

  renderItemsTable();

  byId('f-exige-atestado')?.addEventListener('change', async () => {
    const wrap = byId('f-wrap-percentual');
    if (wrap) wrap.style.display = byId('f-exige-atestado').checked ? '' : 'none';
    await reloadAtestados();
    renderItemsTable();
  });

  byId('f-percentual-atestado')?.addEventListener('input', () => renderItemsTable());
}

function renderItemsTable() {
  const wrap = byId('licitacao-itens-table');
  if (!wrap) return;
  const { produtos } = getState().lookups;

  if (!editingItems.length) {
    wrap.innerHTML = renderEmptyState('Nenhum item adicionado.');
    return;
  }

  const exigeAtestado = byId('f-exige-atestado')?.checked ?? false;
  const percentualAtestado = parseNumber(byId('f-percentual-atestado')?.value || '50') || 50;

  wrap.innerHTML = `
    <div class="table-wrap items-table">
      <table class="data-table">
        <thead>
          <tr>
            <th>Item</th><th>Produto</th><th>Qtd</th><th>Marca/Fabricante</th><th>Modelo/Versão</th>
            <th>Valor Ref.</th><th>Custo</th><th>Margem %</th><th>Valor Mínimo</th><th>Valor Inicial</th>
            ${exigeAtestado ? '<th title="Acervo Técnico: qtd atestada vs qtd necessária">Acervo</th>' : ''}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${editingItems.map((item, idx) => `
            <tr data-row="${idx}">
              <td><input type="number" min="1" data-field="item_numero" value="${item.item_numero ?? idx + 1}" style="width:54px;" /></td>
              <td>
                <select data-field="produto_id" style="min-width:150px;">
                  <option value="">Selecione um produto...</option>
                  ${produtos.map((p) => `<option value="${p.id}" ${String(item.produto_id) === String(p.id) ? 'selected' : ''}>${escapeHtml(p.nome)}</option>`).join('')}
                </select>
              </td>
              <td><input type="text" data-field="quantidade" value="${item.quantidade ?? ''}" style="width:70px;" /></td>
              <td><input type="text" data-field="marca_fabricante" value="${escapeHtml(item.marca_fabricante ?? '')}" style="min-width:120px;" /></td>
              <td><input type="text" data-field="modelo_versao" value="${escapeHtml(item.modelo_versao ?? '')}" style="min-width:110px;" /></td>
              <td><input type="text" data-field="valor_referencia" value="${formatMoneyInputValue(item.valor_referencia)}" style="width:90px;" placeholder="Sigiloso" /></td>
              <td><input type="text" data-field="custo_unitario" value="${formatMoneyInputValue(item.custo_unitario)}" style="width:90px;" placeholder="0,00" /></td>
              <td><input type="text" data-field="margem_percentual" value="${item.margem_percentual ?? ''}" style="width:70px;" /></td>
              <td><input type="text" data-field="valor_minimo" value="${formatMoneyInputValue(item.valor_minimo)}" style="width:90px;" placeholder="0,00" /></td>
              <td><input type="text" data-field="valor_inicial" value="${formatMoneyInputValue(item.valor_inicial)}" style="width:90px;" placeholder="0,00" /></td>
              ${exigeAtestado ? `<td style="white-space:nowrap;">${acervoStatusItem(item, percentualAtestado)}</td>` : ''}
              <td><button type="button" class="icon-btn" data-action="licitacoes.removerItem" data-row="${idx}">${ICONS.trash}</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  wrap.querySelectorAll('[data-field]').forEach((el) => {
    el.addEventListener('input', onItemFieldChange);
    el.addEventListener('change', onItemFieldChange);
  });
}

function recalcValorMinimo(item) {
  const custo = parseNumber(item.custo_unitario);
  const margem = parseNumber(item.margem_percentual);
  if (custo > 0) {
    item.valor_minimo = (custo * (1 + margem / 100)).toFixed(2);
  }
}

function onItemFieldChange(event) {
  const row = event.target.closest('tr');
  const idx = Number(row.dataset.row);
  const field = event.target.dataset.field;
  const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  const item = editingItems[idx];
  item[field] = value;

  if (field === 'produto_id') {
    const produto = getState().lookups.produtos.find((p) => String(p.id) === String(value));
    item.produto_descricao = produto?.nome || '';
    if (produto) {
      if (!item.marca_fabricante && produto.fabricante) {
        item.marca_fabricante = produto.fabricante;
        row.querySelector('[data-field="marca_fabricante"]').value = produto.fabricante;
      }
      item.custo_unitario = produto.preco_custo ?? '';
      row.querySelector('[data-field="custo_unitario"]').value = formatMoneyInputValue(item.custo_unitario);
      recalcValorMinimo(item);
      row.querySelector('[data-field="valor_minimo"]').value = formatMoneyInputValue(item.valor_minimo);
    }
    if (byId('f-exige-atestado')?.checked) {
      reloadAtestados().then(() => renderItemsTable());
    }
  }

  if (field === 'custo_unitario' || field === 'margem_percentual') {
    recalcValorMinimo(item);
    row.querySelector('[data-field="valor_minimo"]').value = formatMoneyInputValue(item.valor_minimo);
  }
}

function addItem() {
  editingItems.push({
    id: null, item_numero: editingItems.length + 1, produto_id: '', produto_descricao: '', quantidade: '',
    marca_fabricante: '', modelo_versao: '', valor_referencia: '', custo_unitario: '', margem_percentual: '',
    valor_inicial: '', valor_minimo: '', valor_final: '', status: 'Em disputa',
    motivo_perda: '', empresa_vencedora_id: '', parceiro_id: '',
  });
  renderItemsTable();
}

function removerItem(target) {
  const idx = Number(target.dataset.row);
  editingItems.splice(idx, 1);
  renderItemsTable();
}

async function salvar() {
  const dataAbertura = byId('f-data-abertura').value;
  const payload = {
    numero_pregao: byId('f-numero-pregao').value.trim(),
    numero_processo: byId('f-numero-processo').value.trim() || null,
    orgao_id: byId('f-orgao-id').value || null,
    uf: byId('f-uf').value || null,
    modalidade: byId('f-modalidade').value,
    registro_preco: byId('f-registro-preco').checked,
    exige_atestado: byId('f-exige-atestado').checked,
    percentual_atestado: parseNumber(byId('f-percentual-atestado')?.value || '50') || 50,
    valor_total_estimado: byId('f-valor-total-estimado').value ? parseNumber(byId('f-valor-total-estimado').value) : null,
    modo_disputa: byId('f-modo-disputa').value || null,
    data_abertura: dataAbertura ? new Date(dataAbertura).toISOString() : null,
    data_sessao: byId('f-data-sessao').value || null,
    hora_sessao: byId('f-hora-sessao').value || null,
    validade_proposta: byId('f-validade-proposta').value.trim() || null,
    prazo_entrega: byId('f-prazo-entrega').value.trim() || null,
    prazo_pagamento: byId('f-prazo-pagamento').value.trim() || null,
    nome_pregoeiro: byId('f-nome-pregoeiro').value.trim() || null,
    telefone_pregoeiro: byId('f-telefone-pregoeiro').value.trim() || null,
    email_pregoeiro: byId('f-email-pregoeiro').value.trim() || null,
    enderecos: byId('f-enderecos').value.trim() || null,
    objeto: byId('f-objeto').value.trim() || null,
    recurso_contrarrazao: byId('f-recurso').checked,
    motivo_rc: byId('f-motivo-rc').value.trim() || null,
    deferido_indeferido: byId('f-deferido').value || null,
    observacoes: byId('f-observacoes').value.trim() || null,
  };

  if (!payload.numero_pregao) {
    showToast('Informe o número do pregão.', 'error');
    return;
  }

  const itemSemProduto = editingItems.find((item) => !item.produto_id);
  if (itemSemProduto) {
    showToast(`Selecione um produto cadastrado para o item ${itemSemProduto.item_numero}.`, 'error');
    return;
  }

  try {
    if (editingLicitacaoId) {
      await Service.updateLicitacao(editingLicitacaoId, payload);
    } else {
      const created = await Service.createLicitacao(payload);
      editingLicitacaoId = created.id;
    }

    const currentIds = new Set();
    for (const item of editingItems) {
      const itemPayload = {
        licitacao_id: editingLicitacaoId,
        item_numero: Number(item.item_numero) || 1,
        produto_id: item.produto_id || null,
        produto_descricao: item.produto_descricao || null,
        quantidade: parseNumber(item.quantidade),
        marca_fabricante: item.marca_fabricante || null,
        modelo_versao: item.modelo_versao || null,
        valor_referencia: item.valor_referencia !== '' && item.valor_referencia != null ? parseNumber(item.valor_referencia) : null,
        custo_unitario: item.custo_unitario !== '' && item.custo_unitario != null ? parseNumber(item.custo_unitario) : null,
        margem_percentual: item.margem_percentual !== '' && item.margem_percentual != null ? parseNumber(item.margem_percentual) : null,
        valor_inicial: parseNumber(item.valor_inicial),
        valor_minimo: parseNumber(item.valor_minimo),
        valor_final: parseNumber(item.valor_final),
        status: item.status || 'Em disputa',
        motivo_perda: item.motivo_perda || null,
        empresa_vencedora_id: item.empresa_vencedora_id || null,
        parceiro_id: item.parceiro_id || null,
      };
      if (item.id) {
        await Service.updateLicitacaoItem(item.id, itemPayload);
        currentIds.add(item.id);
      } else {
        const created = await Service.createLicitacaoItem(itemPayload);
        currentIds.add(created.id);
      }
    }

    const toDelete = [...originalItemIds].filter((id) => !currentIds.has(id));
    for (const id of toDelete) await Service.deleteLicitacaoItem(id);

    showToast('Licitação salva com sucesso.', 'success');
    closeModal();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar licitação.', 'error');
  }
}

function abrirTags(licitacaoId) {
  const allTags = getState().lookups.tags;
  const assignedIds = new Set((tagsByLicitacao.get(licitacaoId) || []).map((t) => String(t.id)));

  const bodyHtml = `
    <div class="tag-check-list" id="tag-check-list">
      ${allTags.length ? allTags.map((t) => `
        <label class="tag-check-row">
          <input type="checkbox" value="${t.id}" ${assignedIds.has(String(t.id)) ? 'checked' : ''} />
          <span class="tag-pill" style="background:${t.cor}1a; color:${t.cor}; border-color:${t.cor}55;">${escapeHtml(t.nome)}</span>
        </label>
      `).join('') : renderEmptyState('Nenhuma tag cadastrada ainda.')}
    </div>
    <div class="form-field" style="margin-top:16px;">
      <label>Criar nova tag</label>
      <div style="display:flex; gap:8px;">
        <input type="text" id="nova-tag-nome" placeholder="Nome da tag" style="flex:1;" />
        <input type="color" id="nova-tag-cor" value="#2563EB" style="width:46px; padding:2px; flex:0 0 auto;" />
        <button type="button" class="btn btn-ghost btn-sm" data-action="licitacoes.criarTag" data-id="${licitacaoId}">Adicionar</button>
      </div>
    </div>
  `;

  openModal('Atribuir tags', bodyHtml, {
    size: 'sm',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="licitacoes.salvarTags" data-id="${licitacaoId}">Salvar</button>
    `,
  });
}

async function criarTag(target) {
  const licitacaoId = Number(target.dataset.id);
  const nome = byId('nova-tag-nome').value.trim();
  const cor = byId('nova-tag-cor').value;
  if (!nome) {
    showToast('Informe o nome da tag.', 'error');
    return;
  }
  try {
    await Service.Tags.create({ nome, cor });
    await refreshLookups();
    showToast('Tag criada.', 'success');
    abrirTags(licitacaoId);
  } catch (err) {
    showToast(err.message || 'Erro ao criar tag.', 'error');
  }
}

async function salvarTags(target) {
  const licitacaoId = Number(target.dataset.id);
  const checked = new Set([...byId('tag-check-list').querySelectorAll('input[type="checkbox"]:checked')].map((el) => Number(el.value)));
  const assigned = new Set((tagsByLicitacao.get(licitacaoId) || []).map((t) => t.id));

  try {
    for (const tagId of checked) {
      if (!assigned.has(tagId)) await Service.assignTag(licitacaoId, tagId);
    }
    for (const tagId of assigned) {
      if (!checked.has(tagId)) await Service.unassignTag(licitacaoId, tagId);
    }
    showToast('Tags atualizadas.', 'success');
    closeModal();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao atualizar tags.', 'error');
  }
}

function abrirLembrete(target) {
  const licitacaoId = Number(target.dataset.id);
  const licitacao = cache.find((l) => l.id === licitacaoId);
  const bodyHtml = `
    <div class="form-grid">
      <div class="form-field span-2"><label>Título *</label><input id="lem-titulo" value="${escapeHtml(`Lembrete - ${licitacao?.numero_pregao || ''}`)}" /></div>
      <div class="form-field"><label>Tipo</label><select id="lem-tipo">${TIPOS_AGENDA.map((t) => `<option ${t === 'Outro' ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="form-field"><label>Data *</label><input type="date" id="lem-data" /></div>
      <div class="form-field"><label>Lembrete</label><div class="checkbox-field" style="height:38px;"><input type="checkbox" id="lem-ativo" checked /> Notificar</div></div>
      <div class="form-field span-2"><label>Observações</label><textarea id="lem-obs"></textarea></div>
    </div>
  `;
  openModal('Criar lembrete', bodyHtml, {
    size: 'sm',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="licitacoes.salvarLembrete" data-id="${licitacaoId}">Salvar</button>
    `,
  });
}

async function salvarLembrete(target) {
  const licitacaoId = Number(target.dataset.id);
  const titulo = byId('lem-titulo').value.trim();
  const data = byId('lem-data').value;
  if (!titulo || !data) {
    showToast('Informe título e data.', 'error');
    return;
  }
  try {
    await Service.AgendaEventos.create({
      titulo,
      tipo: byId('lem-tipo').value,
      data,
      lembrete: byId('lem-ativo').checked,
      observacoes: byId('lem-obs').value.trim() || null,
      referencia_tipo: 'licitacao',
      referencia_id: licitacaoId,
      criado_por: currentUser()?.id || null,
    });
    showToast('Lembrete criado.', 'success');
    closeModal();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao criar lembrete.', 'error');
  }
}

async function abrirResultado(target) {
  const licitacaoId = Number(target.dataset.id);
  const itens = await Service.listLicitacaoItens(licitacaoId);
  resultadoItems = itens.map((it) => ({ ...it }));
  const { concorrentes } = getState().lookups;

  const tabelaHtml = `
    <div class="table-wrap items-table">
      <table class="data-table">
        <thead>
          <tr>
            <th>Item</th><th>Qtd</th><th>Meu Lance Final</th><th>Valor Arrematado</th>
            <th>Resultado</th><th>Concorrente Vencedor</th><th>Motivo da perda</th>
          </tr>
        </thead>
        <tbody>
          ${resultadoItems.map((item, idx) => {
            const perdeu = STATUS_PERDA.includes(item.status);
            return `
            <tr data-row="${idx}">
              <td><strong>${item.item_numero}</strong><br/><span style="font-size:11px; color:var(--gray-500);">${escapeHtml(item.produto_descricao || '-')}</span></td>
              <td>${formatNumber(item.quantidade, 0)}</td>
              <td><input type="text" data-field="valor_final" value="${formatMoneyInputValue(item.valor_final)}" style="width:100px;" placeholder="0,00" /></td>
              <td><input type="text" data-field="valor_arrematado" value="${formatMoneyInputValue(item.valor_arrematado)}" style="width:100px;" placeholder="0,00" /></td>
              <td>
                <select data-field="status" style="min-width:130px;">
                  ${STATUS_LICITACAO.map((s) => `<option value="${s}" ${item.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </td>
              <td>
                <select data-field="empresa_vencedora_id" style="min-width:140px;" ${perdeu ? '' : 'disabled'}>
                  <option value="">-</option>
                  ${concorrentes.map((c) => `<option value="${c.id}" ${String(item.empresa_vencedora_id) === String(c.id) ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}
                </select>
              </td>
              <td><input type="text" data-field="motivo_perda" value="${escapeHtml(item.motivo_perda ?? '')}" style="min-width:140px;" ${perdeu ? '' : 'disabled'} /></td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="items-total" id="resultado-totais"></div>
  `;

  const bodyHtml = `
    <p style="color:var(--gray-500); font-size:13px; margin:-4px 0 16px;">Registre o resultado final de cada item: quanto fechamos, por quanto o item foi arrematado e, em caso de perda, quem ganhou e por quanto.</p>
    ${resultadoItems.length ? tabelaHtml : renderEmptyState('Esta licitação ainda não tem itens cadastrados.')}
  `;

  openModal('Pós-Disputa — Resultado', bodyHtml, {
    size: 'xl',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="licitacoes.salvarResultado">Salvar</button>
    `,
  });

  if (resultadoItems.length) {
    wireResultadoInputs();
    renderResultadoTotais();
  }
}

function wireResultadoInputs() {
  byId('modal-root').querySelectorAll('[data-field]').forEach((el) => {
    el.addEventListener('input', onResultadoFieldChange);
    el.addEventListener('change', onResultadoFieldChange);
  });
}

function onResultadoFieldChange(event) {
  const row = event.target.closest('tr');
  const idx = Number(row.dataset.row);
  const field = event.target.dataset.field;
  const item = resultadoItems[idx];
  item[field] = event.target.value;

  if (field === 'status') {
    const perdeu = STATUS_PERDA.includes(event.target.value);
    const vencedorSelect = row.querySelector('[data-field="empresa_vencedora_id"]');
    const motivoInput = row.querySelector('[data-field="motivo_perda"]');
    vencedorSelect.disabled = !perdeu;
    motivoInput.disabled = !perdeu;
    if (!perdeu) {
      item.empresa_vencedora_id = '';
      item.motivo_perda = '';
      vencedorSelect.value = '';
      motivoInput.value = '';
    }
  }

  renderResultadoTotais();
}

function renderResultadoTotais() {
  const totalParticipado = sumBy(resultadoItems, (it) => parseNumber(it.valor_final) * parseNumber(it.quantidade));
  const totalArrematado = sumBy(resultadoItems, (it) => parseNumber(it.valor_arrematado) * parseNumber(it.quantidade));
  const wrap = byId('resultado-totais');
  if (!wrap) return;
  wrap.innerHTML = `
    <span>Valor Total Participado: ${formatCurrency(totalParticipado)}</span>
    <span>Valor Total Arrematado: ${formatCurrency(totalArrematado)}</span>
  `;
}

async function salvarResultado() {
  try {
    for (const item of resultadoItems) {
      await Service.updateLicitacaoItem(item.id, {
        valor_final: parseNumber(item.valor_final),
        valor_arrematado: item.valor_arrematado !== '' && item.valor_arrematado != null ? parseNumber(item.valor_arrematado) : null,
        status: item.status,
        empresa_vencedora_id: item.empresa_vencedora_id || null,
        motivo_perda: item.motivo_perda || null,
      });
    }
    showToast('Resultado atualizado.', 'success');
    closeModal();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar resultado.', 'error');
  }
}

// ─── Habilitação ─────────────────────────────────────────────────────────────

function renderHabDocsSection() {
  const el = document.getElementById('hab-docs-section');
  if (!el) return;
  el.innerHTML = `
    <div class="form-section-title" style="margin-top:16px;">Documentos exigidos</div>
    ${_habDocs.length ? `
      <div class="check-list">
        ${_habDocs.map((d) => `
          <div class="check-list-item">
            <input type="checkbox" ${d.status !== 'Pendente' ? 'checked' : ''}
              data-action="licitacoes.toggleHabDoc" data-id="${d.id}"
              ${!canWrite() ? 'disabled' : ''}>
            <span style="${d.status !== 'Pendente' ? 'text-decoration:line-through; color:var(--gray-400);' : ''}">${escapeHtml(d.nome)}</span>
            ${badge(d.status, d.status === 'Entregue' ? 'success' : d.status === 'Dispensado' ? 'muted' : 'warning')}
            ${canWrite() ? `<button type="button" class="icon-btn" data-action="licitacoes.removerHabDoc" data-id="${d.id}">${ICONS.trash}</button>` : ''}
          </div>
        `).join('')}
      </div>
    ` : '<p style="font-size:13px; color:var(--gray-400); margin:8px 0;">Nenhum documento cadastrado.</p>'}
    ${canWrite() ? `
      <div style="display:flex; gap:8px; margin-top:8px;">
        <input type="text" id="hab-novo-doc" class="form-input" placeholder="Nome do documento exigido..." style="flex:1;">
        <button class="btn btn-ghost btn-sm" data-action="licitacoes.addHabDoc">+ Adicionar</button>
      </div>
    ` : ''}
  `;
}

async function abrirHabilitacao(target) {
  const licitacaoId = Number(target.dataset.id);
  const licitacao = cache.find((l) => l.id === licitacaoId);
  _habId = licitacaoId;
  _habDocs = await Service.Habilitacao.listDocs(licitacaoId);

  const bodyHtml = `
    <div class="form-grid">
      <div class="form-field">
        <label>Status da habilitação</label>
        <select id="hab-status" class="form-input" ${canWrite() ? '' : 'disabled'}>
          <option value="Aguardando" ${(licitacao?.habilitacao_status ?? 'Aguardando') === 'Aguardando' ? 'selected' : ''}>Aguardando</option>
          <option value="Habilitado" ${licitacao?.habilitacao_status === 'Habilitado' ? 'selected' : ''}>Habilitado</option>
          <option value="Inabilitado" ${licitacao?.habilitacao_status === 'Inabilitado' ? 'selected' : ''}>Inabilitado</option>
        </select>
      </div>
      <div class="form-field">
        <label>Data da habilitação</label>
        <input type="date" id="hab-data" class="form-input" value="${licitacao?.habilitacao_data || ''}" ${canWrite() ? '' : 'disabled'}>
      </div>
      <div class="form-field">
        <label>Impugnação</label>
        <div class="checkbox-field" style="height:38px;">
          <input type="checkbox" id="hab-impugnacao" ${licitacao?.habilitacao_impugnacao ? 'checked' : ''} ${canWrite() ? '' : 'disabled'} data-action="licitacoes.toggleHabImpugnacao"> Houve impugnação
        </div>
      </div>
      <div class="form-field" id="hab-impugnacao-obs-field" ${licitacao?.habilitacao_impugnacao ? '' : 'hidden'}>
        <label>Obs. impugnação</label>
        <textarea id="hab-impugnacao-obs" class="form-input" rows="2" ${canWrite() ? '' : 'disabled'}>${escapeHtml(licitacao?.habilitacao_impugnacao_obs || '')}</textarea>
      </div>
      <div class="form-field">
        <label>Recurso</label>
        <div class="checkbox-field" style="height:38px;">
          <input type="checkbox" id="hab-recurso" ${licitacao?.habilitacao_recurso ? 'checked' : ''} ${canWrite() ? '' : 'disabled'} data-action="licitacoes.toggleHabRecurso"> Houve recurso
        </div>
      </div>
      <div class="form-field" id="hab-recurso-obs-field" ${licitacao?.habilitacao_recurso ? '' : 'hidden'}>
        <label>Obs. recurso</label>
        <textarea id="hab-recurso-obs" class="form-input" rows="2" ${canWrite() ? '' : 'disabled'}>${escapeHtml(licitacao?.habilitacao_recurso_obs || '')}</textarea>
      </div>
      <div class="form-field span-2">
        <label>Observações gerais</label>
        <textarea id="hab-observacoes" class="form-input" rows="3" ${canWrite() ? '' : 'disabled'}>${escapeHtml(licitacao?.habilitacao_observacoes || '')}</textarea>
      </div>
    </div>
    <div id="hab-docs-section"></div>
  `;

  openModal(`Habilitação — ${escapeHtml(licitacao?.numero_pregao || 'Licitação')}`, bodyHtml, {
    size: 'md',
    footerHtml: canWrite()
      ? `<button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
         <button type="button" class="btn btn-primary" data-action="licitacoes.salvarHabilitacao" data-id="${licitacaoId}">Salvar</button>`
      : `<button type="button" class="btn btn-ghost" data-action="modal.close">Fechar</button>`,
  });
  renderHabDocsSection();
}

async function salvarHabilitacao(target) {
  const licitacaoId = Number(target.dataset.id);
  try {
    await Service.updateLicitacao(licitacaoId, {
      habilitacao_status: byId('hab-status').value,
      habilitacao_data: byId('hab-data').value || null,
      habilitacao_impugnacao: byId('hab-impugnacao').checked,
      habilitacao_impugnacao_obs: byId('hab-impugnacao-obs')?.value.trim() || null,
      habilitacao_recurso: byId('hab-recurso').checked,
      habilitacao_recurso_obs: byId('hab-recurso-obs')?.value.trim() || null,
      habilitacao_observacoes: byId('hab-observacoes').value.trim() || null,
    });
    showToast('Habilitação salva.', 'success');
    closeModal();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar habilitação.', 'error');
  }
}

async function addHabDoc() {
  const nome = byId('hab-novo-doc')?.value.trim();
  if (!nome) return showToast('Informe o nome do documento.', 'error');
  try {
    const doc = await Service.Habilitacao.addDoc({ licitacao_id: _habId, nome, status: 'Pendente' });
    _habDocs.push(doc);
    byId('hab-novo-doc').value = '';
    renderHabDocsSection();
  } catch (err) {
    showToast(err.message || 'Erro ao adicionar documento.', 'error');
  }
}

async function toggleHabDoc(target) {
  const id = Number(target.dataset.id);
  const doc = _habDocs.find((d) => d.id === id);
  if (!doc) return;
  const novoStatus = doc.status === 'Entregue' ? 'Pendente' : 'Entregue';
  try {
    await Service.Habilitacao.updateDoc(id, { status: novoStatus });
    doc.status = novoStatus;
    renderHabDocsSection();
  } catch (err) {
    showToast(err.message || 'Erro ao atualizar documento.', 'error');
  }
}

async function removerHabDoc(target) {
  const id = Number(target.dataset.id);
  try {
    await Service.Habilitacao.deleteDoc(id);
    _habDocs = _habDocs.filter((d) => d.id !== id);
    renderHabDocsSection();
  } catch (err) {
    showToast(err.message || 'Erro ao remover documento.', 'error');
  }
}

// ─── Monitoramento ────────────────────────────────────────────────────────────

function renderMonTarefasSection() {
  const el = document.getElementById('mon-tarefas-section');
  if (!el) return;
  const total = _monTarefas.length;
  const concluidas = _monTarefas.filter((t) => t.concluida).length;
  const pct = total > 0 ? Math.round(concluidas / total * 100) : 0;

  el.innerHTML = `
    <div class="form-section-title" style="margin-top:16px; display:flex; justify-content:space-between; align-items:center;">
      <span>Checklist de tarefas</span>
      ${total > 0 ? `<span style="font-size:12px; font-weight:400; color:var(--gray-500);">${concluidas}/${total} (${pct}%)</span>` : ''}
    </div>
    ${total > 0 ? `
      <div style="background:var(--gray-100); height:4px; border-radius:4px; margin-bottom:10px;">
        <div style="background:var(--green-500); height:4px; border-radius:4px; width:${pct}%;"></div>
      </div>
    ` : ''}
    ${total ? `
      <div class="check-list">
        ${_monTarefas.map((t) => `
          <div class="check-list-item">
            <input type="checkbox" ${t.concluida ? 'checked' : ''}
              data-action="licitacoes.toggleMonTarefa" data-id="${t.id}"
              ${!canWrite() ? 'disabled' : ''}>
            <span style="${t.concluida ? 'text-decoration:line-through; color:var(--gray-400);' : ''}">${escapeHtml(t.descricao)}</span>
            ${canWrite() ? `<button type="button" class="icon-btn" data-action="licitacoes.removerMonTarefa" data-id="${t.id}">${ICONS.trash}</button>` : ''}
          </div>
        `).join('')}
      </div>
    ` : '<p style="font-size:13px; color:var(--gray-400); margin:8px 0;">Nenhuma tarefa cadastrada.</p>'}
    ${canWrite() ? `
      <div style="display:flex; gap:8px; margin-top:8px;">
        <input type="text" id="mon-nova-tarefa" class="form-input" placeholder="Descrição da tarefa..." style="flex:1;">
        <button class="btn btn-ghost btn-sm" data-action="licitacoes.addMonTarefa">+ Adicionar</button>
      </div>
    ` : ''}
  `;
}

function renderMonHistoricoSection() {
  const el = document.getElementById('mon-historico-section');
  if (!el) return;
  el.innerHTML = `
    <div class="form-section-title" style="margin-top:16px;">Histórico de atualizações</div>
    ${_monHistorico.length ? `
      <div class="alert-list">
        ${_monHistorico.map((h) => `
          <div class="alert-row">
            <div class="alert-row-body">
              <div class="alert-row-title">${escapeHtml(h.descricao)}</div>
              <div class="alert-row-meta">${formatDate(h.data_registro)}</div>
            </div>
            ${canWrite() ? `<button type="button" class="icon-btn" data-action="licitacoes.removerMonHistorico" data-id="${h.id}">${ICONS.trash}</button>` : ''}
          </div>
        `).join('')}
      </div>
    ` : '<p style="font-size:13px; color:var(--gray-400); margin:8px 0;">Nenhuma atualização registrada.</p>'}
    ${canWrite() ? `
      <div style="display:flex; gap:8px; margin-top:8px;">
        <input type="date" id="mon-hist-data" class="form-input" value="${new Date().toISOString().slice(0, 10)}" style="width:150px;">
        <input type="text" id="mon-hist-desc" class="form-input" placeholder="Descrição..." style="flex:1;">
        <button class="btn btn-ghost btn-sm" data-action="licitacoes.addMonHistorico">+ Registrar</button>
      </div>
    ` : ''}
  `;
}

async function abrirMonitoramento(target) {
  const licitacaoId = Number(target.dataset.id);
  const licitacao = cache.find((l) => l.id === licitacaoId);
  _monId = licitacaoId;
  [_monTarefas, _monHistorico] = await Promise.all([
    Service.Monitoramento.listTarefas(licitacaoId),
    Service.Monitoramento.listHistorico(licitacaoId),
  ]);

  const curStatus = licitacao?.monitoramento_status || 'Em andamento';
  const bodyHtml = `
    <div class="form-grid">
      <div class="form-field span-2">
        <label>Status geral</label>
        <select id="mon-status" class="form-input" style="max-width:240px;" ${canWrite() ? '' : 'disabled'}>
          <option value="Em andamento" ${curStatus === 'Em andamento' ? 'selected' : ''}>Em andamento</option>
          <option value="Encerrado" ${curStatus === 'Encerrado' ? 'selected' : ''}>Encerrado</option>
          <option value="Suspenso" ${curStatus === 'Suspenso' ? 'selected' : ''}>Suspenso</option>
        </select>
      </div>
    </div>
    <div id="mon-tarefas-section"></div>
    <div id="mon-historico-section"></div>
    ${canWrite() ? `
      <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--gray-100);">
        <button type="button" class="btn btn-ghost btn-sm" data-action="licitacoes.lembrete" data-id="${licitacaoId}">+ Criar lembrete na Agenda</button>
      </div>
    ` : ''}
  `;

  openModal(`Monitoramento — ${escapeHtml(licitacao?.numero_pregao || 'Licitação')}`, bodyHtml, {
    size: 'md',
    footerHtml: canWrite()
      ? `<button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
         <button type="button" class="btn btn-primary" data-action="licitacoes.salvarMonitoramento" data-id="${licitacaoId}">Salvar status</button>`
      : `<button type="button" class="btn btn-ghost" data-action="modal.close">Fechar</button>`,
  });
  renderMonTarefasSection();
  renderMonHistoricoSection();
}

async function salvarMonitoramento(target) {
  const licitacaoId = Number(target.dataset.id);
  try {
    await Service.updateLicitacao(licitacaoId, {
      monitoramento_status: byId('mon-status').value,
    });
    showToast('Monitoramento atualizado.', 'success');
    closeModal();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar monitoramento.', 'error');
  }
}

async function addMonTarefa() {
  const descricao = byId('mon-nova-tarefa')?.value.trim();
  if (!descricao) return showToast('Informe a descrição da tarefa.', 'error');
  try {
    const t = await Service.Monitoramento.addTarefa({ licitacao_id: _monId, descricao });
    _monTarefas.push(t);
    byId('mon-nova-tarefa').value = '';
    renderMonTarefasSection();
  } catch (err) {
    showToast(err.message || 'Erro ao adicionar tarefa.', 'error');
  }
}

async function toggleMonTarefa(target) {
  const id = Number(target.dataset.id);
  const t = _monTarefas.find((x) => x.id === id);
  if (!t) return;
  try {
    await Service.Monitoramento.updateTarefa(id, { concluida: !t.concluida });
    t.concluida = !t.concluida;
    renderMonTarefasSection();
  } catch (err) {
    showToast(err.message || 'Erro ao atualizar tarefa.', 'error');
  }
}

async function removerMonTarefa(target) {
  const id = Number(target.dataset.id);
  try {
    await Service.Monitoramento.deleteTarefa(id);
    _monTarefas = _monTarefas.filter((x) => x.id !== id);
    renderMonTarefasSection();
  } catch (err) {
    showToast(err.message || 'Erro ao remover tarefa.', 'error');
  }
}

async function addMonHistorico() {
  const descricao = byId('mon-hist-desc')?.value.trim();
  const data_registro = byId('mon-hist-data')?.value;
  if (!descricao) return showToast('Informe a descrição.', 'error');
  try {
    const h = await Service.Monitoramento.addHistorico({ licitacao_id: _monId, data_registro, descricao });
    _monHistorico.unshift(h);
    byId('mon-hist-desc').value = '';
    renderMonHistoricoSection();
  } catch (err) {
    showToast(err.message || 'Erro ao registrar histórico.', 'error');
  }
}

async function removerMonHistorico(target) {
  const id = Number(target.dataset.id);
  try {
    await Service.Monitoramento.deleteHistorico(id);
    _monHistorico = _monHistorico.filter((x) => x.id !== id);
    renderMonHistoricoSection();
  } catch (err) {
    showToast(err.message || 'Erro ao remover histórico.', 'error');
  }
}

async function excluir(target) {
  const id = Number(target.dataset.id);
  const ok = await confirmDialog('Tem certeza que deseja excluir esta licitação e todos os seus itens?');
  if (!ok) return;
  try {
    await Service.deleteLicitacao(id);
    showToast('Licitação excluída.', 'success');
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao excluir licitação.', 'error');
  }
}

export const actions = {
  'licitacoes.novo': () => abrirFormulario(null),
  'licitacoes.editar': (target) => abrirFormulario(Number(target.dataset.id)),
  'licitacoes.excluir': (target) => excluir(target),
  'licitacoes.addItem': () => addItem(),
  'licitacoes.removerItem': (target) => removerItem(target),
  'licitacoes.salvar': () => salvar(),
  'licitacoes.toggleItens': (target) => toggleItens(target),
  'licitacoes.tags': (target) => abrirTags(Number(target.dataset.id)),
  'licitacoes.criarTag': (target) => criarTag(target),
  'licitacoes.salvarTags': (target) => salvarTags(target),
  'licitacoes.lembrete': (target) => abrirLembrete(target),
  'licitacoes.salvarLembrete': (target) => salvarLembrete(target),
  'licitacoes.resultado': (target) => abrirResultado(target),
  'licitacoes.salvarResultado': () => salvarResultado(),
  'licitacoes.limparFiltros': () => {
    ['lic-filtro-busca','lic-filtro-uf','lic-filtro-modalidade','lic-filtro-orgao',
      'lic-filtro-status','lic-filtro-tag','lic-filtro-data-ini','lic-filtro-data-fim',
      'lic-filtro-hab','lic-filtro-mon'].forEach((id) => {
      const el = byId(id);
      if (el) el.tagName === 'INPUT' ? (el.value = '') : (el.selectedIndex = 0);
    });
    renderCards();
  },
  'licitacoes.habilitacao': (target) => abrirHabilitacao(target),
  'licitacoes.salvarHabilitacao': (target) => salvarHabilitacao(target),
  'licitacoes.toggleHabImpugnacao': () => { const c = byId('hab-impugnacao')?.checked; byId('hab-impugnacao-obs-field')?.toggleAttribute('hidden', !c); },
  'licitacoes.toggleHabRecurso': () => { const c = byId('hab-recurso')?.checked; byId('hab-recurso-obs-field')?.toggleAttribute('hidden', !c); },
  'licitacoes.addHabDoc': () => addHabDoc(),
  'licitacoes.toggleHabDoc': (target) => toggleHabDoc(target),
  'licitacoes.removerHabDoc': (target) => removerHabDoc(target),
  'licitacoes.monitoramento': (target) => abrirMonitoramento(target),
  'licitacoes.salvarMonitoramento': (target) => salvarMonitoramento(target),
  'licitacoes.addMonTarefa': () => addMonTarefa(),
  'licitacoes.toggleMonTarefa': (target) => toggleMonTarefa(target),
  'licitacoes.removerMonTarefa': (target) => removerMonTarefa(target),
  'licitacoes.addMonHistorico': () => addMonHistorico(),
  'licitacoes.removerMonHistorico': (target) => removerMonHistorico(target),
};
