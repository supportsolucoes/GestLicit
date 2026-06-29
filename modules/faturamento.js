import * as Service from '../supabase-service.js';
import { canWrite, isAdmin } from '../state.js';
import { byId, escapeHtml, formatDate, formatCurrency, formatMoneyInputValue, parseNumber, todayISO, calcSaldoFaturamento } from '../helpers.js';
import { openModal, closeModal, confirmDialog, showToast, badge, renderEmptyState } from '../ui.js';
import { SITUACOES_FATURAMENTO, STATUS_COLOR, ICONS } from '../constants.js';

let cache = [];
let recebimentosCache = [];
let empenhosLite = [];
let entregasComItem = [];
let recebimentosEdicao = [];
let editingFaturamentoId = null;
let editingArquivoFile = null;
let pageContainer = null;
let activeFilter = null;

export async function render(container, params) {
  pageContainer = container;
  activeFilter = params?.filter || null;
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Faturamento</h1>
        <p>Notas fiscais enviadas para pagamento a partir das entregas já realizadas, e os recebimentos contra elas.</p>
      </div>
      ${canWrite() ? `<button class="btn btn-primary" data-action="faturamento.novo">${ICONS.plus}Nova Fatura</button>` : ''}
    </div>
    <div id="faturamento-kpi" class="kpi-grid kpi-grid-4 page-entering" style="margin-bottom:20px;"></div>
    ${activeFilter ? `
      <div class="card filter-banner">
        <span>Filtrando por: ${escapeHtml(activeFilter.label || '')}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-action="faturamento.limparFiltro">Limpar filtro</button>
      </div>
    ` : ''}
    <div class="card table-wrap"><div id="fatura-table-container"></div></div>
  `;
  await reload();
  if (params?.openId) await abrirFormulario(params.openId);
}

function limparFiltro() {
  render(pageContainer);
}

function filteredCache() {
  if (!activeFilter) return cache;
  return cache.filter((f) => String(f[activeFilter.key]) === String(activeFilter.value));
}

async function reload() {
  const [faturas, recebimentos] = await Promise.all([Service.listFaturamentos(), Service.listAllRecebimentos()]);
  cache = faturas;
  recebimentosCache = recebimentos;
  renderKpis();
  renderTable();
}

function renderKpis() {
  const kpiEl = byId('faturamento-kpi');
  if (!kpiEl) return;
  const ativas = cache.filter((f) => f.situacao !== 'Cancelada');
  const recebPorFatura = new Map();
  recebimentosCache.forEach((r) => recebPorFatura.set(r.faturamento_id, (recebPorFatura.get(r.faturamento_id) || 0) + Number(r.valor || 0)));
  const saldos = ativas.map((f) => {
    const rec = recebPorFatura.get(f.id) || 0;
    const emAberto = Math.max(0, Number(f.valor_fatura || 0) - rec);
    return { emAberto, pago: emAberto < 0.01 };
  });
  const totalEmAberto = saldos.reduce((s, x) => s + x.emAberto, 0);
  const pagas = saldos.filter((x) => x.pago).length;
  const emAberto = saldos.filter((x) => !x.pago).length;
  kpiEl.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon kpi-icon--blue">${ICONS.faturamento}</div>
      <div class="kpi-value">${ativas.length}</div>
      <div class="kpi-label">Faturas ativas</div>
      <div class="kpi-foot">${cache.length} no total</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-icon--amber">${ICONS.empenhos}</div>
      <div class="kpi-value">${emAberto}</div>
      <div class="kpi-label">Em aberto</div>
      <div class="kpi-foot">aguardando recebimento</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-icon--green">${ICONS.check}</div>
      <div class="kpi-value">${pagas}</div>
      <div class="kpi-label">Pagas</div>
      <div class="kpi-foot">recebimento concluído</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-icon--danger">${ICONS.faturamento}</div>
      <div class="kpi-value" style="font-family:'Source Serif 4',Georgia,serif;font-size:18px;">${formatCurrency(totalEmAberto)}</div>
      <div class="kpi-label">Valor a receber</div>
      <div class="kpi-foot">total em aberto</div>
    </div>
  `;
}

