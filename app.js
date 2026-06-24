import * as SupabaseService from './supabase-service.js';
import { isSupabaseConfigured } from './supabase-client.js';
import {
  setSession, setPage, toggleSidebar, refreshLookups,
  currentUser, currentRole,
} from './state.js';
import { byId, qsa, formatDate } from './helpers.js';
import { ICONS, PAGE_META, ROLES } from './constants.js';
import { showToast, setLoading, closeModal } from './ui.js';

import * as Dashboard from './modules/dashboard.js';
import * as Licitacoes from './modules/licitacoes.js';
import * as Contratos from './modules/contratos.js';
import * as Atas from './modules/atas.js';
import * as Empenhos from './modules/empenhos.js';
import * as Produtos from './modules/produtos.js';
import * as Orgaos from './modules/orgaos.js';
import * as Concorrentes from './modules/concorrentes.js';
import * as Parceiros from './modules/parceiros.js';
import * as Certidoes from './modules/certidoes.js';
import * as Documentos from './modules/documentos.js';
import * as Agenda from './modules/agenda.js';
import * as Relatorios from './modules/relatorios.js';
import * as Configuracoes from './modules/configuracoes.js';
import * as Usuarios from './modules/usuarios.js';
import { alertLevel } from './helpers.js';

const MODULES = {
  dashboard: Dashboard,
  licitacoes: Licitacoes,
  contratos: Contratos,
  atas: Atas,
  empenhos: Empenhos,
  produtos: Produtos,
  orgaos: Orgaos,
  concorrentes: Concorrentes,
  parceiros: Parceiros,
  certidoes: Certidoes,
  documentos: Documentos,
  agenda: Agenda,
  relatorios: Relatorios,
  configuracoes: Configuracoes,
  usuarios: Usuarios,
};

let actionsMap = {};
let authMode = 'signin';

function collectActions() {
  actionsMap = {};
  for (const mod of Object.values(MODULES)) {
    if (mod.actions) Object.assign(actionsMap, mod.actions);
  }
}

function roleLabel(role) {
  return ROLES.find((r) => r.id === role)?.label || role;
}

