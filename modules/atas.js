import * as Service from '../supabase-service.js';
import { getState, canWrite, isAdmin } from '../state.js';
import { byId, escapeHtml, formatDate, formatCurrency, parseNumber, todayISO, alertLevel, calcSaldoAtaItem } from '../helpers.js';
import { openModal, closeModal, confirmDialog, showToast, badge, renderEmptyState } from '../ui.js';
import { TIPOS_ATA, SITUACOES_ATA, STATUS_COLOR, ICONS } from '../constants.js';

let pageContainer = null;
let view = 'list';
let cache = [];
let licitacoesLite = [];

let currentAta = null;
let currentItens = [];
let consumosByItem = new Map();
let expandedItemId = null;

export async function render(container) {
  pageContainer = container;
  view = 'list';
  await renderListView();
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
        <h1>Atas e Empenhos</h1>
        <p>Atas de registro de preço e empenhos ganhos, com saldo e consumo por item.</p>
      </div>
      ${canWrite() ? `<button class="btn btn-primary" data-action="atas.novo">${ICONS.plus}Nova Ata/Empenho</button>` : ''}
    </div>
    <div class="card table-wrap"><div id="ata-table-container"></div></div>
  `;
  renderTable();
}

function renderTable() {
  const wrap = byId('ata-table-container');
  if (!cache.length) {
    wrap.innerHTML = renderEmptyState('Nenhuma ata ou empenho cadastrado.');
    return;
  }
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Nº / Tipo</th><th>Órgão</th><th>Vigência</th><th>Situação</th><th>Valor Total</th><th></th></tr></thead>
      <tbody>
        ${cache.map((a) => {
          const alert = a.situacao === 'Vigente' ? alertLevel(a.vigencia_fim) : null;
          return `
          <tr>
            <td><strong>${escapeHtml(a.numero_ata)}</strong><br/><span style="color:var(--gray-500); font-size:12px;">${a.tipo}</span></td>
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
        <div class="form-field"><label>Nº da Ata/Empenho *</label><input required id="f-numero-ata" value="${escapeHtml(ata.numero_ata || '')}" /></div>
        <div class="form-field"><label>Tipo</label><select id="f-tipo">${TIPOS_ATA.map((t) => `<option ${t === ata.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="form-field"><label>Licitação relacionada</label><select id="f-licitacao-id"><option value="">Selecione (opcional)</option>${licitacoesOptions}</select></div>
        <div class="form-field"><label>Órgão</label><select id="f-orgao-id"><option value="">Selecione...</option>${orgaosOptions}</select></div>
        <div class="form-field"><label>Data de Assinatura</label><input type="date" id="f-data-assinatura" value="${ata.data_assinatura || ''}" /></div>
        <div class="form-field"><label>Situação</label><select id="f-situacao">${SITUACOES_ATA.map((s) => `<option ${s === ata.situacao ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="form-field"><label>Vigência início</label><input type="date" id="f-vigencia-inicio" value="${ata.vigencia_inicio || ''}" /></div>
        <div class="form-field"><label>Vigência fim</label><input type="date" id="f-vigencia-fim" value="${ata.vigencia_fim || ''}" /></div>
        <div class="form-field"><label>Valor Total</label><input id="f-valor-total" value="${ata.valor_total ?? ''}" /></div>
        <div class="form-field span-2"><label>Observações</label><textarea id="f-observacoes">${escapeHtml(ata.observacoes || '')}</textarea></div>
      </div>
    </form>
  `;

  openModal(ataId ? 'Editar Ata/Empenho' : 'Nova Ata/Empenho', bodyHtml, {
    size: 'md',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="atas.salvarHeader" data-id="${ataId || ''}">Salvar</button>
    `,
  });
}

async function salvarHeader(target) {
  const ataId = target.dataset.id ? Number(target.dataset.id) : null;
  const payload = {
    numero_ata: byId('f-numero-ata').value.trim(),
    tipo: byId('f-tipo').value,
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
    showToast('Informe o número da ata/empenho.', 'error');
    return;
  }
  try {
    let saved;
    if (ataId) {
      saved = await Service.updateAta(ataId, payload);
    } else {
      saved = await Service.createAta(payload);
    }
    showToast('Ata/Empenho salvo com sucesso.', 'success');
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
  const ok = await confirmDialog('Excluir esta ata/empenho e todos os seus itens e lançamentos de consumo?');
  if (!ok) return;
  try {
    await Service.deleteAta(id);
    showToast('Ata/Empenho excluído.', 'success');
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
  await reloadItensEConsumos();

  pageContainer.innerHTML = `
    <div class="page-header">
      <div>
        <h1>${escapeHtml(currentAta.numero_ata)}</h1>
        <p>${escapeHtml(currentAta.orgao?.nome || 'Órgão não informado')} · ${currentAta.tipo} · Vigência ${formatDate(currentAta.vigencia_inicio)} a ${formatDate(currentAta.vigencia_fim)}</p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost" data-action="atas.voltarLista">Voltar</button>
        ${canWrite() ? `<button class="btn btn-ghost" data-action="atas.editarHeader" data-id="${currentAta.id}">${ICONS.edit} Editar dados</button>` : ''}
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Situação</div><div class="stat-value" style="font-size:18px;">${badge(currentAta.situacao, STATUS_COLOR[currentAta.situacao] || 'muted')}</div></div>
      <div class="stat-card"><div class="stat-label">Valor Total</div><div class="stat-value">${formatCurrency(currentAta.valor_total)}</div></div>
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

async function reloadItensEConsumos() {
  currentItens = await Service.listAtaItens(currentAta.id);
  const ids = currentItens.map((i) => i.id);
  const consumos = await Service.listConsumosByItens(ids);
  consumosByItem = new Map();
  for (const c of consumos) {
    const arr = consumosByItem.get(c.ata_item_id) || [];
    arr.push(c);
    consumosByItem.set(c.ata_item_id, arr);
  }
}

function renderItensSection() {
  const wrap = byId('ata-itens-container');
  if (!currentItens.length) {
    wrap.innerHTML = renderEmptyState('Nenhum item adicionado a esta ata.');
    return;
  }

  wrap.innerHTML = currentItens.map((item) => {
    const consumos = consumosByItem.get(item.id) || [];
    const saldo = calcSaldoAtaItem(item, consumos);
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
              Consumido ${saldo.consumido} de ${item.quantidade_total} (${saldo.percentual.toFixed(0)}%) · Restante ${saldo.restante}
            </div>
          </div>
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm" data-action="atas.toggleConsumo" data-item-id="${item.id}">${expanded ? 'Ocultar' : 'Lançamentos'} (${consumos.length})</button>
            ${canWrite() ? `<button class="icon-btn" data-action="atas.editarItem" data-item-id="${item.id}" title="Editar item">${ICONS.edit}</button>` : ''}
            ${canWrite() ? `<button class="icon-btn" data-action="atas.excluirItem" data-item-id="${item.id}" title="Excluir item">${ICONS.trash}</button>` : ''}
          </div>
        </div>
        ${expanded ? renderConsumoPanel(item, consumos) : ''}
      </div>
    `;
  }).join('');
}

function renderConsumoPanel(item, consumos) {
  return `
    <div class="consumo-panel" style="margin-top:14px; padding-top:14px; border-top:1px solid var(--gray-200);">
      ${consumos.length ? `
        <table class="data-table" style="margin-bottom:12px;">
          <thead><tr><th>Data</th><th>Quantidade</th><th>Nº Empenho</th><th>Observação</th><th></th></tr></thead>
          <tbody>
            ${consumos.map((c) => `
              <tr>
                <td>${formatDate(c.data_compra)}</td>
                <td>${c.quantidade}</td>
                <td>${escapeHtml(c.numero_empenho || '-')}</td>
                <td>${escapeHtml(c.observacao || '-')}</td>
                <td class="row-actions">${canWrite() ? `<button class="icon-btn" data-action="atas.excluirConsumo" data-consumo-id="${c.id}" data-item-id="${item.id}">${ICONS.trash}</button>` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : renderEmptyState('Nenhuma compra/empenho lançado ainda.')}

      ${canWrite() ? `
        <div class="form-grid cols-3" style="align-items:end;">
          <div class="form-field"><label>Data da compra</label><input type="date" id="novo-consumo-data-${item.id}" value="${todayISO()}" /></div>
          <div class="form-field"><label>Quantidade</label><input type="text" id="novo-consumo-qtd-${item.id}" placeholder="0" /></div>
          <div class="form-field"><label>Nº Empenho</label><input type="text" id="novo-consumo-empenho-${item.id}" /></div>
          <div class="form-field span-2"><label>Observação</label><input type="text" id="novo-consumo-obs-${item.id}" /></div>
          <div class="form-field"><button type="button" class="btn btn-primary" data-action="atas.addConsumo" data-item-id="${item.id}">${ICONS.plus} Lançar</button></div>
        </div>` : ''}
    </div>
  `;
}

function toggleConsumo(target) {
  const itemId = Number(target.dataset.itemId);
  expandedItemId = expandedItemId === itemId ? null : itemId;
  renderItensSection();
}

async function addConsumo(target) {
  const itemId = Number(target.dataset.itemId);
  const quantidade = parseNumber(byId(`novo-consumo-qtd-${itemId}`).value);
  if (!quantidade) {
    showToast('Informe a quantidade da compra.', 'error');
    return;
  }
  try {
    await Service.addConsumo({
      ata_item_id: itemId,
      data_compra: byId(`novo-consumo-data-${itemId}`).value || todayISO(),
      quantidade,
      numero_empenho: byId(`novo-consumo-empenho-${itemId}`).value.trim() || null,
      observacao: byId(`novo-consumo-obs-${itemId}`).value.trim() || null,
    });
    showToast('Consumo lançado.', 'success');
    expandedItemId = itemId;
    await reloadItensEConsumos();
    renderItensSection();
  } catch (err) {
    showToast(err.message || 'Erro ao lançar consumo.', 'error');
  }
}

async function excluirConsumo(target) {
  const ok = await confirmDialog('Remover este lançamento de consumo?');
  if (!ok) return;
  const itemId = Number(target.dataset.itemId);
  try {
    await Service.deleteConsumo(Number(target.dataset.consumoId));
    expandedItemId = itemId;
    await reloadItensEConsumos();
    renderItensSection();
  } catch (err) {
    showToast(err.message || 'Erro ao remover consumo.', 'error');
  }
}

// ---------------- Item da ata (modal) ----------------
async function abrirFormularioItem(itemId) {
  let item = { produto_descricao: '', quantidade_total: '', valor_unitario: '' };
  if (itemId) item = currentItens.find((i) => i.id === itemId) || item;

  const produtos = getState().lookups.produtos;
  const bodyHtml = `
    <div class="form-grid">
      <div class="form-field span-2"><label>Produto</label><input id="f-item-produto" list="produtos-list-ata" value="${escapeHtml(item.produto_descricao || '')}" /></div>
      <div class="form-field"><label>Quantidade total</label><input id="f-item-qtd" value="${item.quantidade_total ?? ''}" /></div>
      <div class="form-field"><label>Valor unitário</label><input id="f-item-valor" value="${item.valor_unitario ?? ''}" /></div>
    </div>
    <datalist id="produtos-list-ata">${produtos.map((p) => `<option value="${escapeHtml(p.nome)}"></option>`).join('')}</datalist>
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
  const payload = {
    ata_id: currentAta.id,
    produto_descricao: byId('f-item-produto').value.trim() || null,
    quantidade_total: parseNumber(byId('f-item-qtd').value),
    valor_unitario: parseNumber(byId('f-item-valor').value),
  };
  try {
    if (itemId) await Service.updateAtaItem(itemId, payload);
    else await Service.createAtaItem(payload);
    showToast('Item salvo.', 'success');
    closeModal();
    await reloadItensEConsumos();
    renderItensSection();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar item.', 'error');
  }
}

async function excluirItem(target) {
  const ok = await confirmDialog('Excluir este item e todo o histórico de consumo associado?');
  if (!ok) return;
  try {
    await Service.deleteAtaItem(Number(target.dataset.itemId));
    await reloadItensEConsumos();
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
  'atas.toggleConsumo': (target) => toggleConsumo(target),
  'atas.addConsumo': (target) => addConsumo(target),
  'atas.excluirConsumo': (target) => excluirConsumo(target),
};
