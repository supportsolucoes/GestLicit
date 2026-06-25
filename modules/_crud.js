import { canWrite, isAdmin, refreshLookups } from '../state.js';
import { byId, escapeHtml, parseNumber, formatMoneyInputValue } from '../helpers.js';
import { openModal, closeModal, confirmDialog, showToast, renderEmptyState } from '../ui.js';
import { ICONS } from '../constants.js';

function fieldValue(field, record) {
  const raw = record?.[field.key];
  if (field.type === 'tags') return (raw || []).join(', ');
  return raw ?? '';
}

function renderField(field, record) {
  const value = fieldValue(field, record);
  const id = `f-${field.key}`;
  const spanClass = field.span === 2 ? ' span-2' : '';

  let inputHtml;
  if (field.type === 'select') {
    inputHtml = `<select id="${id}">${field.options.map((opt) => {
      const optValue = typeof opt === 'object' ? opt.value : opt;
      const optLabel = typeof opt === 'object' ? opt.label : opt;
      return `<option value="${escapeHtml(optValue)}" ${String(optValue) === String(value) ? 'selected' : ''}>${escapeHtml(optLabel)}</option>`;
    }).join('')}</select>`;
  } else if (field.type === 'textarea') {
    inputHtml = `<textarea id="${id}">${escapeHtml(value)}</textarea>`;
  } else if (field.type === 'checkbox') {
    inputHtml = `<div class="checkbox-field" style="height:38px;"><input type="checkbox" id="${id}" ${record?.[field.key] ? 'checked' : ''} /> ${field.checkboxLabel || 'Sim'}</div>`;
  } else if (field.type === 'date') {
    inputHtml = `<input type="date" id="${id}" value="${escapeHtml(value)}" />`;
  } else if (field.type === 'number') {
    inputHtml = `<input type="text" id="${id}" value="${escapeHtml(value)}" />`;
  } else if (field.type === 'currency') {
    inputHtml = `<div class="input-currency-wrap"><input type="text" id="${id}" value="${formatMoneyInputValue(value)}" placeholder="0,00" /></div>`;
  } else if (field.type === 'file') {
    inputHtml = `<input type="file" id="${id}" />${record?.arquivo_url ? `<div style="font-size:12px;color:var(--gray-500);margin-top:4px;">Arquivo atual: ${escapeHtml(record.nome_arquivo || 'anexo')}</div>` : ''}`;
  } else {
    inputHtml = `<input type="text" id="${id}" value="${escapeHtml(value)}" />`;
  }

  return `<div class="form-field${spanClass}"><label>${field.label}${field.required ? ' *' : ''}</label>${inputHtml}</div>`;
}

function readFieldValue(field) {
  const el = byId(`f-${field.key}`);
  if (!el) return undefined;
  if (field.type === 'checkbox') return el.checked;
  if (field.type === 'file') return el.files?.[0] || null;
  if (field.type === 'tags') return el.value.split(',').map((s) => s.trim()).filter(Boolean);
  if (field.type === 'number' || field.type === 'currency') return parseNumber(el.value);
  return el.value.trim();
}

