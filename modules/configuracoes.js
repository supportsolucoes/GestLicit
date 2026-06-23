import * as Service from '../supabase-service.js';
import { refreshLookups, currentUser } from '../state.js';
import { byId, escapeHtml } from '../helpers.js';
import { openModal, closeModal, showToast, badge, renderEmptyState } from '../ui.js';
import { ROLES, ICONS } from '../constants.js';

let cache = [];

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Configurações</h1>
        <p>Usuários e perfis de acesso da equipe.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px; font-size:13px; color:var(--gray-500);">
      Novos usuários se cadastram pela tela de login ("Criar conta") e recebem o perfil <strong>Consulta</strong> até serem promovidos aqui.
    </div>

    <div class="card table-wrap"><div id="config-table"></div></div>
  `;
  await reload();
}

async function reload() {
  cache = await Service.Profiles.list();
  renderTable();
}

function renderTable() {
  const wrap = byId('config-table');
  if (!cache.length) {
    wrap.innerHTML = renderEmptyState('Nenhum usuário cadastrado ainda.');
    return;
  }
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${cache.map((p) => `
          <tr>
            <td>${escapeHtml(p.nome)}${p.id === currentUser()?.id ? ' <span style="color:var(--gray-500); font-size:12px;">(você)</span>' : ''}</td>
            <td>${escapeHtml(p.email)}</td>
            <td>${badge(ROLES.find((r) => r.id === p.role)?.label || p.role, 'info')}</td>
            <td>${p.ativo ? badge('Ativo', 'success') : badge('Inativo', 'muted')}</td>
            <td class="row-actions">
              <button class="icon-btn" data-action="configuracoes.editar" data-id="${p.id}" title="Editar">${ICONS.edit}</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function abrirFormulario(id) {
  const profile = cache.find((p) => p.id === id);
  if (!profile) return;
  const bodyHtml = `
    <div class="form-grid">
      <div class="form-field span-2"><label>Nome</label><input id="f-cfg-nome" value="${escapeHtml(profile.nome || '')}" /></div>
      <div class="form-field"><label>Perfil de acesso</label>
        <select id="f-cfg-role">${ROLES.map((r) => `<option value="${r.id}" ${r.id === profile.role ? 'selected' : ''}>${r.label}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>Status</label>
        <select id="f-cfg-ativo"><option value="true" ${profile.ativo ? 'selected' : ''}>Ativo</option><option value="false" ${!profile.ativo ? 'selected' : ''}>Inativo</option></select>
      </div>
    </div>
  `;
  openModal('Editar usuário', bodyHtml, {
    size: 'sm',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="configuracoes.salvar" data-id="${id}">Salvar</button>
    `,
  });
}

async function salvar(target) {
  const id = target.dataset.id;
  try {
    await Service.Profiles.update(id, {
      nome: byId('f-cfg-nome').value.trim(),
      role: byId('f-cfg-role').value,
      ativo: byId('f-cfg-ativo').value === 'true',
    });
    showToast('Usuário atualizado.', 'success');
    closeModal();
    await reload();
    await refreshLookups();
  } catch (err) {
    showToast(err.message || 'Erro ao atualizar usuário.', 'error');
  }
}

export const actions = {
  'configuracoes.editar': (target) => abrirFormulario(target.dataset.id),
  'configuracoes.salvar': (target) => salvar(target),
};
