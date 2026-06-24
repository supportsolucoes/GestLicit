import * as Service from '../supabase-service.js';
import { getState, canWrite, isAdmin } from '../state.js';
import { byId, escapeHtml, formatDate, formatCurrency, parseNumber, sumBy, todayISO, calcSaldoEmpenhoItem } from '../helpers.js';
import { openModal, closeModal, confirmDialog, showToast, badge, renderEmptyState } from '../ui.js';
import { SITUACOES_EMPENHO, STATUS_COLOR, ICONS } from '../constants.js';

let cache = [];
let atasLite = [];
let contratosLite = [];
let editingItems = [];
let originalItemIds = new Set();
let editingEmpenhoId = null;
let itensByEmpenho = new Map();
let entregasByItemId = new Map();
let expandedEntregaItemId = null;

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Empenhos</h1>
        <p>Compromissos orçamentários firmados a partir de uma Ata, de um Contrato, ou diretos.</p>
      </div>
      ${canWrite() ? `<button class="btn btn-primary" data-action="empenhos.novo">${ICONS.plus}Novo Empenho</button>` : ''}
    </div>
    <div class="card table-wrap"><div id="empenho-table-container"></div></div>
  `;
  await reload();
}

async function reload() {
  const [empenhos, allItens, allEntregas] = await Promise.all([
    Service.listEmpenhos(), Service.listAllEmpenhoItens(), Service.listAllEntregas(),
  ]);
  cache = empenhos;

  itensByEmpenho = new Map();
  for (const item of allItens) {
    const arr = itensByEmpenho.get(item.empenho_id) || [];
    arr.push(item);
    itensByEmpenho.set(item.empenho_id, arr);
  }

  entregasByItemId = new Map();
  for (const ent of allEntregas) {
    const arr = entregasByItemId.get(ent.empenho_item_id) || [];
    arr.push(ent);
    entregasByItemId.set(ent.empenho_item_id, arr);
  }

  renderTable();
}

function origemLabel(e) {
  if (e.ata?.numero_ata) return `Ata ${e.ata.numero_ata}`;
  if (e.contrato?.numero_contrato) return `Contrato ${e.contrato.numero_contrato}`;
  return 'Direto (sem vínculo)';
}

function saldoEmpenho(empenhoId) {
  const itens = itensByEmpenho.get(empenhoId) || [];
  const totalEmpenhado = sumBy(itens, (i) => i.quantidade_empenhada);
  const totalEntregue = sumBy(itens, (i) => calcSaldoEmpenhoItem(i, entregasByItemId.get(i.id) || []).entregue);
  const percentual = totalEmpenhado > 0 ? Math.min((totalEntregue / totalEmpenhado) * 100, 100) : 0;
  return { totalEmpenhado, totalEntregue, percentual };
}

function renderTable() {
  const wrap = byId('empenho-table-container');
  if (!cache.length) {
    wrap.innerHTML = renderEmptyState('Nenhum empenho cadastrado.');
    return;
  }
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Nº Empenho</th><th>Origem</th><th>Órgão</th><th>Data</th><th>Situação</th><th>Valor Empenhado</th><th>% Entregue</th><th></th></tr></thead>
      <tbody>
        ${cache.map((e) => {
          const saldo = saldoEmpenho(e.id);
          return `
          <tr>
            <td><strong>${escapeHtml(e.numero_empenho)}</strong></td>
            <td>${escapeHtml(origemLabel(e))}</td>
            <td>${escapeHtml(e.orgao?.nome || '-')}</td>
            <td>${formatDate(e.data_empenho)}</td>
            <td>${badge(e.situacao, STATUS_COLOR[e.situacao] || 'muted')}</td>
            <td>${formatCurrency(e.valor_empenhado)}</td>
            <td>${saldo.totalEmpenhado > 0 ? `${saldo.percentual.toFixed(0)}% <span style="color:var(--gray-500); font-size:11.5px;">(${saldo.totalEntregue}/${saldo.totalEmpenhado})</span>` : '-'}</td>
            <td class="row-actions">
              <button class="icon-btn" data-action="empenhos.editar" data-id="${e.id}" title="Editar">${ICONS.edit}</button>
              ${isAdmin() ? `<button class="icon-btn" data-action="empenhos.excluir" data-id="${e.id}" title="Excluir">${ICONS.trash}</button>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

async function abrirFormulario(empenhoId) {
  editingEmpenhoId = empenhoId || null;
  let empenho = {
    numero_empenho: '', ata_id: '', contrato_id: '', orgao_id: '', data_empenho: '',
    valor_empenhado: '', situacao: 'Vigente', observacoes: '',
  };
  editingItems = [];
  originalItemIds = new Set();

  if (!atasLite.length) atasLite = await Service.listAtas();
  if (!contratosLite.length) contratosLite = await Service.listContratos();

  expandedEntregaItemId = null;

  if (empenhoId) {
    empenho = cache.find((e) => e.id === empenhoId) || await Service.getEmpenho(empenhoId);
    const itens = await Service.listEmpenhoItens(empenhoId);
    editingItems = itens.map((it) => ({ ...it }));
    originalItemIds = new Set(itens.map((it) => it.id));

    const entregas = await Service.listEntregasByItens(itens.map((it) => it.id));
    entregasByItemId = new Map();
    for (const ent of entregas) {
      const arr = entregasByItemId.get(ent.empenho_item_id) || [];
      arr.push(ent);
      entregasByItemId.set(ent.empenho_item_id, arr);
    }
  }

  const atasOptions = atasLite
    .map((a) => `<option value="${a.id}" ${String(a.id) === String(empenho.ata_id) ? 'selected' : ''}>${escapeHtml(a.numero_ata)}</option>`)
    .join('');
  const contratosOptions = contratosLite
    .map((c) => `<option value="${c.id}" ${String(c.id) === String(empenho.contrato_id) ? 'selected' : ''}>${escapeHtml(c.numero_contrato)}</option>`)
    .join('');
  const orgaosOptions = getState().lookups.orgaos
    .map((o) => `<option value="${o.id}" ${String(o.id) === String(empenho.orgao_id) ? 'selected' : ''}>${escapeHtml(o.nome)}</option>`)
    .join('');

  const bodyHtml = `
    <form id="empenho-form">
      <div class="form-section-title">Dados do empenho</div>
      <div class="form-grid cols-3">
        <div class="form-field"><label>Nº do Empenho *</label><input required id="f-numero-empenho" value="${escapeHtml(empenho.numero_empenho || '')}" /></div>
        <div class="form-field"><label>Ata vinculada</label><select id="f-ata-id"><option value="">— Nenhuma —</option>${atasOptions}</select></div>
        <div class="form-field"><label>Contrato vinculado</label><select id="f-contrato-id"><option value="">— Nenhum —</option>${contratosOptions}</select></div>
        <div class="form-field"><label>Órgão</label><select id="f-orgao-id"><option value="">Selecione...</option>${orgaosOptions}</select></div>
        <div class="form-field"><label>Data do Empenho</label><input type="date" id="f-data-empenho" value="${empenho.data_empenho || ''}" /></div>
        <div class="form-field"><label>Situação</label><select id="f-situacao">${SITUACOES_EMPENHO.map((s) => `<option ${s === empenho.situacao ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="form-field"><label>Valor Empenhado *</label><input required id="f-valor-empenhado" value="${empenho.valor_empenhado ?? ''}" placeholder="0,00" /></div>
      </div>

      <div class="form-section-title">Observações</div>
      <div class="form-grid cols-3">
        <div class="form-field span-3"><textarea id="f-observacoes">${escapeHtml(empenho.observacoes || '')}</textarea></div>
      </div>

      <div class="card items-table-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px; flex-wrap:wrap;">
          <strong>Itens do empenho</strong>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn btn-ghost btn-sm" data-action="empenhos.carregarItensVinculo">Carregar itens do vínculo</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="empenhos.addItem">${ICONS.plus} Adicionar item</button>
          </div>
        </div>
        <div id="empenho-itens-table"></div>
      </div>

      ${empenhoId ? `
        <div class="card items-table-card">
          <strong>Saldo e entregas</strong>
          <p style="color:var(--gray-500); font-size:12px; margin:4px 0 10px;">Quanto já foi entregue de cada item empenhado, e o saldo restante a entregar.</p>
          <div id="empenho-entregas-section"></div>
        </div>
      ` : ''}
    </form>
  `;

  openModal(empenhoId ? 'Editar Empenho' : 'Novo Empenho', bodyHtml, {
    size: 'xl',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="empenhos.salvar">Salvar</button>
    `,
  });

  byId('f-ata-id').addEventListener('change', () => onVinculoChange('ata'));
  byId('f-contrato-id').addEventListener('change', () => onVinculoChange('contrato'));

  renderItemsTable();
  if (empenhoId) renderEntregasSection();
}

function onVinculoChange(origem) {
  if (origem === 'ata' && byId('f-ata-id').value) byId('f-contrato-id').value = '';
  if (origem === 'contrato' && byId('f-contrato-id').value) byId('f-ata-id').value = '';

  const ataId = byId('f-ata-id').value;
  const contratoId = byId('f-contrato-id').value;
  const orgaoSelect = byId('f-orgao-id');
  if (orgaoSelect.value) return;

  if (ataId) {
    const ata = atasLite.find((a) => String(a.id) === String(ataId));
    if (ata?.orgao_id) orgaoSelect.value = String(ata.orgao_id);
  } else if (contratoId) {
    const contrato = contratosLite.find((c) => String(c.id) === String(contratoId));
    if (contrato?.orgao_id) orgaoSelect.value = String(contrato.orgao_id);
  }
}

function renderItemsTable() {
  const wrap = byId('empenho-itens-table');
  if (!wrap) return;
  const { produtos } = getState().lookups;

  if (!editingItems.length) {
    wrap.innerHTML = renderEmptyState('Nenhum item adicionado.');
  } else {
    wrap.innerHTML = `
      <div class="table-wrap items-table">
        <table class="data-table">
          <thead><tr><th>Item</th><th>Produto</th><th>Qtd. Empenhada</th><th>Valor Unitário</th><th>Valor Total</th><th></th></tr></thead>
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
                <td><input type="text" data-field="quantidade_empenhada" value="${item.quantidade_empenhada ?? ''}" style="width:90px;" /></td>
                <td><input type="text" data-field="valor_unitario" value="${item.valor_unitario ?? ''}" style="width:90px;" /></td>
                <td class="item-valor-total" style="font-size:12.5px; white-space:nowrap;">${formatCurrency(parseNumber(item.valor_unitario) * parseNumber(item.quantidade_empenhada))}</td>
                <td><button type="button" class="icon-btn" data-action="empenhos.removerItem" data-row="${idx}">${ICONS.trash}</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  wrap.querySelectorAll('[data-field]').forEach((el) => {
    el.addEventListener('input', onItemFieldChange);
    el.addEventListener('change', onItemFieldChange);
  });

  renderItensTotais();
}

function renderItensTotais() {
  let wrap = byId('empenho-itens-totais');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'empenho-itens-totais';
    wrap.className = 'items-total';
    byId('empenho-itens-table').after(wrap);
  }
  const total = sumBy(editingItems, (i) => parseNumber(i.valor_unitario) * parseNumber(i.quantidade_empenhada));
  wrap.innerHTML = `<span>Soma dos itens cadastrados: ${formatCurrency(total)}</span>`;
}

function onItemFieldChange(event) {
  const row = event.target.closest('tr');
  const idx = Number(row.dataset.row);
  const field = event.target.dataset.field;
  const item = editingItems[idx];
  item[field] = event.target.value;

  if (field === 'produto_id') {
    const produto = getState().lookups.produtos.find((p) => String(p.id) === String(event.target.value));
    item.produto_descricao = produto?.nome || '';
  }

  if (field === 'quantidade_empenhada' || field === 'valor_unitario') {
    const totalCell = row.querySelector('.item-valor-total');
    if (totalCell) totalCell.textContent = formatCurrency(parseNumber(item.valor_unitario) * parseNumber(item.quantidade_empenhada));
  }

  renderItensTotais();
}

function addItem() {
  editingItems.push({
    id: null, item_numero: editingItems.length + 1, produto_id: '', produto_descricao: '',
    quantidade_empenhada: '', valor_unitario: '',
  });
  renderItemsTable();
}

function removerItem(target) {
  const idx = Number(target.dataset.row);
  editingItems.splice(idx, 1);
  renderItemsTable();
}

async function carregarItensVinculo() {
  const ataId = byId('f-ata-id').value;
  const contratoId = byId('f-contrato-id').value;
  if (!ataId && !contratoId) {
    showToast('Selecione a Ata ou o Contrato vinculado primeiro.', 'error');
    return;
  }
  if (editingItems.length) {
    const ok = await confirmDialog('Isso vai adicionar os itens do vínculo aos já existentes. Itens com o mesmo produto não serão duplicados. Continuar?');
    if (!ok) return;
  }

  const itensOrigem = ataId
    ? (await Service.listAtaItens(Number(ataId))).map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade_total, valor: i.valor_unitario }))
    : (await Service.listContratoItens(Number(contratoId))).map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade_total, valor: i.valor_unitario }));

  const jaTem = new Set(editingItems.map((i) => String(i.produto_id)).filter(Boolean));
  let adicionados = 0;

  for (const oi of itensOrigem) {
    if (!oi.produto_id || jaTem.has(String(oi.produto_id))) continue;
    const produto = getState().lookups.produtos.find((p) => String(p.id) === String(oi.produto_id));
    editingItems.push({
      id: null,
      item_numero: editingItems.length + 1,
      produto_id: oi.produto_id,
      produto_descricao: produto?.nome || '',
      quantidade_empenhada: oi.quantidade ?? '',
      valor_unitario: oi.valor ?? '',
    });
    jaTem.add(String(oi.produto_id));
    adicionados += 1;
  }

  renderItemsTable();
  showToast(adicionados ? `${adicionados} item(ns) carregado(s).` : 'Nenhum item novo para carregar.', adicionados ? 'success' : 'error');
}