// ---------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------
async function renderPage(pageId) {
  const meta = PAGE_META.find((p) => p.id === pageId) || PAGE_META[0];
  byId('page-title').textContent = meta.label;
  qsa('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.page === pageId));
  const container = byId('page-container');
  setLoading(true);
  try {
    await MODULES[pageId]?.render(container);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="empty-state">Erro ao carregar a página: ${err.message || err}</div>`;
  } finally {
    setLoading(false);
  }
}

function navigateTo(pageId) {
  if (!MODULES[pageId]) return;
  setPage(pageId);
  history.replaceState(null, '', `#${pageId}`);
  renderPage(pageId);
  byId('sidebar')?.classList.remove('mobile-open');
}

function renderSidebar() {
  const role = currentRole();
  const nav = byId('sidebar-nav');
  nav.innerHTML = PAGE_META
    .filter((p) => !p.adminOnly || role === 'administrador')
    .map((p) => `
      <div class="nav-item" data-page="${p.id}" data-action="nav.go">
        ${ICONS[p.icon] || ''}
        <span>${p.label}</span>
      </div>
    `).join('');
  byId('btn-collapse-sidebar').innerHTML = ICONS.menu;
  byId('btn-mobile-menu').innerHTML = ICONS.menu;
}

function updateUserChip() {
  const user = currentUser();
  const role = currentRole();
  const name = user?.user_metadata?.nome || user?.email || 'Usuário';
  byId('user-avatar').textContent = name.slice(0, 1).toUpperCase();
  byId('user-chip-name').textContent = name;
  byId('user-chip-role').textContent = roleLabel(role);
}

function toggleDropdown(id) {
  const target = byId(id);
  const willOpen = target.classList.contains('hidden');
  byId('notifications-dropdown')?.classList.add('hidden');
  byId('user-menu-dropdown')?.classList.add('hidden');
  if (willOpen) target.classList.remove('hidden');
}

function renderUserMenu() {
  byId('user-menu-dropdown').innerHTML = `
    <div class="dropdown-header">${currentUser()?.email || ''}</div>
    <div class="dropdown-list">
      <div class="dropdown-item" data-action="auth.logout">
        <span class="dropdown-item-title">Sair</span>
        <span class="dropdown-item-meta">Encerrar sessão</span>
      </div>
    </div>
  `;
}

async function refreshNotifications() {
  try {
    const [atas, contratos, certidoes, eventos] = await Promise.all([
      SupabaseService.listAtas(),
      SupabaseService.listContratos(),
      SupabaseService.Certidoes.list(),
      SupabaseService.AgendaEventos.list(),
    ]);
    const items = [];
    atas.filter((a) => a.situacao === 'Vigente').forEach((a) => {
      const alert = alertLevel(a.vigencia_fim);
      if (alert) items.push({ titulo: `Ata ${a.numero_ata}`, meta: `${a.orgao?.nome || 'Órgão não informado'} · vence em ${formatDate(a.vigencia_fim)}`, dias: alert.days });
    });
    contratos.filter((c) => c.situacao === 'Vigente').forEach((c) => {
      const alert = alertLevel(c.vigencia_fim);
      if (alert) items.push({ titulo: `Contrato ${c.numero_contrato}`, meta: `${c.orgao?.nome || 'Órgão não informado'} · vence em ${formatDate(c.vigencia_fim)}`, dias: alert.days });
    });
    certidoes.forEach((c) => {
      const alert = alertLevel(c.data_validade);
      if (alert) items.push({ titulo: `Certidão ${c.tipo}`, meta: `vence em ${formatDate(c.data_validade)}`, dias: alert.days });
    });
    eventos.filter((e) => e.lembrete).forEach((e) => {
      const alert = alertLevel(e.data);
      if (alert) items.push({ titulo: e.titulo, meta: `${e.tipo} · ${alert.level === 'vencido' ? 'já passou' : formatDate(e.data)}`, dias: alert.days });
    });
    items.sort((a, b) => a.dias - b.dias);

    byId('notif-dot').classList.toggle('hidden', items.length === 0);
    byId('notifications-dropdown').innerHTML = `
      <div class="dropdown-header">Alertas e lembretes</div>
      <div class="dropdown-list">
        ${items.length
          ? items.map((i) => `
            <div class="dropdown-item">
              <span class="dropdown-item-title">${i.titulo}</span>
              <span class="dropdown-item-meta">${i.meta}</span>
            </div>`).join('')
          : '<div class="dropdown-item"><span class="dropdown-item-meta">Nenhum vencimento ou lembrete próximo.</span></div>'}
      </div>
    `;
  } catch (err) {
    console.error('Falha ao carregar alertas', err);
  }
}

// ---------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------
function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === 'signup';
  byId('login-nome-field').classList.toggle('hidden', !isSignup);
  byId('login-submit').textContent = isSignup ? 'Criar conta' : 'Entrar';
  byId('login-toggle-text').textContent = isSignup ? 'Já tem uma conta?' : 'Ainda não tem conta?';
  byId('login-toggle-btn').textContent = isSignup ? 'Entrar' : 'Criar conta';
}

function showLoginError(message) {
  const el = byId('login-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  byId('login-error').classList.add('hidden');
  const email = byId('login-email').value.trim();
  const password = byId('login-password').value;
  const nome = byId('login-nome').value.trim();
  setLoading(true);
  try {
    if (authMode === 'signup') {
      await SupabaseService.signUp(email, password, nome || email);
      showToast('Conta criada. Faça login para continuar.', 'success');
      setAuthMode('signin');
    } else {
      await SupabaseService.signIn(email, password);
    }
  } catch (err) {
    showLoginError(err.message || 'Não foi possível autenticar.');
  } finally {
    setLoading(false);
  }
}

async function bootstrapApp(session) {
  let profile = null;
  try {
    profile = await SupabaseService.getProfile(session.user.id);
  } catch (err) {
    console.warn('Perfil ainda não disponível', err);
  }
  setSession(session, profile);
  byId('login-screen').classList.add('hidden');
  byId('app-shell').classList.remove('hidden');
  renderSidebar();
  updateUserChip();
  collectActions();
  setLoading(true);
  try {
    await refreshLookups();
  } finally {
    setLoading(false);
  }
  const initialPage = location.hash.replace('#', '') || 'dashboard';
  navigateTo(MODULES[initialPage] ? initialPage : 'dashboard');
  refreshNotifications();
}

function showLoginScreen() {
  byId('app-shell').classList.add('hidden');
  byId('login-screen').classList.remove('hidden');
}

// ---------------------------------------------------------------
// Bind global
// ---------------------------------------------------------------
function bindGlobalEvents() {
  byId('login-form').addEventListener('submit', handleLoginSubmit);

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#notifications-dropdown') && !event.target.closest('[data-action="ui.toggleNotifications"]')) {
      byId('notifications-dropdown')?.classList.add('hidden');
    }
    if (!event.target.closest('#user-menu-dropdown') && !event.target.closest('[data-action="ui.toggleUserMenu"]')) {
      byId('user-menu-dropdown')?.classList.add('hidden');
    }
  }, true);

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;

    if (action === 'nav.go') { navigateTo(target.dataset.page); return; }
    if (action === 'ui.toggleSidebar') {
      toggleSidebar();
      byId('sidebar').classList.toggle('collapsed');
      return;
    }
    if (action === 'ui.toggleMobileSidebar') { byId('sidebar').classList.toggle('mobile-open'); return; }
    if (action === 'ui.toggleNotifications') { toggleDropdown('notifications-dropdown'); return; }
    if (action === 'ui.toggleUserMenu') { renderUserMenu(); toggleDropdown('user-menu-dropdown'); return; }
    if (action === 'auth.toggleMode') { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); return; }
    if (action === 'auth.logout') { await SupabaseService.signOut(); return; }
    if (action === 'modal.close' || action === 'modal.cancel') { closeModal(); return; }
    if (action === 'modal.backdrop') { return; }

    const handler = actionsMap[action];
    if (handler) {
      try {
        await handler(target, event);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Erro ao executar ação.', 'error');
      }
    }
  });
}

export async function initApp() {
  byId('btn-notifications').innerHTML = `${ICONS.bell}<span id="notif-dot" class="notif-dot hidden"></span>`;
  bindGlobalEvents();

  if (!isSupabaseConfigured()) {
    showLoginError('Configure as credenciais do Supabase em config.js para habilitar o login.');
    return;
  }

  SupabaseService.onAuthChange((session) => {
    if (session) bootstrapApp(session);
    else showLoginScreen();
  });

  const session = await SupabaseService.getSession();
  if (session) await bootstrapApp(session);
}