function renderTable() {
  const wrap = byId('fatura-table-container');
  const lista = filteredCache();
  if (!lista.length) {
    wrap.innerHTML = renderEmptyState(activeFilter ? 'Nenhuma fatura encontrada para este filtro.' : 'Nenhuma fatura cadastrada.');
    return;
  }
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Nº Fatura</th><th>Empenho</th><th>Órgão</th><th>Emissão</th><th>Valor</th><th>Situação</th><th>% Recebido</th><th></th></tr></thead>
      <tbody>
        ${lista.map((f) => {
          const saldo = calcSaldoFaturamento(f, recebimentosCache);
          return `
          <tr>
            <td><strong>${escapeHtml(f.numero_fatura)}</strong></td>
            <td>${escapeHtml(f.empenho?.numero_empenho || '-')}</td>
            <td>${escapeHtml(f.empenho?.orgao?.nome || '-')}</td>
            <td>${formatDate(f.data_emissao)}</td>
            <td>${formatCurrency(f.valor_fatura)}</td>
            <td>${badge(saldo.situacaoEfetiva, STATUS_COLOR[saldo.situacaoEfetiva] || 'muted')}</td>
            <td>${saldo.percentual.toFixed(0)}% <span style="color:var(--gray-500); font-size:11.5px;">(${formatCurrency(saldo.recebido)})</span></td>
            <td class="row-actions">
              <button class="icon-btn" data-action="faturamento.editar" data-id="${f.id}" title="Editar">${ICONS.edit}</button>
              ${isAdmin() ? `<button class="icon-btn" data-action="faturamento.excluir" data-id="${f.id}" title="Excluir">${ICONS.trash}</button>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

async function abrirFormulario(faturamentoId) {
  editingFaturamentoId = faturamentoId || null;
  let fatura = {
    empenho_id: '', numero_fatura: '', data_emissao: todayISO(), valor_fatura: '', situacao: 'Aberta', observacoes: '',
  };
  recebimentosEdicao = [];
  editingArquivoFile = null;

  if (!empenhosLite.length) empenhosLite = await Service.listEmpenhos();
  entregasComItem = await Service.listAllEntregasComItem();

  if (faturamentoId) {
    fatura = cache.find((f) => f.id === faturamentoId) || await Service.getFaturamento(faturamentoId);
    recebimentosEdicao = await Service.listRecebimentos(faturamentoId);
  }

  const empenhoOptions = empenhosLite
    .map((e) => `<option value="${e.id}" ${String(e.id) === String(fatura.empenho_id) ? 'selected' : ''}>${escapeHtml(e.numero_empenho)}${e.orgao?.nome ? ' — ' + escapeHtml(e.orgao.nome) : ''}</option>`)
    .join('');

  const bodyHtml = `
    <form id="fatura-form">
      ${faturamentoId && fatura.empenho ? `
        <div class="modal-nav-links">
          <button type="button" class="btn btn-ghost btn-sm" data-action="nav.go" data-page="empenhos" data-open-id="${fatura.empenho.id}">${ICONS.empenhos} Ver Empenho vinculado</button>
        </div>
      ` : ''}
      <div class="form-section-title">Dados da fatura</div>
      <div class="form-grid cols-3">
        <div class="form-field"><label>Empenho *</label><select id="f-empenho-id" required ${faturamentoId ? 'disabled' : ''}><option value="">Selecione...</option>${empenhoOptions}</select></div>
        <div class="form-field"><label>Nº da Fatura/NF *</label><input required id="f-numero-fatura" value="${escapeHtml(fatura.numero_fatura || '')}" /></div>
        <div class="form-field"><label>Data de Emissão</label><input type="date" id="f-data-emissao" value="${fatura.data_emissao || ''}" /></div>
        <div class="form-field"><label>Valor da Fatura *</label><div class="input-currency-wrap"><input required id="f-valor-fatura" value="${formatMoneyInputValue(fatura.valor_fatura)}" placeholder="0,00" /></div></div>
        <div class="form-field"><label>Situação</label><select id="f-situacao">${SITUACOES_FATURAMENTO.map((s) => `<option ${s === fatura.situacao ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="form-field span-2">
          <label>Arquivo da Nota Fiscal</label>
          <input type="file" id="f-arquivo" />
          ${fatura.arquivo_url ? `<button type="button" class="link-btn" style="margin-top:6px; text-align:left;" data-action="faturamento.verArquivo" data-url="${escapeHtml(fatura.arquivo_url)}">Ver arquivo atual</button>` : ''}
        </div>
        <div class="form-field span-3"><label>Observações</label><textarea id="f-observacoes">${escapeHtml(fatura.observacoes || '')}</textarea></div>
      </div>

      <div class="card items-table-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px; flex-wrap:wrap;">
          <strong>Entregas incluídas nesta fatura</strong>
          <button type="button" class="btn btn-ghost btn-sm" data-action="faturamento.usarValorSugerido">Usar valor sugerido</button>
        </div>
        <div id="fatura-entregas-checklist"></div>
        <div id="fatura-valor-sugerido" data-valor="0" style="margin-top:8px; font-size:12px; color:var(--gray-500);"></div>
      </div>

      ${faturamentoId ? `
        <div class="card items-table-card">
          <strong>Recebimentos</strong>
          <p style="color:var(--gray-500); font-size:12px; margin:4px 0 10px;">Pagamentos já recebidos contra esta fatura, e o saldo restante.</p>
          <div id="fatura-recebimentos-section"></div>
        </div>
      ` : ''}
    </form>
  `;

  openModal(faturamentoId ? 'Editar Fatura' : 'Nova Fatura', bodyHtml, {
    size: 'xl',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="faturamento.salvar">Salvar</button>
    `,
  });

  byId('f-empenho-id').addEventListener('change', renderEntregasChecklist);
  byId('f-arquivo').addEventListener('change', (e) => { editingArquivoFile = e.target.files?.[0] || null; });
  renderEntregasChecklist();
  if (faturamentoId) renderRecebimentosSection();
}

function entregasDisponiveis(empenhoId) {
  return entregasComItem
    .filter((e) => e.item && String(e.item.empenho_id) === String(empenhoId) && (e.faturamento_id === null || e.faturamento_id === editingFaturamentoId))
    .sort((a, b) => new Date(a.data_entrega) - new Date(b.data_entrega));
}

function renderEntregasChecklist() {
  const wrap = byId('fatura-entregas-checklist');
  if (!wrap) return;
  const empenhoId = byId('f-empenho-id').value;
  const lista = empenhoId ? entregasDisponiveis(empenhoId) : [];

  if (!empenhoId) {
    wrap.innerHTML = renderEmptyState('Selecione um Empenho para ver as entregas disponíveis.');
  } else if (!lista.length) {
    wrap.innerHTML = renderEmptyState('Nenhuma entrega pendente de faturamento para este empenho.');
  } else {
    wrap.innerHTML = `
      <div class="table-wrap items-table">
        <table class="data-table">
          <thead><tr><th></th><th>Data</th><th>Produto</th><th>Quantidade</th><th>Nota Fiscal</th><th>Valor</th></tr></thead>
          <tbody>
            ${lista.map((e) => {
              const checked = editingFaturamentoId !== null && e.faturamento_id === editingFaturamentoId;
              const valorItem = parseNumber(e.item?.valor_unitario) * parseNumber(e.quantidade);
              return `
              <tr>
                <td><input type="checkbox" value="${e.id}" data-valor="${valorItem}" ${checked ? 'checked' : ''} /></td>
                <td>${formatDate(e.data_entrega)}</td>
                <td>${escapeHtml(e.item?.produto_descricao || '-')}</td>
                <td>${e.quantidade}</td>
                <td>${escapeHtml(e.numero_nota_fiscal || '-')}</td>
                <td>${formatCurrency(valorItem)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  wrap.querySelectorAll('input[type="checkbox"]').forEach((el) => el.addEventListener('change', atualizarValorSugerido));
  atualizarValorSugerido();
}

function atualizarValorSugerido() {
  const wrap = byId('fatura-entregas-checklist');
  const hint = byId('fatura-valor-sugerido');
  if (!wrap || !hint) return;
  const total = [...wrap.querySelectorAll('input[type="checkbox"]:checked')]
    .reduce((acc, el) => acc + Number(el.dataset.valor || 0), 0);
  hint.dataset.valor = total;
  hint.textContent = `Soma das entregas marcadas: ${formatCurrency(total)}`;
}

function usarValorSugerido() {
  const hint = byId('fatura-valor-sugerido');
  byId('f-valor-fatura').value = formatMoneyInputValue(Number(hint?.dataset.valor || 0));
}

function renderRecebimentosSection() {
  const wrap = byId('fatura-recebimentos-section');
  if (!wrap) return;
  const fatura = cache.find((f) => f.id === editingFaturamentoId) || { id: editingFaturamentoId, valor_fatura: parseNumber(byId('f-valor-fatura')?.value) };
  const saldo = calcSaldoFaturamento(fatura, recebimentosEdicao);

  wrap.innerHTML = `
    <div class="progress-track"><div class="progress-fill" style="width:${saldo.percentual}%;"></div></div>
    <div style="font-size:12px; color:var(--gray-500); margin:4px 0 14px;">
      Recebido ${formatCurrency(saldo.recebido)} de ${formatCurrency(fatura.valor_fatura)} (${saldo.percentual.toFixed(0)}%) · Saldo a receber ${formatCurrency(saldo.restante)}
    </div>
    ${recebimentosEdicao.length ? `
      <table class="data-table" style="margin-bottom:12px;">
        <thead><tr><th>Data</th><th>Valor</th><th>Forma</th><th>Observação</th><th></th></tr></thead>
        <tbody>
          ${recebimentosEdicao.map((r) => `
            <tr>
              <td>${formatDate(r.data_recebimento)}</td>
              <td>${formatCurrency(r.valor)}</td>
              <td>${escapeHtml(r.forma_recebimento || '-')}</td>
              <td>${escapeHtml(r.observacao || '-')}</td>
              <td class="row-actions">${canWrite() ? `<button type="button" class="icon-btn" data-action="faturamento.excluirRecebimento" data-id="${r.id}">${ICONS.trash}</button>` : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>` : renderEmptyState('Nenhum recebimento lançado ainda.')}

    ${canWrite() ? `
      <div class="form-grid cols-3" style="align-items:end;">
        <div class="form-field"><label>Data do recebimento</label><input type="date" id="novo-recebimento-data" value="${todayISO()}" /></div>
        <div class="form-field"><label>Valor</label><div class="input-currency-wrap"><input id="novo-recebimento-valor" placeholder="0,00" /></div></div>
        <div class="form-field"><label>Forma</label><input type="text" id="novo-recebimento-forma" placeholder="Depósito, TED..." /></div>
        <div class="form-field span-2"><label>Observação</label><input type="text" id="novo-recebimento-obs" /></div>
        <div class="form-field"><button type="button" class="btn btn-primary" data-action="faturamento.addRecebimento">${ICONS.plus} Lançar</button></div>
      </div>` : ''}
  `;
}

async function addRecebimentoHandler() {
  const valor = parseNumber(byId('novo-recebimento-valor').value);
  if (!valor) {
    showToast('Informe o valor recebido.', 'error');
    return;
  }
  try {
    await Service.addRecebimento({
      faturamento_id: editingFaturamentoId,
      data_recebimento: byId('novo-recebimento-data').value || todayISO(),
      valor,
      forma_recebimento: byId('novo-recebimento-forma').value.trim() || null,
      observacao: byId('novo-recebimento-obs').value.trim() || null,
    });
    showToast('Recebimento lançado.', 'success');
    recebimentosEdicao = await Service.listRecebimentos(editingFaturamentoId);
    renderRecebimentosSection();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao lançar recebimento.', 'error');
  }
}

async function excluirRecebimentoHandler(target) {
  const ok = await confirmDialog('Remover este recebimento?');
  if (!ok) return;
  try {
    await Service.deleteRecebimento(Number(target.dataset.id));
    recebimentosEdicao = recebimentosEdicao.filter((r) => r.id !== Number(target.dataset.id));
    renderRecebimentosSection();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao remover recebimento.', 'error');
  }
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
  const empenhoId = byId('f-empenho-id').value;
  const numeroFatura = byId('f-numero-fatura').value.trim();
  const valorFatura = parseNumber(byId('f-valor-fatura').value);

  if (!empenhoId) {
    showToast('Selecione o Empenho vinculado.', 'error');
    return;
  }
  if (!numeroFatura) {
    showToast('Informe o número da fatura/NF.', 'error');
    return;
  }
  if (!valorFatura) {
    showToast('Informe o valor da fatura.', 'error');
    return;
  }

  const checkedIds = [...byId('fatura-entregas-checklist').querySelectorAll('input[type="checkbox"]:checked')].map((el) => Number(el.value));
  if (!checkedIds.length) {
    showToast('Selecione ao menos uma entrega para incluir nesta fatura.', 'error');
    return;
  }

  const payload = {
    empenho_id: Number(empenhoId),
    numero_fatura: numeroFatura,
    data_emissao: byId('f-data-emissao').value || null,
    valor_fatura: valorFatura,
    situacao: byId('f-situacao').value,
    observacoes: byId('f-observacoes').value.trim() || null,
  };

  try {
    let faturaId = editingFaturamentoId;
    if (faturaId) {
      await Service.updateFaturamento(faturaId, payload);
    } else {
      const created = await Service.createFaturamento(payload);
      faturaId = created.id;
    }

    if (editingArquivoFile) {
      const path = await Service.uploadFaturamentoArquivo(editingArquivoFile, faturaId);
      await Service.updateFaturamento(faturaId, { arquivo_url: path });
    }

    const previamenteLigadas = entregasComItem
      .filter((e) => editingFaturamentoId !== null && e.faturamento_id === editingFaturamentoId)
      .map((e) => e.id);
    const paraDesvincular = previamenteLigadas.filter((id) => !checkedIds.includes(id));

    await Service.marcarEntregasFaturamento(checkedIds, faturaId);
    if (paraDesvincular.length) await Service.marcarEntregasFaturamento(paraDesvincular, null);

    showToast('Fatura salva com sucesso.', 'success');
    closeModal();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar fatura.', 'error');
  }
}

async function excluir(target) {
  const id = Number(target.dataset.id);
  const ok = await confirmDialog('Tem certeza que deseja excluir esta fatura? As entregas vinculadas voltam a ficar disponíveis para uma nova fatura.');
  if (!ok) return;
  try {
    await Service.deleteFaturamento(id);
    showToast('Fatura excluída.', 'success');
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao excluir fatura.', 'error');
  }
}

export const actions = {
  'faturamento.novo': () => abrirFormulario(null),
  'faturamento.editar': (target) => abrirFormulario(Number(target.dataset.id)),
  'faturamento.excluir': (target) => excluir(target),
  'faturamento.usarValorSugerido': () => usarValorSugerido(),
  'faturamento.addRecebimento': () => addRecebimentoHandler(),
  'faturamento.excluirRecebimento': (target) => excluirRecebimentoHandler(target),
  'faturamento.salvar': () => salvar(),
  'faturamento.limparFiltro': () => limparFiltro(),
  'faturamento.verArquivo': (target) => verArquivo(target),
};
