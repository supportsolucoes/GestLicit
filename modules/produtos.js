import * as Service from '../supabase-service.js';
import { refreshLookups, canWrite, isAdmin } from '../state.js';
import { buildCrudModule } from './_crud.js';
import { formatCurrency, formatDate, formatNumber, escapeHtml, byId, parseNumber, todayISO } from '../helpers.js';
import { openModal, confirmDialog, showToast, renderEmptyState } from '../ui.js';
import { ICONS } from '../constants.js';

let acervoCache = [];
let acervoProdutoId = null;
let acervoProdutoNome = '';

const mod = buildCrudModule({
  actionPrefix: 'produtos',
  service: Service.Produtos,
  title: 'Produtos',
  singular: 'Produto',
  description: 'Catálogo de produtos: código, fabricante e preço de custo.',
  searchKeys: ['nome', 'fabricante', 'codigo_sinc'],
  columns: [
    { key: 'codigo_sinc', label: 'Código' },
    { key: 'nome', label: 'Nome' },
    { key: 'fabricante', label: 'Fabricante' },
    { key: 'preco_custo', label: 'Preço de custo', render: (r) => formatCurrency(r.preco_custo) },
  ],
  fields: [
    { key: 'codigo_sinc', label: 'Código' },
    { key: 'nome', label: 'Nome do Produto', required: true, span: 2 },
    { key: 'fabricante', label: 'Fabricante' },
    { key: 'preco_custo', label: 'Preço de custo', type: 'currency' },
    { key: 'sinonimos', label: 'Nomes similares (separados por vírgula)', type: 'tags', span: 2 },
  ],
  afterChange: refreshLookups,
  extraRowActions: (r) => `<button class="icon-btn" data-action="produtos.acervo" data-id="${r.id}" data-nome="${escapeHtml(r.nome)}" title="Acervo Técnico">${ICONS.certidoes}</button>`,
});

export const render = mod.render;

// ============================================================
// Acervo Técnico
// ============================================================

async function abrirAcervo(target) {
  acervoProdutoId = Number(target.dataset.id);
  acervoProdutoNome = target.dataset.nome || '';
  acervoCache = await Service.listAtestadosByProduto(acervoProdutoId);

  const html = `
    <div>
      <div id="acervo-resumo"></div>
      <div id="acervo-lista"></div>

      ${canWrite() ? `
        <div class="form-section-title" style="margin-top:20px;">Adicionar Atestado</div>
        <div class="form-grid cols-3">
          <div class="form-field"><label>Data de Emissão</label><input type="date" id="a-data" value="${todayISO()}" /></div>
          <div class="form-field"><label>Quantidade Atestada *</label><input type="text" id="a-qtd" placeholder="0" /></div>
          <div class="form-field span-3"><label>Órgão Emissor</label><input type="text" id="a-orgao" placeholder="Nome do órgão que emitiu o atestado..." /></div>
          <div class="form-field"><label>Nº Empenho de Referência</label><input type="text" id="a-empenho" /></div>
          <div class="form-field span-2"><label>Arquivo (PDF/imagem)</label><input type="file" id="a-arquivo" accept=".pdf,.jpg,.jpeg,.png" /></div>
          <div class="form-field span-3"><label>Observações</label><input type="text" id="a-obs" /></div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-action="produtos.addAtestado">${ICONS.plus} Adicionar</button>
      ` : ''}
    </div>
  `;

  openModal(`Acervo Técnico — ${acervoProdutoNome}`, html, {
    size: 'lg',
    footerHtml: `<button type="button" class="btn btn-ghost" data-action="modal.close">Fechar</button>`,
  });

  renderAcervoResumo();
  renderAcervoLista();
}

