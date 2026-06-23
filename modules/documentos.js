import * as Service from '../supabase-service.js';
import { canWrite, isAdmin, currentUser } from '../state.js';
import { byId, escapeHtml, formatDate } from '../helpers.js';
import { openModal, closeModal, confirmDialog, showToast, renderEmptyState, badge } from '../ui.js';
import { CATEGORIAS_DOCUMENTO, ICONS } from '../constants.js';

let cache = [];

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Documentos</h1>
        <p>Repositório central de editais, propostas, atas assinadas, pareceres e certidões.</p>
      </div>
      ${canWrite() ? `<button class="btn btn-primary" data-action="documentos.novo">${ICONS.plus}Enviar documento</button>` : ''}
    </div>

    <div class="card" style="margin-bottom:16px; display:flex; gap:12px; flex-wrap:wrap;">
      <input type="text" id="doc-busca" placeholder="Buscar por nome do arquivo..." style="flex:1; min-width:220px; border:1px solid var(--gray-200); border-radius:8px; padding:9px 11px;" />
      <select id="doc-filtro-categoria" style="border:1px solid var(--gray-200); border-radius:8px; padding:9px 11px;">
        <option value="">Todas as categorias</option>
        ${CATEGORIAS_DOCUMENTO.map((c) => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>

    <div class="card table-wrap"><div id="doc-table"></div></div>
  `;

  byId('doc-busca').addEventListener('input', renderTable);
  byId('doc-filtro-categoria').addEventListener('change', renderTable);

  await reload();
}

async function reload() {
  cache = await Service.listDocumentos();
  renderTable();
}

function renderTable() {
  const term = (byId('doc-busca')?.value || '').toLowerCase();
  const categoria = byId('doc-filtro-categoria')?.value || '';
  const filtered = cache.filter((d) => {
    if (categoria && d.categoria !== categoria) return false;
    if (term && !d.nome_arquivo.toLowerCase().includes(term)) return false;
    return true;
  });

  const wrap = byId('doc-table');
  if (!filtered.length) {
    wrap.innerHTML = renderEmptyState('Nenhum documento encontrado.');
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Categoria</th><th>Arquivo</th><th>Referência</th><th>Enviado em</th><th></th></tr></thead>
      <tbody>
        ${filtered.map((d) => `
          <tr>
            <td>${badge(d.categoria, 'info')}</td>
            <td>${escapeHtml(d.nome_arquivo)}</td>
            <td>${escapeHtml(d.referencia_tipo || '-')}</td>
            <td>${formatDate(d.created_at)}</td>
            <td class="row-actions">
              <button class="icon-btn" data-action="documentos.baixar" data-id="${d.id}" title="Baixar">${ICONS.download}</button>
              ${isAdmin() ? `<button class="icon-btn" data-action="documentos.excluir" data-id="${d.id}" title="Excluir">${ICONS.trash}</button>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function abrirFormulario() {
  const bodyHtml = `
    <div class="form-grid">
      <div class="form-field"><label>Categoria *</label><select id="f-doc-categoria">${CATEGORIAS_DOCUMENTO.map((c) => `<option>${c}</option>`).join('')}</select></div>
      <div class="form-field"><label>Referência (opcional)</label><input id="f-doc-referencia" placeholder="Ex.: Pregão 90716/2025" /></div>
      <div class="form-field span-2"><label>Arquivo *</label><input type="file" id="f-doc-arquivo" required /></div>
    </div>
  `;
  openModal('Enviar documento', bodyHtml, {
    size: 'sm',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="documentos.salvar">Enviar</button>
    `,
  });
}

async function salvar() {
  const file = byId('f-doc-arquivo').files?.[0];
  if (!file) {
    showToast('Selecione um arquivo.', 'error');
    return;
  }
  try {
    await Service.uploadDocumento(file, {
      categoria: byId('f-doc-categoria').value,
      referenciaTipo: byId('f-doc-referencia').value.trim() || null,
      referenciaId: null,
      uploadedBy: currentUser()?.id || null,
    });
    showToast('Documento enviado com sucesso.', 'success');
    closeModal();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao enviar documento.', 'error');
  }
}

async function baixar(target) {
  const doc = cache.find((d) => d.id === Number(target.dataset.id));
  if (!doc) return;
  try {
    const url = await Service.getSignedUrl(doc.arquivo_url);
    window.open(url, '_blank');
  } catch (err) {
    showToast(err.message || 'Erro ao gerar link de download.', 'error');
  }
}

async function excluir(target) {
  const doc = cache.find((d) => d.id === Number(target.dataset.id));
  if (!doc) return;
  const ok = await confirmDialog('Excluir este documento permanentemente?');
  if (!ok) return;
  try {
    await Service.deleteDocumento(doc);
    showToast('Documento excluído.', 'success');
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao excluir documento.', 'error');
  }
}

export const actions = {
  'documentos.novo': () => abrirFormulario(),
  'documentos.salvar': () => salvar(),
  'documentos.baixar': (target) => baixar(target),
  'documentos.excluir': (target) => excluir(target),
};
