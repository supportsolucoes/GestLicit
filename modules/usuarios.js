import * as Service from '../supabase-service.js';
import { refreshLookups, currentUser } from '../state.js';
import { byId, escapeHtml } from '../helpers.js';
import { openModal, closeModal, showToast, badge, renderEmptyState } from '../ui.js';
import { ROLES, ICONS, PAGE_META } from '../constants.js';

let cache = [];

const PAGINAS_GRANTABLE = PAGE_META.filter((p) => p.id !== 'usuarios' && p.id !== 'dashboard');

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Usuários</h1>
        <p>Perfis de acesso e páginas liberadas para cada usuário da equipe.</p>
      </div>
      <button class="btn btn-primary" data-action="usuarios.novo">${ICONS.plus}Novo Usuário</button>
    </div>

    <div class="card" style="margin-bottom:16px; font-size:13px; color:var(--gray-500);">
      Administrador tem acesso a tudo. Usuário só vê e acessa as páginas marcadas no cadastro dele.
    </div>

    <div class="card table-wrap"><div id="usuarios-table"></div></div>
  `;
  await reload();
}

async function reload() {
  cache = await Service.Profiles.list();
  renderTable();
}

function renderTable() {
  const wrap = byId('usuarios-table');
  if (!cache.length) {
    wrap.innerHTML = renderEmptyState('Nenhum usuário cadastrado ainda.');
    return;
  }
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Páginas</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${cache.map((p) => `
          <tr>
            <td>${escapeHtml(p.nome)}${p.id === currentUser()?.id ? ' <span style="color:var(--gray-500); font-size:12px;">(você)</span>' : ''}</td>
            <td>${escapeHtml(p.email)}</td>
            <td>${badge(ROLES.find((r) => r.id === p.role)?.label || p.role, p.role === 'administrador' ? 'info' : 'muted')}</td>
            <td style="font-size:12.5px; color:var(--gray-500);">${p.role === 'administrador' ? 'Todas' : `${(p.paginas_permitidas || []).length} de ${PAGINAS_GRANTABLE.length}`}</td>
            <td>${p.ativo ? badge('Ativo', 'success') : badge('Inativo', 'muted')}</td>
            <td class="row-actions">
              <button class="icon-btn" data-action="usuarios.editar" data-id="${p.id}" title="Editar">${ICONS.edit}</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function paginasChecklistHtml(idPrefix, selecionadas) {
  const set = new Set(selecionadas || []);
  return `
    <div class="tag-check-list">
      ${PAGINAS_GRANTABLE.map((p) => `
        <label class="tag-check-row">
          <input type="checkbox" id="${idPrefix}-${p.id}" value="${p.id}" ${set.has(p.id) ? 'checked' : ''} />
          <span>${escapeHtml(p.label)}</span>
        </label>
      `).join('')}
    </div>
  `;
}

function readChecklist(idPrefix) {
  return PAGINAS_GRANTABLE
    .map((p) => p.id)
    .filter((id) => byId(`${idPrefix}-${id}`)?.checked);
}

