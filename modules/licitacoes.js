import * as Service from '../supabase-service.js';
import { getState, canWrite, isAdmin } from '../state.js';
import { byId, escapeHtml, formatDate, parseNumber, formatCurrency } from '../helpers.js';
import { openModal, closeModal, confirmDialog, showToast, badge, renderEmptyState } from '../ui.js';
import { MODALIDADES, STATUS_LICITACAO, STATUS_COLOR, UFS, ICONS } from '../constants.js';

let cache = [];
let itemsByLicitacao = new Map();
let editingItems = [];
let originalItemIds = new Set();
let editingLicitacaoId = null;

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Licitações</h1>
        <p>Editais disputados, itens, resultado e propostas.</p>
      </div>
      ${canWrite() ? `<button class="btn btn-primary" data-action="licitacoes.novo">${ICONS.plus}Nova Licitação</button>` : ''}
    </div>

    <div class="card" style="margin-bottom:16px; display:flex; gap:12px; flex-wrap:wrap;">
      <input type="text" id="lic-filtro-busca" placeholder="Buscar por pregão, processo ou órgão..." style="flex:1; min-width:220px; border:1px solid var(--gray-200); border-radius:8px; padding:9px 11px;" />
      <select id="lic-filtro-status" style="border:1px solid var(--gray-200); border-radius:8px; padding:9px 11px;">
        <option value="">Todos os status</option>
        ${STATUS_LICITACAO.map((s) => `<option value="${s}">${s}</option>`).join('')}
      </select>
    </div>

    <div class="card table-wrap">
      <div id="lic-table-container"></div>
    </div>
  `;

  byId('lic-filtro-busca').addEventListener('input', renderTable);
  byId('lic-filtro-status').addEventListener('change', renderTable);

  await reload();
}

async function reload() {
  const [licitacoes, allItems] = await Promise.all([Service.listLicitacoes(), Service.listAllLicitacaoItens()]);
  cache = licitacoes;
  itemsByLicitacao = new Map();
  for (const item of allItems) {
    const arr = itemsByLicitacao.get(item.licitacao_id) || [];
    arr.push(item);
    itemsByLicitacao.set(item.licitacao_id, arr);
  }
  renderTable();
}

function renderTable() {
  const busca = (byId('lic-filtro-busca')?.value || '').toLowerCase();
  const statusFiltro = byId('lic-filtro-status')?.value || '';

  const filtradas = cache.filter((l) => {
    if (busca) {
      const haystack = `${l.numero_pregao} ${l.numero_processo || ''} ${l.orgao?.nome || ''}`.toLowerCase();
      if (!haystack.includes(busca)) return false;
    }
    if (statusFiltro) {
      const itens = itemsByLicitacao.get(l.id) || [];
      if (!itens.some((i) => i.status === statusFiltro)) return false;
    }
    return true;
  });

  const wrap = byId('lic-table-container');
  if (!filtradas.length) {
    wrap.innerHTML = renderEmptyState('Nenhuma licitação encontrada.');
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Pregão / Processo</th><th>Órgão</th><th>Modalidade</th><th>Sessão</th><th>Itens / Resultado</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${filtradas.map(rowHtml).join('')}
      </tbody>
    </table>
  `;
}

function rowHtml(l) {
  const itens = itemsByLicitacao.get(l.id) || [];
  const contagem = new Map();
  itens.forEach((i) => contagem.set(i.status, (contagem.get(i.status) || 0) + 1));
  const badges = [...contagem.entries()]
    .map(([status, qtd]) => badge(`${status} ${qtd > 1 ? `×${qtd}` : ''}`, STATUS_COLOR[status] || 'muted'))
    .join(' ');

  return `
    <tr>
      <td><strong>${escapeHtml(l.numero_pregao)}</strong><br/><span style="color:var(--gray-500); font-size:12px;">${escapeHtml(l.numero_processo || '-')}</span></td>
      <td>${escapeHtml(l.orgao?.nome || '-')}${l.uf ? ` · ${l.uf}` : ''}</td>
      <td>${escapeHtml(l.modalidade)}</td>
      <td>${formatDate(l.data_sessao)}</td>
      <td>${badges || renderEmptyState('Sem itens')}</td>
      <td class="row-actions">
        <button class="icon-btn" data-action="licitacoes.editar" data-id="${l.id}" title="Editar">${ICONS.edit}</button>
        ${isAdmin() ? `<button class="icon-btn" data-action="licitacoes.excluir" data-id="${l.id}" title="Excluir">${ICONS.trash}</button>` : ''}
      </td>
    </tr>
  `;
}

