import { byId, escapeHtml } from './helpers.js';
import { ICONS } from './constants.js';

export function showToast(message, type = 'success') {
  const toast = byId('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    toast.className = 'toast';
  }, 2800);
}

export function setLoading(isLoading) {
  byId('loading-overlay')?.classList.toggle('hidden', !isLoading);
}

export function openModal(title, bodyHtml, { size = 'md', footerHtml = '' } = {}) {
  const root = byId('modal-root');
  root.innerHTML = `
    <div class="modal-overlay show" data-action="modal.backdrop">
      <div class="modal modal-${size}" data-modal-content>
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button type="button" class="icon-btn" data-action="modal.close">${ICONS.close}</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
      </div>
    </div>
  `;
  const overlay = root.querySelector('.modal-overlay');
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeModal();
  });
  return overlay;
}

export function closeModal() {
  const root = byId('modal-root');
  if (root) root.innerHTML = '';
}

export function confirmDialog(message, { title = 'Confirmar ação', confirmLabel = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    openModal(title, `<p>${message}</p>`, {
      size: 'sm',
      footerHtml: `
        <button type="button" class="btn btn-ghost" data-action="modal.cancel">Cancelar</button>
        <button type="button" class="btn btn-danger" data-action="modal.confirm">${confirmLabel}</button>
      `,
    });
    const root = byId('modal-root');
    const finish = (result) => {
      closeModal();
      resolve(result);
    };
    root.querySelector('[data-action="modal.confirm"]').addEventListener('click', () => finish(true));
    root.querySelector('[data-action="modal.cancel"]').addEventListener('click', () => finish(false));
    root.querySelector('[data-action="modal.close"]')?.addEventListener('click', () => finish(false));
  });
}

export function renderEmptyState(message) {
  return `<div class="empty-state">
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="44" height="44">
      <rect x="6" y="8" width="36" height="32" rx="3"/>
      <path d="M6 24h10l4 5h8l4-5h10"/>
    </svg>
    ${message}
  </div>`;
}

export function badge(label, variant = 'muted') {
  return `<span class="badge badge-${variant}">${label}</span>`;
}
