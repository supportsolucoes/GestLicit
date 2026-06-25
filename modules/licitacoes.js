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

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Licitações</h1>
        <p>Editais disputados, itens, precificação, agenda e resultado.</p>
      </div>
      ${canWrite() ? `<button class="btn btn-primary" data-action="licitacoes.novo">${ICONS.plus}Nova Licitação</button>` : ''}
    </div>

    <div class="card" style="margin-bottom:16px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
      <div class="form-field" style="flex:1; min-width:220px; margin:0;">
        <input type="text" id="lic-filtro-busca" placeholder="Buscar por pregão, processo ou órgão..." />
      </div>
      <div class="form-field" style="margin:0; min-width:160px;">
        <select id="lic-filtro-status">
          <option value="">Todos os status</option>
          ${STATUS_LICITACAO.map((s) => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <div class="form-field" style="margin:0; min-width:150px;">
        <select id="lic-filtro-tag">
          <option value="">Todas as tags</option>
        </select>
      </div>
    </div>

    <div id="lic-cards-container"></div>
  `;

  byId('lic-filtro-busca').addEventListener('input', renderCards);
  byId('lic-filtro-status').addEventListener('change', renderCards);
  byId('lic-filtro-tag').addEventListener('change', renderCards);

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

  populateTagFilterOptions();
  renderCards();
}

function populateTagFilterOptions() {
  const select = byId('lic-filtro-tag');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Todas as tags</option>${getState().lookups.tags.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('')}`;
  select.value = current;
}

function renderCards() {
  const busca = (byId('lic-filtro-busca')?.value || '').toLowerCase();
  const statusFiltro = byId('lic-filtro-status')?.value || '';
  const tagFiltro = byId('lic-filtro-tag')?.value || '';

  const filtradas = cache.filter((l) => {
    if (busca) {
      const haystack = `${l.numero_pregao} ${l.numero_processo || ''} ${l.orgao?.nome || ''}`.toLowerCase();
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
    return true;
  });

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
    ? eventos.slice(0, 4).map((ev) => {
        const dias = daysUntil(ev.data);
        const urgente = dias !== null && dias >= 0 && dias <= 7;
        const vencido = dias !== null && dias < 0;
        const diasLabel = dias === null ? '' : vencido ? 'vencido' : dias === 0 ? 'hoje' : `${dias}d`;
        const diasColor = vencido ? 'var(--danger)' : urgente ? 'var(--warning)' : 'var(--gray-500)';
        return `<div class="lic-agenda-item">
          <div class="lic-agenda-dot"></div>
          <div>
            <strong>${escapeHtml(ev.titulo)}</strong>
            <span>${formatDate(ev.data)}${diasLabel ? ` · <span style="color:${diasColor};font-weight:600;">${diasLabel}</span>` : ''}</span>
          </div>
        </div>`;
      }).join('')
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

async function abrirFormulario(licitacaoId) {
  editingLicitacaoId = licitacaoId || null;
  let licitacao = {
    numero_pregao: '', numero_processo: '', orgao_id: '', uf: '', modalidade: 'Pregão Eletrônico',
    registro_preco: false, valor_total_estimado: '', modo_disputa: '', data_abertura: '', data_sessao: '', hora_sessao: '',
    prazo_entrega: '', prazo_pagamento: '', validade_proposta: '',
    nome_pregoeiro: '', telefone_pregoeiro: '', email_pregoeiro: '', enderecos: '',
    objeto: '', recurso_contrarrazao: false, motivo_rc: '', deferido_indeferido: '', observacoes: '',
  };
  editingItems = [];
  originalItemIds = new Set();

  if (licitacaoId) {
    licitacao = cache.find((l) => l.id === licitacaoId) || await Service.getLicitacao(licitacaoId);
    const itens = await Service.listLicitacaoItens(licitacaoId);
    editingItems = itens.map((it) => ({ ...it }));
    originalItemIds = new Set(itens.map((it) => it.id));
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
}

function renderItemsTable() {
  const wrap = byId('licitacao-itens-table');
  if (!wrap) return;
  const { produtos } = getState().lookups;

  if (!editingItems.length) {
    wrap.innerHTML = renderEmptyState('Nenhum item adicionado.');
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap items-table">
      <table class="data-table">
        <thead>
          <tr>
            <th>Item</th><th>Produto</th><th>Qtd</th><th>Marca/Fabricante</th><th>Modelo/Versão</th>
            <th>Valor Ref.</th><th>Custo</th><th>Margem %</th><th>Valor Mínimo</th><th>Valor Inicial</th><th></th>
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
};