// ============================================================
// Novo usuário (via Edge Function — precisa de privilégio de admin)
// ============================================================
function abrirFormularioNovo() {
  const bodyHtml = `
    <div class="form-grid">
      <div class="form-field span-2"><label>Nome *</label><input id="f-novo-nome" /></div>
      <div class="form-field"><label>E-mail *</label><input type="email" id="f-novo-email" /></div>
      <div class="form-field"><label>Senha provisória *</label>
        <div class="pw-wrap">
          <input type="password" id="f-novo-senha" placeholder="Mín. 6 caracteres" autocomplete="new-password" />
          <button type="button" class="btn-eye" id="btn-eye-novo-senha" tabindex="-1" title="Mostrar senha"></button>
        </div>
      </div>
      <div class="form-field span-2">
        <label>Perfil de acesso</label>
        <select id="f-novo-role">${ROLES.map((r) => `<option value="${r.id}" ${r.id === 'usuario' ? 'selected' : ''}>${r.label}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-field" id="f-novo-paginas-wrap" style="margin-top:14px;">
      <label>Páginas liberadas</label>
      ${paginasChecklistHtml('f-novo-pag', [])}
    </div>
  `;
  openModal('Novo usuário', bodyHtml, {
    size: 'sm',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="usuarios.criar">Criar usuário</button>
    `,
  });
  // Toggle mostrar/ocultar senha provisória
  const btnEye = byId('btn-eye-novo-senha');
  const inpSenha = byId('f-novo-senha');
  if (btnEye && inpSenha) {
    btnEye.innerHTML = ICONS.eye;
    btnEye.addEventListener('click', () => {
      const show = inpSenha.type === 'password';
      inpSenha.type = show ? 'text' : 'password';
      btnEye.innerHTML = show ? ICONS.eyeOff : ICONS.eye;
      btnEye.title = show ? 'Ocultar senha' : 'Mostrar senha';
    });
  }
  const syncPaginasVisibility = () => {
    byId('f-novo-paginas-wrap').style.display = byId('f-novo-role').value === 'administrador' ? 'none' : '';
  };
  byId('f-novo-role').addEventListener('change', syncPaginasVisibility);
  syncPaginasVisibility();
}

async function criarUsuario() {
  const nome = byId('f-novo-nome').value.trim();
  const email = byId('f-novo-email').value.trim();
  const senha = byId('f-novo-senha').value;
  const role = byId('f-novo-role').value;
  if (!nome || !email || !senha) {
    showToast('Informe nome, e-mail e senha.', 'error');
    return;
  }
  try {
    await Service.adminCreateUser({
      nome, email, password: senha, role,
      paginas_permitidas: role === 'usuario' ? readChecklist('f-novo-pag') : [],
    });
    showToast('Usuário criado com sucesso.', 'success');
    closeModal();
    await reload();
  } catch (err) {
    showToast(err.message || 'Erro ao criar usuário.', 'error');
  }
}

// ============================================================
// Editar usuário existente
// ============================================================
function abrirFormularioEditar(id) {
  const profile = cache.find((p) => p.id === id);
  if (!profile) return;
  const bodyHtml = `
    <div class="form-grid">
      <div class="form-field span-2"><label>Nome</label><input id="f-edit-nome" value="${escapeHtml(profile.nome || '')}" /></div>
      <div class="form-field"><label>Perfil de acesso</label>
        <select id="f-edit-role">${ROLES.map((r) => `<option value="${r.id}" ${r.id === profile.role ? 'selected' : ''}>${r.label}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>Status</label>
        <select id="f-edit-ativo"><option value="true" ${profile.ativo ? 'selected' : ''}>Ativo</option><option value="false" ${!profile.ativo ? 'selected' : ''}>Inativo</option></select>
      </div>
    </div>
    <div class="form-field" id="f-edit-paginas-wrap" style="margin-top:14px; ${profile.role === 'administrador' ? 'display:none;' : ''}">
      <label>Páginas liberadas</label>
      ${paginasChecklistHtml('f-edit-pag', profile.paginas_permitidas)}
    </div>
  `;
  openModal('Editar usuário', bodyHtml, {
    size: 'sm',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="usuarios.salvar" data-id="${id}">Salvar</button>
    `,
  });
  byId('f-edit-role').addEventListener('change', (e) => {
    byId('f-edit-paginas-wrap').style.display = e.target.value === 'administrador' ? 'none' : '';
  });
}

async function salvar(target) {
  const id = target.dataset.id;
  const role = byId('f-edit-role').value;
  try {
    await Service.Profiles.update(id, {
      nome: byId('f-edit-nome').value.trim(),
      role,
      ativo: byId('f-edit-ativo').value === 'true',
      paginas_permitidas: role === 'usuario' ? readChecklist('f-edit-pag') : [],
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
  'usuarios.novo': () => abrirFormularioNovo(),
  'usuarios.criar': () => criarUsuario(),
  'usuarios.editar': (target) => abrirFormularioEditar(target.dataset.id),
  'usuarios.salvar': (target) => salvar(target),
};