function renderAcervoResumo() {
  const wrap = byId('acervo-resumo');
  if (!wrap) return;
  const total = acervoCache.reduce((s, a) => s + Number(a.quantidade_atestada || 0), 0);
  wrap.innerHTML = `
    <div style="display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap;">
      <div class="card" style="flex:1; text-align:center; padding:12px 16px;">
        <div style="font-size:26px; font-weight:700; color:var(--primary);">${formatNumber(total, 0)}</div>
        <div style="font-size:12px; color:var(--gray-500);">unidades atestadas no total</div>
      </div>
      <div class="card" style="flex:1; text-align:center; padding:12px 16px;">
        <div style="font-size:26px; font-weight:700; color:var(--primary);">${acervoCache.length}</div>
        <div style="font-size:12px; color:var(--gray-500);">atestados cadastrados</div>
      </div>
    </div>
  `;
}

function renderAcervoLista() {
  const wrap = byId('acervo-lista');
  if (!wrap) return;

  if (!acervoCache.length) {
    wrap.innerHTML = renderEmptyState('Nenhum atestado cadastrado. Adicione abaixo.');
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Data</th><th>Órgão Emissor</th><th>Qtd. Atestada</th><th>Empenho Ref.</th><th>Arquivo</th><th></th></tr>
      </thead>
      <tbody>
        ${acervoCache.map((a) => `
          <tr>
            <td>${formatDate(a.data_emissao)}</td>
            <td>${escapeHtml(a.orgao_emissor || '-')}</td>
            <td><strong>${formatNumber(a.quantidade_atestada, 0)}</strong></td>
            <td>${escapeHtml(a.numero_empenho || '-')}</td>
            <td>${a.arquivo_url ? `<button class="link-btn" data-action="produtos.verAtestado" data-url="${escapeHtml(a.arquivo_url)}">Ver PDF</button>` : '-'}</td>
            <td class="row-actions">${isAdmin() ? `<button class="icon-btn" data-action="produtos.excluirAtestado" data-id="${a.id}">${ICONS.trash}</button>` : ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function addAtestado() {
  const qtd = parseNumber(byId('a-qtd')?.value);
  if (!qtd) {
    showToast('Informe a quantidade atestada.', 'error');
    return;
  }

  try {
    let arquivo_url = null;
    const arquivo = byId('a-arquivo')?.files?.[0];
    if (arquivo) {
      arquivo_url = await Service.uploadAtestadoProduto(arquivo, acervoProdutoId);
    }

    const novo = await Service.createAtestadoProduto({
      produto_id: acervoProdutoId,
      data_emissao: byId('a-data')?.value || null,
      quantidade_atestada: qtd,
      orgao_emissor: byId('a-orgao')?.value.trim() || null,
      numero_empenho: byId('a-empenho')?.value.trim() || null,
      observacoes: byId('a-obs')?.value.trim() || null,
      arquivo_url,
    });

    acervoCache.unshift(novo);

    ['a-qtd', 'a-orgao', 'a-empenho', 'a-obs'].forEach((id) => { const el = byId(id); if (el) el.value = ''; });
    if (byId('a-arquivo')) byId('a-arquivo').value = '';

    renderAcervoResumo();
    renderAcervoLista();
    showToast('Atestado adicionado.', 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao adicionar atestado.', 'error');
  }
}

async function excluirAtestado(target) {
  const ok = await confirmDialog('Remover este atestado?');
  if (!ok) return;
  const id = Number(target.dataset.id);
  try {
    await Service.deleteAtestadoProduto(id);
    acervoCache = acervoCache.filter((a) => a.id !== id);
    renderAcervoResumo();
    renderAcervoLista();
    showToast('Atestado removido.', 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao remover.', 'error');
  }
}

async function verAtestado(target) {
  try {
    const url = await Service.getSignedUrl(target.dataset.url);
    window.open(url, '_blank');
  } catch (err) {
    showToast(err.message || 'Erro ao gerar link.', 'error');
  }
}

export const actions = {
  ...mod.actions,
  'produtos.acervo': (target) => abrirAcervo(target),
  'produtos.addAtestado': () => addAtestado(),
  'produtos.excluirAtestado': (target) => excluirAtestado(target),
  'produtos.verAtestado': (target) => verAtestado(target),
};