function renderEntregasSection() {
  const wrap = byId('empenho-entregas-section');
  if (!wrap) return;
  const itensSalvos = editingItems.filter((i) => i.id);

  if (!itensSalvos.length) {
    wrap.innerHTML = renderEmptyState('Salve o empenho com pelo menos um item para registrar entregas.');
    return;
  }

  wrap.innerHTML = itensSalvos.map((item) => {
    const entregas = entregasByItemId.get(item.id) || [];
    const saldo = calcSaldoEmpenhoItem(item, entregas);
    const expanded = expandedEntregaItemId === item.id;
    return `
      <div class="card" style="margin-bottom:12px; box-shadow:none; border:1px solid var(--gray-200);">
        <div style="display:flex; justify-content:space-between; gap:14px; flex-wrap:wrap; align-items:center;">
          <div style="min-width:200px;">
            <strong>${escapeHtml(item.produto_descricao || '-')}</strong>
          </div>
          <div style="flex:1; min-width:200px;">
            <div class="progress-track"><div class="progress-fill" style="width:${saldo.percentual}%;"></div></div>
            <div style="font-size:12px; color:var(--gray-500); margin-top:4px;">
              Entregue ${saldo.entregue} de ${item.quantidade_empenhada} (${saldo.percentual.toFixed(0)}%) · Saldo restante ${saldo.restante}
            </div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-action="empenhos.toggleEntregas" data-item-id="${item.id}">${expanded ? 'Ocultar' : 'Entregas'} (${entregas.length})</button>
        </div>
        ${expanded ? renderEntregaPanel(item, entregas) : ''}
      </div>
    `;
  }).join('');
}