export function buildCrudModule(config) {
  let cache = [];

  async function reload() {
    cache = await config.service.list();
    if (config.afterChange) await config.afterChange();
  }

  function matchesSearch(record, term) {
    if (!term) return true;
    const haystack = (config.searchKeys || []).map((k) => String(record[k] || '')).join(' ').toLowerCase();
    return haystack.includes(term);
  }

  async function render(container) {
    container.innerHTML = `
      <div class="page-header">
        <div><h1>${config.title}</h1><p>${config.description || ''}</p></div>
        ${canWrite() ? `<button class="btn btn-primary" data-action="${config.actionPrefix}.novo">${ICONS.plus}Novo</button>` : ''}
      </div>
      <div class="card" style="margin-bottom:16px;">
        <div class="form-field" style="max-width:360px; margin:0;">
          <input type="text" id="${config.actionPrefix}-busca" placeholder="Buscar..." />
        </div>
      </div>
      <div class="card table-wrap"><div id="${config.actionPrefix}-table"></div></div>
    `;
    byId(`${config.actionPrefix}-busca`).addEventListener('input', renderTable);
    await reload();
    renderTable();
  }

  function renderTable() {
    const term = (byId(`${config.actionPrefix}-busca`)?.value || '').toLowerCase();
    const filtered = cache.filter((r) => matchesSearch(r, term));
    const wrap = byId(`${config.actionPrefix}-table`);
    if (!filtered.length) {
      wrap.innerHTML = renderEmptyState('Nenhum registro encontrado.');
      return;
    }
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>${config.columns.map((c) => `<th>${c.label}</th>`).join('')}<th></th></tr></thead>
        <tbody>
          ${filtered.map((r) => `
            <tr>
              ${config.columns.map((c) => `<td>${c.render ? c.render(r) : escapeHtml(r[c.key] ?? '-')}</td>`).join('')}
              <td class="row-actions">
                ${config.extraRowActions ? config.extraRowActions(r) : ''}
                <button class="icon-btn" data-action="${config.actionPrefix}.editar" data-id="${r.id}" title="Editar">${ICONS.edit}</button>
                ${isAdmin() ? `<button class="icon-btn" data-action="${config.actionPrefix}.excluir" data-id="${r.id}" title="Excluir">${ICONS.trash}</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  async function abrirFormulario(id) {
    const record = id ? cache.find((r) => r.id === id) : null;
    const bodyHtml = `<div class="form-grid">${config.fields.map((f) => renderField(f, record)).join('')}</div>`;
    openModal(id ? `Editar ${config.singular || config.title}` : `Novo ${config.singular || config.title}`, bodyHtml, {
      size: config.modalSize || 'md',
      footerHtml: `
        <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
        <button type="button" class="btn btn-primary" data-action="${config.actionPrefix}.salvar" data-id="${id || ''}">Salvar</button>
      `,
    });
  }

  async function salvar(target) {
    const id = target.dataset.id ? Number(target.dataset.id) : null;
    const payload = {};
    const fileFields = [];
    for (const field of config.fields) {
      const value = readFieldValue(field);
      if (field.type === 'file') { fileFields.push(field); continue; }
      payload[field.key] = value === '' ? null : value;
    }
    if (config.transformPayload) Object.assign(payload, config.transformPayload(payload));

    const missing = config.fields.find((f) => f.required && !payload[f.key] && f.type !== 'file');
    if (missing) {
      showToast(`Informe o campo "${missing.label}".`, 'error');
      return;
    }

    try {
      let saved;
      if (id) saved = await config.service.update(id, payload);
      else saved = await config.service.create(payload);

      for (const field of fileFields) {
        const file = readFieldValue(field);
        if (file && config.onFileUpload) await config.onFileUpload(saved, file);
      }

      showToast('Registro salvo com sucesso.', 'success');
      closeModal();
      await reload();
      renderTable();
    } catch (err) {
      showToast(err.message || 'Erro ao salvar registro.', 'error');
    }
  }

  async function excluir(target) {
    const id = Number(target.dataset.id);
    const ok = await confirmDialog('Tem certeza que deseja excluir este registro?');
    if (!ok) return;
    try {
      await config.service.remove(id);
      showToast('Registro excluído.', 'success');
      await reload();
      renderTable();
    } catch (err) {
      showToast(err.message || 'Erro ao excluir registro.', 'error');
    }
  }

  const actions = {
    [`${config.actionPrefix}.novo`]: () => abrirFormulario(null),
    [`${config.actionPrefix}.editar`]: (target) => abrirFormulario(Number(target.dataset.id)),
    [`${config.actionPrefix}.salvar`]: (target) => salvar(target),
    [`${config.actionPrefix}.excluir`]: (target) => excluir(target),
  };

  return { render, actions };
}
