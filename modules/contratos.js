import * as Service from '../supabase-service.js';
import { getState, canWrite, isAdmin } from '../state.js';
import { byId, escapeHtml, formatDate, formatCurrency, formatMoneyInputValue, parseNumber, alertLevel, sumBy } from '../helpers.js';
import { openModal, closeModal, confirmDialog, showToast, badge, renderEmptyState } from '../ui.js';
import { SITUACOES_ATA, VIABILIDADE_CONTRATO, STATUS_COLOR, ICONS } from '../constants.js';

let cache = [];
let itensByContrato = new Map();
let licitacoesLite = [];
let editingItems = [];
let originalItemIds = new Set();
let editingContratoId = null;
let editingArquivoFile = null;
let pageContainer = null;
let activeFilter = null;

function vigenciaPerc(inicio, fim) {
  if (!inicio || !fim) return 0;
  const s = new Date(inicio + 'T00:00:00').getTime();
  const e = new Date(fim + 'T00:00:00').getTime();
  const n = Date.now();
  if (n <= s) return 0;
  if (n >= e) return 100;
  return Math.min(((n - s) / (e - s)) * 100, 100);
}

function vigenciaFillClass(fim, situacao) {
  if (situacao !== 'Vigente') return 'muted';
  const al = alertLevel(fim);
  if (!al) return '';
  return al.level === 'vencido' ? 'danger' : 'warning';
}

function dtShort(d) {
  return d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
}

export async function render(container, params) {
  pageContainer = container;
  activeFilter = params?.filter || null;
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Contratos</h1>
        <p>Contratos firmados a partir de licitações ganhas.</p>
      </div>
      ${canWrite() ? `<button class="btn btn-primary" data-action="contratos.novo">${ICONS.plus}Novo Contrato</button>` : ''}
    </div>
    <div id="contratos-kpi" class="kpi-grid kpi-grid-4 page-entering" style="margin-bottom:20px;"></div>
    ${activeFilter ? `
      <div class="card filter-banner">
        <span>Filtrando por: ${escapeHtml(activeFilter.label || '')}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-action="contratos.limparFiltro">Limpar filtro</button>
      </div>
    ` : ''}
    <div class="card" style="padding:0; overflow:hidden;"><div id="contrato-table-container"></div></div>
  `;
  await reload();
  if (params?.openId) await abrirFormulario(params.openId);
}

function limparFiltro() {
  render(pageContainer);
}

function filteredCache() {
  if (!activeFilter) return cache;
  return cache.filter((r) => String(r[activeFilter.key]) === String(activeFilter.value));
}

async function reload() {
  const [contratos, allItens] = await Promise.all([Service.listContratos(), Service.listAllContratoItens()]);
  cache = contratos;
  itensByContrato = new Map();
  for (const item of allItens) {
    const arr = itensByContrato.get(item.contrato_id) || [];
    arr.push(item);
    itensByContrato.set(item.contrato_id, arr);
  }
  renderKpis();
  renderTable();
}

function renderKpis() {
  const kpiEl = byId('contratos-kpi');
  if (!kpiEl) return;
  const vigentes = cache.filter((c) => c.situacao === 'Vigente');
  const valorTotal = vigentes.reduce((s, c) => s + (Number(c.valor_contrato) || valorTotalContrato(c.id)), 0);
  const a30d = vigentes.filter((c) => { const al = alertLevel(c.vigencia_fim); return al && al.level !== 'vencido' && al.days <= 30; }).length;
  const vencidos = vigentes.filter((c) => alertLevel(c.vigencia_fim)?.level === 'vencido').length;
  kpiEl.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon kpi-icon--green">${ICONS.contratos}</div>
      <div class="kpi-value">${vigentes.length}</div>
      <div class="kpi-label">Vigentes</div>
      <div class="kpi-foot">${cache.length} cadastrados no total</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-icon--blue">${ICONS.empenhos}</div>
      <div class="kpi-value" style="font-family:'Source Serif 4',Georgia,serif;font-size:18px;">${formatCurrency(valorTotal)}</div>
      <div class="kpi-label">Valor total vigentes</div>
      <div class="kpi-foot">soma dos valores contratados</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-icon--amber">${ICONS.agenda}</div>
      <div class="kpi-value">${a30d}</div>
      <div class="kpi-label">Vencendo em 30 dias</div>
      <div class="kpi-foot">requer atenção</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-icon--danger">${ICONS.close}</div>
      <div class="kpi-value">${vencidos}</div>
      <div class="kpi-label">Prazo vencido</div>
      <div class="kpi-foot">ainda marcados como Vigente</div>
    </div>
  `;
}