function renderEntregaPanel(item, entregas) {
  return `
    <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--gray-200);">
      ${entregas.length ? `
        <table class="data-table" style="margin-bottom:12px;">
          <thead><tr><th>Data</th><th>Quantidade</th><th>Nota Fiscal</th><th>Observação</th><th></th></tr></thead>
          <tbody>
            ${entregas.map((e) => `
              <tr>
                <td>${formatDate(e.data_entrega)}</td>
                <td>${e.quantidade}</td>
                <td>${escapeHtml(e.numero_nota_fiscal || '-')}</td>
                <td>${escapeHtml(e.observacao || '-')}</td>
                <td class="row-actions">${canWrite() ? `<button type="button" class="icon-btn" data-action="empenhos.excluirEntrega" data-entrega-id="${e.id}" data-item-id="${item.id}">${ICONS.trash}</button>` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : renderEmptyState('Nenhuma entrega lançada ainda.')}

      ${canWrite() ? `
        <div class="form-grid cols-3" style="align-items:end;">
          <div class="form-field"><label>Data da entrega</label><input type="date" id="nova-entrega-data-${item.id}" value="${todayISO()}" /></div>
          <div class="form-field"><label>Quantidade</label><input type="text" id="nova-entrega-qtd-${item.id}" placeholder="0" /></div>
          <div class="form-field"><label>Nota Fiscal</label><input type="text" id="nova-entrega-nf-${item.id}" /></div>
          <div class="form-field span-2"><label>Observação</label><input type="text" id="nova-entrega-obs-${item.id}" /></div>
          <div class="form-field"><button type="button" class="btn btn-primary" data-action="empenhos.addEntrega" data-item-id="${item.id}">${ICONS.plus} Lançar</button></div>
        </div>` : ''}
    </div>
  `;
}

function toggleEntregas(target) {
  const itemId = Number(target.dataset.itemId);
  expandedEntregaItemId = expandedEntregaItemId === itemId ? null : itemId;
  renderEntregasSection();
}

async function addEntregaHandler(target) {
  const itemId = Number(target.dataset.itemId);
  const quantidade = parseNumber(byId(`nova-entrega-qtd-${itemId}`).value);
  if (!quantidade) {
    showToast('Informe a quantidade entregue.', 'error');
    return;
  }
  try {
    await Service.addEntrega({
      empenho_item_id: itemId,
      data_entrega: byId(`nova-entrega-data-${itemId}`).value || todayISO(),
      quantidade,
      numero_nota_fiscal: byId(`nova-entrega-nf-${itemId}`).value.trim() || null,
      observacao: byId(`nova-entrega-obs-${itemId}`).value.trim() || null,
    });
    showToast('Entrega lançada.', 'success');
    const entregas = await Service.listEntregasByItens(editingItems.filter((i) => i.id).map((i) => i.id));
    entregasByItemId = new Map();
    for (const ent of entregas) {
      const arr = entregasByItemId.get(ent.empenho_item_id) || [];
      arr.push(ent);
      entregasByItemId.set(ent.empenho_item_id, arr);
    }
    expandedEntregaItemId = itemId;
    renderEntregasSection();
  } catch (err) {
    showToast(err.message || 'Erro ao lançar entrega.', 'error');
  }
}

async function excluirEntregaHandler(target) {
  const ok = await confirmDialog('Remover esta entrega?');
  if (!ok) return;
  const itemId = Number(target.dataset.itemId);
  try {
    await Service.deleteEntrega(Number(target.dataset.entregaId));
    const arr = (entregasByItemId.get(itemId) || []).filter((e) => e.id !== Number(target.dataset.entregaId));
    entregasByItemId.set(itemId, arr);
    expandedEntregaItemId = itemId;
    renderEntregasSection();
  } catch (err) {
    showToast(err.message || 'Erro ao remover entrega.', 'error');
  }
}

async function salvar() {
  const payload = {
    numero_empenho: byId('f-numero-empenho').value.trim(),
    ata_id: byId('f-ata-id').value || null,
    contrato_id: byId('f-contrato-id').value || null,
    orgao_id: byId('f-orgao-id').value || null,
    data_empenho: byId('f-data-empenho').value || null,
    valor_empenhado: byId('f-valor-empenhado').value ? parseNumber(byId('f-valor-empenhado').value) : null,
    situacao: byId('f-situacao').value,
    observacoes: byId('f-observacoes').value.trim() || null,
  };

  if (!payload.numero_empenho) {
    showToast('Informe o número do empenho.', 'error');
    return;
  }
  if (!payload.valor_empenhado) {
    showToast('Informe o valor empenhado.', 'error');
    return;
  }
  const itemSemProduto = editingItems.find((item) => !item.produto_id);
  if (itemSemProduto) {
    showToast(`Selecione um produto cadastrado para o item ${itemSemProduto.item_numero}.`, 'error');
    return;
  }

  try {
    if (editingEmpenhoId) {
      await Service.updateEmpenho(editingEmpenhoId, payload);
    } else {
      const created = await Service.createEmpenho(payload);
      editingEmpenhoId = created.id;
    }

    const currentIds = new Set();
    for (const item of editingItems) {
      const itemPayload = {
        empenho_id: editingEmpenhoId,
        item_numero: Number(item.item_numero) || 1,
        produto_id: item.produto_id,
        produto_descricao: item.produto_descricao || null,
        quantidade_empenhada: parseNumber(item.quantidade_empenhada),
        valor_unitario: parseNumber(item.valor_unitario),
      };
      if (item.id) {
        await Service.updateEmpenhoItem(item.id, itemPayload);
        currentIds.add(item.id);
      } else {
        const created = await Service.createEmpenhoItem(itemPayload);
        currentIds.add(created.id);
      }
    }

    const toDelete = [...originalItemIds].filter((id) => !currentIds.has(id));
    for (const id of toDelete) await Service.deleteEmpenhoItem(id);

    showToast('Empenho salvo com sucesso.', 'success');
    closeModal();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar empenho.', 'error');
  }
}

async function excluir(target) {
  const id = Number(target.dataset.id);
  const ok = await confirmDialog('Tem certeza que deseja excluir este empenho e todos os seus itens?');
  if (!ok) return;
  try {
    await Service.deleteEmpenho(id);
    showToast('Empenho excluído.', 'success');
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao excluir empenho.', 'error');
  }
}

export const actions = {
  'empenhos.novo': () => abrirFormulario(null),
  'empenhos.editar': (target) => abrirFormulario(Number(target.dataset.id)),
  'empenhos.excluir': (target) => excluir(target),
  'empenhos.addItem': () => addItem(),
  'empenhos.removerItem': (target) => removerItem(target),
  'empenhos.carregarItensVinculo': () => carregarItensVinculo(),
  'empenhos.toggleEntregas': (target) => toggleEntregas(target),
  'empenhos.addEntrega': (target) => addEntregaHandler(target),
  'empenhos.excluirEntrega': (target) => excluirEntregaHandler(target),
  'empenhos.salvar': () => salvar(),
};
