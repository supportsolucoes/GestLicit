import * as Service from '../supabase-service.js';
import { getState, canWrite, isAdmin } from '../state.js';
import { byId, escapeHtml, formatDate, formatCurrency, formatMoneyInputValue, parseNumber, alertLevel, sumBy, calcSaldoAtaItemPorEmpenho } from '../helpers.js';
import { openModal, closeModal, confirmDialog, showToast, badge, renderEmptyState } from '../ui.js';
import { SITUACOES_ATA, STATUS_COLOR, ICONS } from '../constants.js';

let pageContainer = null;
let view = 'list';
let cache = [];
let licitacoesLite = [];
let activeFilter = null;

let currentAta = null;
let currentItens = [];
let empenhosByProduto = new Map();
let expandedItemId = null;

export async function render(container, params) {
  pageContainer = container;
  if (params?.openId) {
    view = 'detail';
    await renderDetailView(params.openId);
    return;
  }
  activeFilter = params?.filter || null;
  view = 'list';
  await renderListView();
}

function limparFiltro() {
  render(pageContainer);
}

function filteredCache() {
  if (!activeFilter) return cache;
  return cache.filter((r) => String(r[activeFilter.key]) === String(activeFilter.value));
}

// ============================================================
// LISTA
// ============================================================
async function renderListView() {
  view = 'list';
  cache = await Service.listAtas();
  pageContainer.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Atas</h1>
        <p>Atas de registro de preço ganhas, com saldo calculado a partir dos Empenhos vinculados.</p>
      </div>
      ${canWrite() ? `<button class="btn btn-primary" data-action="atas.novo">${ICONS.plus}Nova Ata</button>` : ''}
    </div>
    ${activeFilter ? `
      <div class="card filter-banner">
        <span>Filtrando por: ${escapeHtml(activeFilter.label || '')}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-action="atas.limparFiltro">Limpar filtro</button>
      </div>
    ` : ''}
    <div class="card table-wrap"><div id="ata-table-container"></div></div>
  `;
  renderTable();
}

function renderTable() {
  const wrap = byId('ata-table-container');
  const lista = filteredCache();
  if (!lista.length) {
    wrap.innerHTML = renderEmptyState(activeFilter ? 'Nenhuma ata encontrada para este filtro.' : 'Nenhuma ata cadastrada.');
    return;
  }
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Nº da Ata</th><th>Órgão</th><th>Vigência</th><th>Situação</th><th>Valor Total</th><th></th></tr></thead>
      <tbody>
        ${lista.map((a) => {
          const alert = a.situacao === 'Vigente' ? alertLevel(a.vigencia_fim) : null;
          return `
          <tr>
            <td><strong>${escapeHtml(a.numero_ata)}</strong></td>
            <td>${escapeHtml(a.orgao?.nome || '-')}</td>
            <td>${formatDate(a.vigencia_inicio)} – ${formatDate(a.vigencia_fim)}
              ${alert ? `<br/>${badge(alert.level === 'vencido' ? 'Vencido' : `Vence em ${alert.days}d`, alert.level === 'vencido' ? 'danger' : 'warning')}` : ''}
            </td>
            <td>${badge(a.situacao, STATUS_COLOR[a.situacao] || 'muted')}</td>
            <td>${formatCurrency(a.valor_total)}</td>
            <td class="row-actions">
              <button class="icon-btn" data-action="atas.verItens" data-id="${a.id}" title="Itens e saldo">${ICONS.atas}</button>
              <button class="icon-btn" data-action="atas.editarHeader" data-id="${a.id}" title="Editar">${ICONS.edit}</button>
              ${isAdmin() ? `<button class="icon-btn" data-action="atas.excluir" data-id="${a.id}" title="Excluir">${ICONS.trash}</button>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

// ============================================================
// MODAL — Dados da Ata (cabeçalho)
// ============================================================
async function abrirFormularioHeader(ataId) {
  if (!licitacoesLite.length) licitacoesLite = await Service.listLicitacoes();
  let ata = {
    numero_ata: '', tipo: 'ATA', licitacao_id: '', orgao_id: '', data_assinatura: '',
    vigencia_inicio: '', vigencia_fim: '', valor_total: '', situacao: 'Vigente', observacoes: '',
  };
  if (ataId) ata = cache.find((a) => a.id === ataId) || await Service.getAta(ataId);

  const orgaosOptions = getState().lookups.orgaos
    .map((o) => `<option value="${o.id}" ${String(o.id) === String(ata.orgao_id) ? 'selected' : ''}>${escapeHtml(o.nome)}</option>`).join('');
  const licitacoesOptions = licitacoesLite
    .map((l) => `<option value="${l.id}" ${String(l.id) === String(ata.licitacao_id) ? 'selected' : ''}>${escapeHtml(l.numero_pregao)}</option>`).join('');

  const bodyHtml = `
    <form id="ata-form">
      <div class="form-grid">
        <div class="form-field"><label>Nº da Ata *</label><input required id="f-numero-ata" value="${escapeHtml(ata.numero_ata || '')}" /></div>
        <div class="form-field"><label>Licitação relacionada</label><select id="f-licitacao-id"><option value="">Selecione (opcional)</option>${licitacoesOptions}</select></div>
        <div class="form-field"><label>Órgão</label><select id="f-orgao-id"><option value="">Selecione...</option>${orgaosOptions}</select></div>
        <div class="form-field"><label>Data de Assinatura</label><input type="date" id="f-data-assinatura" value="${ata.data_assinatura || ''}" /></div>
        <div class="form-field"><label>Situação</label><select id="f-situacao">${SITUACOES_ATA.map((s) => `<option ${s === ata.situacao ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="form-field"><label>Vigência início</label><input type="date" id="f-vigencia-inicio" value="${ata.vigencia_inicio || ''}" /></div>
        <div class="form-field"><label>Vigência fim</label><input type="date" id="f-vigencia-fim" value="${ata.vigencia_fim || ''}" /></div>
        <div class="form-field"><label>Valor Total</label><div class="input-currency-wrap"><input id="f-valor-total" value="${formatMoneyInputValue(ata.valor_total)}" placeholder="0,00" /></div></div>
        <div class="form-field span-2"><label>Observações</label><textarea id="f-observacoes">${escapeHtml(ata.observacoes || '')}</textarea></div>
      </div>
    </form>
  `;

  openModal(ataId ? 'Editar Ata' : 'Nova Ata', bodyHtml, {
    size: 'md',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="atas.salvarHeader" data-id="${ataId || ''}">Salvar</button>
    `,
  });
}

async function salvarHeader(target) {
  const ataId = target.dataset.id ? Number(target.dataset.id) : null;
  const existente = ataId ? cache.find((a) => a.id === ataId) : null;
  const payload = {
    numero_ata: byId('f-numero-ata').value.trim(),
    tipo: existente?.tipo || 'ATA',
    licitacao_id: byId('f-licitacao-id').value || null,
    orgao_id: byId('f-orgao-id').value || null,
    data_assinatura: byId('f-data-assinatura').value || null,
    vigencia_inicio: byId('f-vigencia-inicio').value || null,
    vigencia_fim: byId('f-vigencia-fim').value || null,
    valor_total: parseNumber(byId('f-valor-total').value),
    situacao: byId('f-situacao').value,
    observacoes: byId('f-observacoes').value.trim() || null,
  };
  if (!payload.numero_ata) {
    showToast('Informe o número da ata.', 'error');
    return;
  }
  try {
    let saved;
    if (ataId) {
      saved = await Service.updateAta(ataId, payload);
    } else {
      saved = await Service.createAta(payload);
    }
    showToast('Ata salva com sucesso.', 'success');
    closeModal();
    if (ataId) {
      await renderListView();
    } else {
      await renderDetailView(saved.id);
    }
  } catch (err) {
    showToast(err.message || 'Erro ao salvar.', 'error');
  }
}

async function excluirAta(target) {
  const id = Number(target.dataset.id);
  const ok = await confirmDialog('Excluir esta ata e todos os seus itens?');
  if (!ok) return;
  try {
    await Service.deleteAta(id);
    showToast('Ata excluída.', 'success');
    await renderListView();
  } catch (err) {
    showToast(err.message || 'Erro ao excluir.', 'error');
  }
}

// ============================================================
// DETALHE — Itens, saldo e consumo
// ============================================================
async function renderDetailView(ataId) {
  view = 'detail';
  expandedItemId = null;
  currentAta = cache.find((a) => a.id === ataId) || await Service.getAta(ataId);
  await reloadItensEEmpenhos();

  const totalQtd = sumBy(currentItens, (i) => i.quantidade_total);
  const totalEmpenhado = sumBy(currentItens, (i) => sumBy(empenhosByProduto.get(String(i.produto_id)) || [], (e) => e.quantidade_empenhada));
  const percEmpenhado = totalQtd > 0 ? Math.min((totalEmpenhado / totalQtd) * 100, 100) : 0;

  pageContainer.innerHTML = `
    <div class="page-header">
      <div>
        <h1>${escapeHtml(currentAta.numero_ata)}</h1>
        <p>${escapeHtml(currentAta.orgao?.nome || 'Órgão não informado')} · Vigência ${formatDate(currentAta.vigencia_inicio)} a ${formatDate(currentAta.vigencia_fim)}</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-ghost" data-action="atas.voltarLista">Voltar</button>
        ${canWrite() ? `<button class="btn btn-ghost" data-action="atas.editarHeader" data-id="${currentAta.id}">${ICONS.edit} Editar dados</button>` : ''}
        ${currentAta.orgao_id ? `<button class="btn btn-ghost" data-action="nav.go" data-page="contratos" data-filter-key="orgao_id" data-filter-value="${currentAta.orgao_id}" data-filter-label="Órgão ${escapeHtml(currentAta.orgao?.nome || '')}">${ICONS.contratos} Ver Contratos do Órgão</button>` : ''}
        <button class="btn btn-ghost" data-action="nav.go" data-page="empenhos" data-filter-key="ata_id" data-filter-value="${currentAta.id}" data-filter-label="Ata ${escapeHtml(currentAta.numero_ata || '')}">${ICONS.empenhos} Ver Empenhos desta Ata</button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Situação</div><div class="stat-value" style="font-size:18px;">${badge(currentAta.situacao, STATUS_COLOR[currentAta.situacao] || 'muted')}</div></div>
      <div class="stat-card"><div class="stat-label">Valor Total</div><div class="stat-value">${formatCurrency(currentAta.valor_total)}</div></div>
      <div class="stat-card"><div class="stat-label">% Empenhado</div><div class="stat-value">${percEmpenhado.toFixed(0)}%</div></div>
      <div class="stat-card"><div class="stat-label">Itens cadastrados</div><div class="stat-value">${currentItens.length}</div></div>
    </div>

    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <strong>Itens da ata</strong>
        ${canWrite() ? `<button class="btn btn-ghost btn-sm" data-action="atas.novoItem">${ICONS.plus} Adicionar item</button>` : ''}
      </div>
      <div id="ata-itens-container"></div>
    </div>
  `;

  renderItensSection();
}

async function reloadItensEEmpenhos() {
  currentItens = await Service.listAtaItens(currentAta.id);
  const allEmpenhoItens = await Service.listAllEmpenhoItens();
  empenhosByProduto = new Map();
  for (const ei of allEmpenhoItens) {
    if (!ei.empenho || ei.empenho.ata_id !== currentAta.id) continue;
    const key = String(ei.produto_id);
    const arr = empenhosByProduto.get(key) || [];
    arr.push(ei);
    empenhosByProduto.set(key, arr);
  }
}

function renderItensSection() {
  const wrap = byId('ata-itens-container');
  if (!currentItens.length) {
    wrap.innerHTML = renderEmptyState('Nenhum item adicionado a esta ata.');
    return;
  }

  wrap.innerHTML = currentItens.map((item) => {
    const empenhoItens = empenhosByProduto.get(String(item.produto_id)) || [];
    const saldo = calcSaldoAtaItemPorEmpenho(item, empenhoItens);
    const expanded = expandedItemId === item.id;
    return `
      <div class="card" style="margin-bottom:12px; box-shadow:none; border:1px solid var(--gray-200);">
        <div style="display:flex; justify-content:space-between; gap:14px; flex-wrap:wrap; align-items:center;">
          <div style="min-width:220px;">
            <strong>${escapeHtml(item.produto_descricao || item.produto?.nome || 'Produto não informado')}</strong><br/>
            <span style="color:var(--gray-500); font-size:12.5px;">${formatCurrency(item.valor_unitario)} / unid. · Total: ${formatCurrency(item.valor_unitario * item.quantidade_total)}</span>
          </div>
          <div style="flex:1; min-width:200px;">
            <div class="progress-track"><div class="progress-fill" style="width:${saldo.percentual}%;"></div></div>
            <div style="font-size:12px; color:var(--gray-500); margin-top:4px;">
              Empenhado ${saldo.empenhado} de ${item.quantidade_total} (${saldo.percentual.toFixed(0)}%) · Restante ${saldo.restante}
            </div>
          </div>
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm" data-action="atas.toggleEmpenhos" data-item-id="${item.id}">${expanded ? 'Ocultar' : 'Empenhos vinculados'} (${empenhoItens.length})</button>
            ${canWrite() ? `<button class="icon-btn" data-action="atas.editarItem" data-item-id="${item.id}" title="Editar item">${ICONS.edit}</button>` : ''}
            ${canWrite() ? `<button class="icon-btn" data-action="atas.excluirItem" data-item-id="${item.id}" title="Excluir item">${ICONS.trash}</button>` : ''}
          </div>
        </div>
        ${expanded ? renderEmpenhosPanel(empenhoItens) : ''}
      </div>
    `;
  }).join('');
}

function renderEmpenhosPanel(empenhoItens) {
  return `
    <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--gray-200);">
      ${empenhoItens.length ? `
        <table class="data-table" style="margin-bottom:12px;">
          <thead><tr><th>Nº Empenho</th><th>Data</th><th>Situação</th><th>Quantidade Empenhada</th><th>Valor Unitário</th></tr></thead>
          <tbody>
            ${empenhoItens.map((ei) => `
              <tr>
                <td>${escapeHtml(ei.empenho?.numero_empenho || '-')}</td>
                <td>${formatDate(ei.empenho?.data_empenho)}</td>
                <td>${badge(ei.empenho?.situacao || '-', STATUS_COLOR[ei.empenho?.situacao] || 'muted')}</td>
                <td>${ei.quantidade_empenhada}</td>
                <td>${formatCurrency(ei.valor_unitario)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : renderEmptyState('Nenhum empenho vinculado a este item ainda.')}
      <button type="button" class="btn btn-ghost btn-sm" data-action="nav.go" data-page="empenhos" data-filter-key="ata_id" data-filter-value="${currentAta.id}" data-filter-label="Ata ${escapeHtml(currentAta.numero_ata || '')}">Ir para Empenhos</button>
    </div>
  `;
}

function toggleEmpenhos(target) {
  const itemId = Number(target.dataset.itemId);
  expandedItemId = expandedItemId === itemId ? null : itemId;
  renderItensSection();
}

// ---------------- Item da ata (modal) ----------------
async function abrirFormularioItem(itemId) {
  let item = { produto_id: '', produto_descricao: '', quantidade_total: '', valor_unitario: '' };
  if (itemId) item = currentItens.find((i) => i.id === itemId) || item;

  const produtos = getState().lookups.produtos;
  const bodyHtml = `
    <div class="form-grid">
      <div class="form-field span-2">
        <label>Produto *</label>
        <select required id="f-item-produto-id">
          <option value="">Selecione um produto...</option>
          ${produtos.map((p) => `<option value="${p.id}" ${String(item.produto_id) === String(p.id) ? 'selected' : ''}>${escapeHtml(p.nome)}</option>`).join('')}
        </select>
      </div>
      <div class="form-field"><label>Quantidade total</label><input id="f-item-qtd" value="${item.quantidade_total ?? ''}" /></div>
      <div class="form-field"><label>Valor unitário</label><div class="input-currency-wrap"><input id="f-item-valor" value="${formatMoneyInputValue(item.valor_unitario)}" placeholder="0,00" /></div></div>
    </div>
  `;

  openModal(itemId ? 'Editar Item' : 'Novo Item', bodyHtml, {
    size: 'sm',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="atas.salvarItem" data-item-id="${itemId || ''}">Salvar</button>
    `,
  });
}

async function salvarItem(target) {
  const itemId = target.dataset.itemId ? Number(target.dataset.itemId) : null;
  const produtoId = byId('f-item-produto-id').value;
  if (!produtoId) {
    showToast('Selecione um produto cadastrado para este item.', 'error');
    return;
  }
  const produto = getState().lookups.produtos.find((p) => String(p.id) === String(produtoId));
  const payload = {
    ata_id: currentAta.id,
    produto_id: produtoId,
    produto_descricao: produto?.nome || null,
    quantidade_total: parseNumber(byId('f-item-qtd').value),
    valor_unitario: parseNumber(byId('f-item-valor').value),
  };
  try {
    if (itemId) await Service.updateAtaItem(itemId, payload);
    else await Service.createAtaItem(payload);
    showToast('Item salvo.', 'success');
    closeModal();
    await reloadItensEEmpenhos();
    renderItensSection();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar item.', 'error');
  }
}

async function excluirItem(target) {
  const ok = await confirmDialog('Excluir este item da ata?');
  if (!ok) return;
  try {
    await Service.deleteAtaItem(Number(target.dataset.itemId));
    await reloadItensEEmpenhos();
    renderItensSection();
  } catch (err) {
    showToast(err.message || 'Erro ao excluir item.', 'error');
  }
}

export const actions = {
  'atas.novo': () => abrirFormularioHeader(null),
  'atas.editarHeader': (target) => { closeModal(); abrirFormularioHeader(Number(target.dataset.id)); },
  'atas.salvarHeader': (target) => salvarHeader(target),
  'atas.excluir': (target) => excluirAta(target),
  'atas.verItens': (target) => renderDetailView(Number(target.dataset.id)),
  'atas.voltarLista': () => renderListView(),
  'atas.novoItem': () => abrirFormularioItem(null),
  'atas.editarItem': (target) => abrirFormularioItem(Number(target.dataset.itemId)),
  'atas.salvarItem': (target) => salvarItem(target),
  'atas.excluirItem': (target) => excluirItem(target),
  'atas.toggleEmpenhos': (target) => toggleEmpenhos(target),
  'atas.limparFiltro': () => limparFiltro(),
};