function valorTotalContrato(contratoId) {
  const itens = itensByContrato.get(contratoId) || [];
  return sumBy(itens, (i) => parseNumber(i.valor_unitario) * parseNumber(i.quantidade_total));
}

function renderTable() {
  const wrap = byId('contrato-table-container');
  const lista = filteredCache();
  if (!lista.length) {
    wrap.innerHTML = `<div style="padding:20px;">${renderEmptyState(activeFilter ? 'Nenhum contrato encontrado para este filtro.' : 'Nenhum contrato cadastrado.')}</div>`;
    return;
  }
  wrap.innerHTML = lista.map((c) => {
    const perc = vigenciaPerc(c.vigencia_inicio, c.vigencia_fim);
    const fillClass = vigenciaFillClass(c.vigencia_fim, c.situacao);
    const valor = c.valor_contrato ?? valorTotalContrato(c.id);
    const licitRef = c.licitacao?.numero_pregao ? `· ${escapeHtml(c.licitacao.numero_pregao)}` : '';
    return `
      <div class="record">
        <div class="record-main">
          <div class="record-id">
            <span class="num">${escapeHtml(c.numero_contrato)}</span>
            ${badge(c.situacao, STATUS_COLOR[c.situacao] || 'muted')}
          </div>
          <p class="record-org">${escapeHtml(c.orgao?.nome || '—')} ${licitRef}</p>
          <div class="vigencia">
            <div class="vigencia-track"><div class="vigencia-fill ${fillClass}" style="width:${perc.toFixed(1)}%"></div></div>
            <span class="vigencia-dates">${dtShort(c.vigencia_inicio)} → ${dtShort(c.vigencia_fim)}</span>
          </div>
        </div>
        <div class="record-side">
          <p class="record-value">${formatCurrency(valor)}</p>
          <div class="record-actions">
            <button class="icon-btn" data-action="contratos.editar" data-id="${c.id}" title="Editar">${ICONS.edit}</button>
            ${isAdmin() ? `<button class="icon-btn" data-action="contratos.excluir" data-id="${c.id}" title="Excluir">${ICONS.trash}</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function abrirFormulario(contratoId) {
  editingContratoId = contratoId || null;
  editingArquivoFile = null;
  let contrato = {
    numero_contrato: '', licitacao_id: '', orgao_id: '', data_contrato: '', data_assinatura: '',
    valor_contrato: '', vigencia_inicio: '', vigencia_fim: '', viabilidade: '', arquivo_url: '',
    prazo_entrega: '', prazo_entrega_uteis: false, prazo_pagamento: '', prazo_pagamento_uteis: false,
    telefone_contato: '', email_contato: '', situacao: 'Vigente', observacoes: '',
  };
  editingItems = [];
  originalItemIds = new Set();

  if (!licitacoesLite.length) licitacoesLite = await Service.listLicitacoes();

  if (contratoId) {
    contrato = cache.find((c) => c.id === contratoId) || await Service.getContrato(contratoId);
    const itens = await Service.listContratoItens(contratoId);
    editingItems = itens.map((it) => ({ ...it }));
    originalItemIds = new Set(itens.map((it) => it.id));
  }

  const licitacoesOptions = licitacoesLite
    .map((l) => `<option value="${l.id}" ${String(l.id) === String(contrato.licitacao_id) ? 'selected' : ''}>${escapeHtml(l.numero_pregao)}${l.numero_processo ? ` (${escapeHtml(l.numero_processo)})` : ''}</option>`)
    .join('');
  const orgaosOptions = getState().lookups.orgaos
    .map((o) => `<option value="${o.id}" ${String(o.id) === String(contrato.orgao_id) ? 'selected' : ''}>${escapeHtml(o.nome)}</option>`)
    .join('');

  const orgaoNome = getState().lookups.orgaos.find((o) => String(o.id) === String(contrato.orgao_id))?.nome || '';

  const bodyHtml = `
    <form id="contrato-form">
      ${contratoId ? `
        <div class="modal-nav-links">
          ${contrato.orgao_id ? `<button type="button" class="btn btn-ghost btn-sm" data-action="nav.go" data-page="atas" data-filter-key="orgao_id" data-filter-value="${contrato.orgao_id}" data-filter-label="Órgão ${escapeHtml(orgaoNome)}">${ICONS.atas} Ver Atas do Órgão</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-action="nav.go" data-page="empenhos" data-filter-key="contrato_id" data-filter-value="${contratoId}" data-filter-label="Contrato ${escapeHtml(contrato.numero_contrato || '')}">${ICONS.empenhos} Ver Empenhos deste Contrato</button>
        </div>
      ` : ''}
      <div class="form-section-title">Dados do contrato</div>
      <div class="form-grid cols-3">
        <div class="form-field"><label>Nº do Contrato *</label><input required id="f-numero-contrato" value="${escapeHtml(contrato.numero_contrato || '')}" /></div>
        <div class="form-field"><label>Licitação relacionada *</label><select required id="f-licitacao-id"><option value="">Selecione...</option>${licitacoesOptions}</select></div>
        <div class="form-field"><label>Órgão</label><select id="f-orgao-id"><option value="">Selecione...</option>${orgaosOptions}</select></div>
        <div class="form-field"><label>Data do Contrato</label><input type="date" id="f-data-contrato" value="${contrato.data_contrato || ''}" /></div>
        <div class="form-field"><label>Data de Assinatura</label><input type="date" id="f-data-assinatura" value="${contrato.data_assinatura || ''}" /></div>
        <div class="form-field"><label>Situação</label><select id="f-situacao">${SITUACOES_ATA.map((s) => `<option ${s === contrato.situacao ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="form-field"><label>Valor do Contrato *</label><div class="input-currency-wrap"><input required id="f-valor-contrato" value="${formatMoneyInputValue(contrato.valor_contrato)}" placeholder="0,00" /></div></div>
      </div>

      <div class="form-section-title">Vigência e viabilidade</div>
      <div class="form-grid cols-3">
        <div class="form-field"><label>Vigência início</label><input type="date" id="f-vigencia-inicio" value="${contrato.vigencia_inicio || ''}" /></div>
        <div class="form-field"><label>Vigência fim</label><input type="date" id="f-vigencia-fim" value="${contrato.vigencia_fim || ''}" /></div>
        <div class="form-field"><label>Viabilidade</label><select id="f-viabilidade"><option value="">-</option>${VIABILIDADE_CONTRATO.map((v) => `<option ${v === contrato.viabilidade ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="form-field span-2">
          <label>Arquivo do Contrato</label>
          <input type="file" id="f-arquivo" />
          ${contrato.arquivo_url ? `<button type="button" class="link-btn" style="margin-top:6px; text-align:left;" data-action="contratos.verArquivo" data-url="${escapeHtml(contrato.arquivo_url)}">Ver arquivo atual</button>` : ''}
        </div>
      </div>

      <div class="form-section-title">Prazos e contato</div>
      <div class="form-grid cols-3">
        <div class="form-field">
          <label>Prazo de Entrega</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="f-prazo-entrega" value="${escapeHtml(contrato.prazo_entrega || '')}" placeholder="Ex: 15 dias" style="flex:1;" />
            <span class="checkbox-field" style="white-space:nowrap;"><input type="checkbox" id="f-prazo-entrega-uteis" ${contrato.prazo_entrega_uteis ? 'checked' : ''} /> Úteis</span>
          </div>
        </div>
        <div class="form-field">
          <label>Prazo de Pagamento</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="f-prazo-pagamento" value="${escapeHtml(contrato.prazo_pagamento || '')}" placeholder="Ex: 30 dias" style="flex:1;" />
            <span class="checkbox-field" style="white-space:nowrap;"><input type="checkbox" id="f-prazo-pagamento-uteis" ${contrato.prazo_pagamento_uteis ? 'checked' : ''} /> Úteis</span>
          </div>
        </div>
        <div class="form-field"></div>
        <div class="form-field"><label>Telefone</label><input id="f-telefone-contato" value="${escapeHtml(contrato.telefone_contato || '')}" /></div>
        <div class="form-field"><label>Email</label><input id="f-email-contato" value="${escapeHtml(contrato.email_contato || '')}" /></div>
      </div>

      <div class="form-section-title">Observações</div>
      <div class="form-grid cols-3">
        <div class="form-field span-3"><textarea id="f-observacoes">${escapeHtml(contrato.observacoes || '')}</textarea></div>
      </div>

      <div class="card items-table-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px; flex-wrap:wrap;">
          <strong>Itens do contrato</strong>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn btn-ghost btn-sm" data-action="contratos.carregarItensLicitacao">Carregar itens da licitação</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="contratos.addItem">${ICONS.plus} Adicionar item</button>
          </div>
        </div>
        <div id="contrato-itens-table"></div>
      </div>
    </form>
  `;

  openModal(contratoId ? 'Editar Contrato' : 'Novo Contrato', bodyHtml, {
    size: 'xl',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="contratos.salvar">Salvar</button>
    `,
  });

  byId('f-arquivo').addEventListener('change', (e) => { editingArquivoFile = e.target.files?.[0] || null; });
  byId('f-licitacao-id').addEventListener('change', onLicitacaoChange);

  renderItemsTable();
}

function onLicitacaoChange(event) {
  const licitacaoId = event.target.value;
  const licitacao = licitacoesLite.find((l) => String(l.id) === String(licitacaoId));
  const orgaoSelect = byId('f-orgao-id');
  if (licitacao?.orgao_id && orgaoSelect && !orgaoSelect.value) {
    orgaoSelect.value = String(licitacao.orgao_id);
  }
}

function renderItemsTable() {
  const wrap = byId('contrato-itens-table');
  if (!wrap) return;
  const { produtos } = getState().lookups;

  if (!editingItems.length) {
    wrap.innerHTML = renderEmptyState('Nenhum item adicionado.');
  } else {
    wrap.innerHTML = `
      <div class="table-wrap items-table">
        <table class="data-table">
          <thead>
            <tr>
              <th>Item</th><th>Produto</th><th>Marca/Fabricante</th><th>Modelo/Versão</th>
              <th>Unidade</th><th>Qtd. Total</th><th>Valor Unitário</th><th>Valor Total</th><th></th>
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
                <td><input type="text" data-field="marca_fabricante" value="${escapeHtml(item.marca_fabricante ?? '')}" style="min-width:110px;" /></td>
                <td><input type="text" data-field="modelo_versao" value="${escapeHtml(item.modelo_versao ?? '')}" style="min-width:100px;" /></td>
                <td><input type="text" data-field="unidade" value="${escapeHtml(item.unidade ?? '1 UN')}" style="width:70px;" /></td>
                <td><input type="text" data-field="quantidade_total" value="${item.quantidade_total ?? ''}" style="width:80px;" /></td>
                <td><input type="text" data-field="valor_unitario" value="${formatMoneyInputValue(item.valor_unitario)}" placeholder="0,00" style="width:90px;" /></td>
                <td class="item-valor-total" style="font-size:12.5px; white-space:nowrap;">${formatCurrency(parseNumber(item.valor_unitario) * parseNumber(item.quantidade_total))}</td>
                <td><button type="button" class="icon-btn" data-action="contratos.removerItem" data-row="${idx}">${ICONS.trash}</button></td>
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
  let wrap = byId('contrato-itens-totais');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'contrato-itens-totais';
    wrap.className = 'items-total';
    byId('contrato-itens-table').after(wrap);
  }
  const total = sumBy(editingItems, (i) => parseNumber(i.valor_unitario) * parseNumber(i.quantidade_total));
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
    if (produto && !item.marca_fabricante && produto.fabricante) {
      item.marca_fabricante = produto.fabricante;
      row.querySelector('[data-field="marca_fabricante"]').value = produto.fabricante;
    }
  }

  if (field === 'quantidade_total' || field === 'valor_unitario') {
    const totalCell = row.querySelector('.item-valor-total');
    if (totalCell) totalCell.textContent = formatCurrency(parseNumber(item.valor_unitario) * parseNumber(item.quantidade_total));
  }

  renderItensTotais();
}

function addItem() {
  editingItems.push({
    id: null, item_numero: editingItems.length + 1, produto_id: '', produto_descricao: '',
    marca_fabricante: '', modelo_versao: '', unidade: '1 UN', quantidade_total: '', valor_unitario: '',
  });
  renderItemsTable();
}

function removerItem(target) {
  const idx = Number(target.dataset.row);
  editingItems.splice(idx, 1);
  renderItemsTable();
}

async function carregarItensLicitacao() {
  const licitacaoId = byId('f-licitacao-id').value;
  if (!licitacaoId) {
    showToast('Selecione a licitação relacionada primeiro.', 'error');
    return;
  }
  if (editingItems.length) {
    const ok = await confirmDialog('Isso vai adicionar os itens da licitação aos já existentes. Itens com o mesmo produto não serão duplicados. Continuar?');
    if (!ok) return;
  }

  const itensLicitacao = await Service.listLicitacaoItens(Number(licitacaoId));
  const jaTem = new Set(editingItems.map((i) => String(i.produto_id)).filter(Boolean));
  let adicionados = 0;

  for (const li of itensLicitacao) {
    if (!li.produto_id || jaTem.has(String(li.produto_id))) continue;
    editingItems.push({
      id: null,
      item_numero: editingItems.length + 1,
      produto_id: li.produto_id,
      produto_descricao: li.produto_descricao || '',
      marca_fabricante: li.marca_fabricante || '',
      modelo_versao: li.modelo_versao || '',
      unidade: '1 UN',
      quantidade_total: li.quantidade ?? '',
      valor_unitario: li.valor_final ?? li.valor_inicial ?? '',
    });
    jaTem.add(String(li.produto_id));
    adicionados += 1;
  }

  renderItemsTable();
  showToast(adicionados ? `${adicionados} item(ns) carregado(s) da licitação.` : 'Nenhum item novo para carregar.', adicionados ? 'success' : 'error');
}

async function verArquivo(target) {
  try {
    const url = await Service.getSignedUrl(target.dataset.url);
    window.open(url, '_blank');
  } catch (err) {
    showToast(err.message || 'Erro ao gerar link do arquivo.', 'error');
  }
}

async function salvar() {
  const payload = {
    numero_contrato: byId('f-numero-contrato').value.trim(),
    licitacao_id: byId('f-licitacao-id').value || null,
    orgao_id: byId('f-orgao-id').value || null,
    data_contrato: byId('f-data-contrato').value || null,
    data_assinatura: byId('f-data-assinatura').value || null,
    valor_contrato: byId('f-valor-contrato').value ? parseNumber(byId('f-valor-contrato').value) : null,
    vigencia_inicio: byId('f-vigencia-inicio').value || null,
    vigencia_fim: byId('f-vigencia-fim').value || null,
    viabilidade: byId('f-viabilidade').value || null,
    prazo_entrega: byId('f-prazo-entrega').value.trim() || null,
    prazo_entrega_uteis: byId('f-prazo-entrega-uteis').checked,
    prazo_pagamento: byId('f-prazo-pagamento').value.trim() || null,
    prazo_pagamento_uteis: byId('f-prazo-pagamento-uteis').checked,
    telefone_contato: byId('f-telefone-contato').value.trim() || null,
    email_contato: byId('f-email-contato').value.trim() || null,
    situacao: byId('f-situacao').value,
    observacoes: byId('f-observacoes').value.trim() || null,
  };

  if (!payload.numero_contrato) {
    showToast('Informe o número do contrato.', 'error');
    return;
  }
  if (!payload.licitacao_id) {
    showToast('Selecione a licitação relacionada a este contrato.', 'error');
    return;
  }
  if (!payload.valor_contrato) {
    showToast('Informe o valor do contrato.', 'error');
    return;
  }
  const itemSemProduto = editingItems.find((item) => !item.produto_id);
  if (itemSemProduto) {
    showToast(`Selecione um produto cadastrado para o item ${itemSemProduto.item_numero}.`, 'error');
    return;
  }

  try {
    let saved;
    if (editingContratoId) {
      saved = await Service.updateContrato(editingContratoId, payload);
    } else {
      saved = await Service.createContrato(payload);
      editingContratoId = saved.id;
    }

    if (editingArquivoFile) {
      const path = await Service.uploadContratoArquivo(editingArquivoFile, editingContratoId);
      await Service.updateContrato(editingContratoId, { arquivo_url: path });
    }

    const currentIds = new Set();
    for (const item of editingItems) {
      const itemPayload = {
        contrato_id: editingContratoId,
        item_numero: Number(item.item_numero) || 1,
        produto_id: item.produto_id,
        produto_descricao: item.produto_descricao || null,
        marca_fabricante: item.marca_fabricante || null,
        modelo_versao: item.modelo_versao || null,
        unidade: item.unidade || '1 UN',
        quantidade_total: parseNumber(item.quantidade_total),
        valor_unitario: parseNumber(item.valor_unitario),
      };
      if (item.id) {
        await Service.updateContratoItem(item.id, itemPayload);
        currentIds.add(item.id);
      } else {
        const created = await Service.createContratoItem(itemPayload);
        currentIds.add(created.id);
      }
    }

    const toDelete = [...originalItemIds].filter((id) => !currentIds.has(id));
    for (const id of toDelete) await Service.deleteContratoItem(id);

    showToast('Contrato salvo com sucesso.', 'success');
    closeModal();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar contrato.', 'error');
  }
}

async function excluir(target) {
  const id = Number(target.dataset.id);
  const ok = await confirmDialog('Tem certeza que deseja excluir este contrato e todos os seus itens?');
  if (!ok) return;
  try {
    await Service.deleteContrato(id);
    showToast('Contrato excluído.', 'success');
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao excluir contrato.', 'error');
  }
}

export const actions = {
  'contratos.novo': () => abrirFormulario(null),
  'contratos.editar': (target) => abrirFormulario(Number(target.dataset.id)),
  'contratos.excluir': (target) => excluir(target),
  'contratos.addItem': () => addItem(),
  'contratos.removerItem': (target) => removerItem(target),
  'contratos.carregarItensLicitacao': () => carregarItensLicitacao(),
  'contratos.verArquivo': (target) => verArquivo(target),
  'contratos.salvar': () => salvar(),
  'contratos.limparFiltro': () => limparFiltro(),
};