async function abrirFormulario(licitacaoId) {
  editingLicitacaoId = licitacaoId || null;
  let licitacao = {
    numero_pregao: '', numero_processo: '', orgao_id: '', uf: '', modalidade: 'Pregão Eletrônico',
    data_sessao: '', objeto: '', recurso_contrarrazao: false, motivo_rc: '', deferido_indeferido: '', observacoes: '',
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
      <div class="form-grid">
        <div class="form-field"><label>Nº do Pregão *</label><input required id="f-numero-pregao" value="${escapeHtml(licitacao.numero_pregao || '')}" /></div>
        <div class="form-field"><label>Nº do Processo</label><input id="f-numero-processo" value="${escapeHtml(licitacao.numero_processo || '')}" /></div>
        <div class="form-field"><label>Órgão</label><select id="f-orgao-id"><option value="">Selecione...</option>${orgaosOptions}</select></div>
        <div class="form-field"><label>UF</label><select id="f-uf"><option value="">-</option>${UFS.map((uf) => `<option ${uf === licitacao.uf ? 'selected' : ''}>${uf}</option>`).join('')}</select></div>
        <div class="form-field"><label>Modalidade</label><select id="f-modalidade">${MODALIDADES.map((m) => `<option ${m === licitacao.modalidade ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="form-field"><label>Data da Sessão</label><input type="date" id="f-data-sessao" value="${licitacao.data_sessao || ''}" /></div>
        <div class="form-field span-2"><label>Objeto</label><textarea id="f-objeto">${escapeHtml(licitacao.objeto || '')}</textarea></div>
        <div class="form-field">
          <label>Houve Recurso/Contrarrazão?</label>
          <div class="checkbox-field" style="height:38px;"><input type="checkbox" id="f-recurso" ${licitacao.recurso_contrarrazao ? 'checked' : ''} /> Sim</div>
        </div>
        <div class="form-field">
          <label>Deferido/Indeferido</label>
          <select id="f-deferido"><option value="">-</option><option ${licitacao.deferido_indeferido === 'Deferido' ? 'selected' : ''}>Deferido</option><option ${licitacao.deferido_indeferido === 'Indeferido' ? 'selected' : ''}>Indeferido</option></select>
        </div>
        <div class="form-field span-2"><label>Motivo do Recurso/Contrarrazão</label><input id="f-motivo-rc" value="${escapeHtml(licitacao.motivo_rc || '')}" /></div>
        <div class="form-field span-2"><label>Observações</label><textarea id="f-observacoes">${escapeHtml(licitacao.observacoes || '')}</textarea></div>
      </div>

      <div class="card items-table-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <strong>Itens disputados</strong>
          <button type="button" class="btn btn-ghost btn-sm" data-action="licitacoes.addItem">${ICONS.plus} Adicionar item</button>
        </div>
        <div id="licitacao-itens-table"></div>
      </div>
    </form>
  `;

  openModal(licitacaoId ? 'Editar Licitação' : 'Nova Licitação', bodyHtml, {
    size: 'lg',
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
  const { concorrentes, parceiros, produtos } = getState().lookups;

  if (!editingItems.length) {
    wrap.innerHTML = renderEmptyState('Nenhum item adicionado.');
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap items-table">
      <table class="data-table">
        <thead>
          <tr>
            <th>Item</th><th>Produto</th><th>Qtd</th><th>Valor Inicial</th><th>Valor Mínimo</th><th>Valor Final</th>
            <th>Status</th><th>Vencedor</th><th>Parceiro</th><th>Motivo da perda</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${editingItems.map((item, idx) => `
            <tr data-row="${idx}">
              <td><input type="number" min="1" data-field="item_numero" value="${item.item_numero ?? idx + 1}" style="width:54px;" /></td>
              <td><input type="text" list="produtos-list" data-field="produto_descricao" value="${escapeHtml(item.produto_descricao ?? '')}" style="min-width:160px;" placeholder="Produto" /></td>
              <td><input type="text" data-field="quantidade" value="${item.quantidade ?? ''}" style="width:70px;" /></td>
              <td><input type="text" data-field="valor_inicial" value="${item.valor_inicial ?? ''}" style="width:90px;" /></td>
              <td><input type="text" data-field="valor_minimo" value="${item.valor_minimo ?? ''}" style="width:90px;" /></td>
              <td><input type="text" data-field="valor_final" value="${item.valor_final ?? ''}" style="width:90px;" /></td>
              <td>
                <select data-field="status" style="min-width:130px;">
                  ${STATUS_LICITACAO.map((s) => `<option value="${s}" ${item.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </td>
              <td>
                <select data-field="empresa_vencedora_id" style="min-width:140px;">
                  <option value="">-</option>
                  ${concorrentes.map((c) => `<option value="${c.id}" ${String(item.empresa_vencedora_id) === String(c.id) ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}
                </select>
              </td>
              <td>
                <select data-field="parceiro_id" style="min-width:140px;">
                  <option value="">-</option>
                  ${parceiros.map((p) => `<option value="${p.id}" ${String(item.parceiro_id) === String(p.id) ? 'selected' : ''}>${escapeHtml(p.razao_social)}</option>`).join('')}
                </select>
              </td>
              <td><input type="text" data-field="motivo_perda" value="${escapeHtml(item.motivo_perda ?? '')}" style="min-width:160px;" /></td>
              <td><button type="button" class="icon-btn" data-action="licitacoes.removerItem" data-row="${idx}">${ICONS.trash}</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <datalist id="produtos-list">${produtos.map((p) => `<option value="${escapeHtml(p.nome)}"></option>`).join('')}</datalist>
  `;

  wrap.querySelectorAll('[data-field]').forEach((el) => {
    el.addEventListener('input', onItemFieldChange);
    el.addEventListener('change', onItemFieldChange);
  });
}

function onItemFieldChange(event) {
  const row = event.target.closest('tr');
  const idx = Number(row.dataset.row);
  const field = event.target.dataset.field;
  const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  editingItems[idx][field] = value;
}

function addItem() {
  editingItems.push({
    id: null, item_numero: editingItems.length + 1, produto_descricao: '', quantidade: '',
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
  const payload = {
    numero_pregao: byId('f-numero-pregao').value.trim(),
    numero_processo: byId('f-numero-processo').value.trim() || null,
    orgao_id: byId('f-orgao-id').value || null,
    uf: byId('f-uf').value || null,
    modalidade: byId('f-modalidade').value,
    data_sessao: byId('f-data-sessao').value || null,
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
        produto_descricao: item.produto_descricao || null,
        quantidade: parseNumber(item.quantidade),
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
};
