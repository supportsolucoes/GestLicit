import * as Service from '../supabase-service.js';
import { getState, canWrite, isAdmin } from '../state.js';
import { byId, escapeHtml, formatDate, parseNumber, formatCurrency, toDatetimeLocalValue } from '../helpers.js';
import { openModal, closeModal, confirmDialog, showToast, badge, renderEmptyState } from '../ui.js';
import { MODALIDADES, MODOS_DISPUTA, STATUS_LICITACAO, STATUS_COLOR, UFS, ICONS } from '../constants.js';

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
        <div class="form-field"><label>Valor Total Estimado</label><input id="f-valor-total-estimado" value="${licitacao.valor_total_estimado ?? ''}" placeholder="0,00" /></div>
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
                  <option value="">— Outro / não cadastrado —</option>
                  ${produtos.map((p) => `<option value="${p.id}" ${String(item.produto_id) === String(p.id) ? 'selected' : ''}>${escapeHtml(p.nome)}</option>`).join('')}
                </select>
                <input type="text" data-field="produto_descricao" value="${escapeHtml(item.produto_descricao ?? '')}" style="min-width:150px; margin-top:4px;" placeholder="Descrição/detalhe" />
              </td>
              <td><input type="text" data-field="quantidade" value="${item.quantidade ?? ''}" style="width:70px;" /></td>
              <td><input type="text" data-field="marca_fabricante" value="${escapeHtml(item.marca_fabricante ?? '')}" style="min-width:120px;" /></td>
              <td><input type="text" data-field="modelo_versao" value="${escapeHtml(item.modelo_versao ?? '')}" style="min-width:110px;" /></td>
              <td><input type="text" data-field="valor_referencia" value="${item.valor_referencia ?? ''}" style="width:90px;" placeholder="Sigiloso" /></td>
              <td><input type="text" data-field="custo_unitario" value="${item.custo_unitario ?? ''}" style="width:90px;" /></td>
              <td><input type="text" data-field="margem_percentual" value="${item.margem_percentual ?? ''}" style="width:70px;" /></td>
              <td><input type="text" data-field="valor_minimo" value="${item.valor_minimo ?? ''}" style="width:90px;" /></td>
              <td><input type="text" data-field="valor_inicial" value="${item.valor_inicial ?? ''}" style="width:90px;" /></td>
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

  if (field === 'produto_id' && value) {
    const produto = getState().lookups.produtos.find((p) => String(p.id) === String(value));
    if (produto) {
      if (!item.produto_descricao) {
        item.produto_descricao = produto.nome;
        row.querySelector('[data-field="produto_descricao"]').value = produto.nome;
      }
      if (!item.marca_fabricante && produto.fabricante) {
        item.marca_fabricante = produto.fabricante;
        row.querySelector('[data-field="marca_fabricante"]').value = produto.fabricante;
      }
      item.custo_unitario = produto.preco_custo ?? '';
      row.querySelector('[data-field="custo_unitario"]').value = item.custo_unitario;
      recalcValorMinimo(item);
      row.querySelector('[data-field="valor_minimo"]').value = item.valor_minimo ?? '';
    }
  }

  if (field === 'custo_unitario' || field === 'margem_percentual') {
    recalcValorMinimo(item);
    row.querySelector('[data-field="valor_minimo"]').value = item.valor_minimo ?? '';
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
