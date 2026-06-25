import * as SupabaseService from './supabase-service.js';
import { isSupabaseConfigured } from './supabase-client.js';
import {
  setSession, setPage, toggleSidebar, refreshLookups,
  currentUser, currentRole, canAccessPage,
} from './state.js';
import { byId, qsa, formatDate } from './helpers.js';
import { ICONS, PAGE_META, ROLES } from './constants.js';
import { showToast, setLoading, closeModal } from './ui.js';

import * as Dashboard from './modules/dashboard.js';
import * as Licitacoes from './modules/licitacoes.js';
import * as Contratos from './modules/contratos.js';
import * as Atas from './modules/atas.js';
import * as Empenhos from './modules/empenhos.js';
import * as Faturamento from './modules/faturamento.js';
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
  faturamento: Faturamento,
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
async function renderPage(pageId, params) {
  const meta = PAGE_META.find((p) => p.id === pageId) || PAGE_META[0];
  byId('page-title').textContent = meta.label;
  qsa('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.page === pageId));
  const container = byId('page-container');
  container.classList.remove('page-entering');
  setLoading(true);
  try {
    await MODULES[pageId]?.render(container, params);
    void container.offsetWidth;
    container.classList.add('page-entering');
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="empty-state">Erro ao carregar a página: ${err.message || err}</div>`;
  } finally {
    setLoading(false);
  }
}

function navigateTo(pageId, params) {
  const meta = PAGE_META.find((p) => p.id === pageId);
  if (!MODULES[pageId] || !meta || !canAccessPage(meta)) {
    if (pageId !== 'dashboard') navigateTo('dashboard');
    return;
  }
  closeModal();
  setPage(pageId);
  history.replaceState(null, '', `#${pageId}`);
  renderPage(pageId, params);
  byId('sidebar')?.classList.remove('mobile-open');
}

function updateCollapseIcon() {
  const sb = byId('sidebar');
  if (!sb) return;
  const isCollapsed = sb.classList.contains('collapsed');
  const btn = byId('btn-collapse-sidebar');
  btn.innerHTML = isCollapsed ? ICONS.chevronRight : ICONS.chevronLeft;
  btn.title = isCollapsed ? 'Expandir menu' : 'Recolher menu';
}

function renderSidebar() {
  const nav = byId('sidebar-nav');
  const pages = PAGE_META.filter((p) => canAccessPage(p));

  // Agrupa pages preservando a ordem original
  const groups = [];
  for (const p of pages) {
    const last = groups[groups.length - 1];
    if (!last || last.label !== p.group) groups.push({ label: p.group || '', pages: [] });
    groups[groups.length - 1].pages.push(p);
  }

  nav.innerHTML = groups.map(({ label, pages: gPages }) => `
    <div class="sidebar-section">
      ${label ? `<div class="sidebar-section-label">${label}</div>` : ''}
      ${gPages.map((p) => `
        <div class="nav-item" data-page="${p.id}" data-action="nav.go" data-tooltip="${p.label}">
          ${ICONS[p.icon] || ''}
          <span>${p.label}</span>
        </div>
      `).join('')}
    </div>
  `).join('');

  byId('btn-mobile-menu').innerHTML = ICONS.menu;
  updateCollapseIcon();
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

function notifKey(tipo, registroId, dataRef) {
  return `${tipo}:${registroId}:${dataRef || ''}`;
}

async function refreshNotifications() {
  try {
    const [atas, contratos, certidoes, eventos, lidas] = await Promise.all([
      SupabaseService.listAtas(),
      SupabaseService.listContratos(),
      SupabaseService.Certidoes.list(),
      SupabaseService.AgendaEventos.list(),
      SupabaseService.listNotificacoesLidas(),
    ]);
    const lidasSet = new Set(lidas.map((l) => notifKey(l.tipo, l.registro_id, l.data_ref)));

    const items = [];
    atas.filter((a) => a.situacao === 'Vigente').forEach((a) => {
      const alert = alertLevel(a.vigencia_fim);
      if (alert) items.push({ tipo: 'ata', registroId: a.id, dataRef: a.vigencia_fim, titulo: `Ata ${a.numero_ata}`, meta: `${a.orgao?.nome || 'Órgão não informado'} · vence em ${formatDate(a.vigencia_fim)}`, dias: alert.days, vencido: alert.level === 'vencido' });
    });
    contratos.filter((c) => c.situacao === 'Vigente').forEach((c) => {
      const alert = alertLevel(c.vigencia_fim);
      if (alert) items.push({ tipo: 'contrato', registroId: c.id, dataRef: c.vigencia_fim, titulo: `Contrato ${c.numero_contrato}`, meta: `${c.orgao?.nome || 'Órgão não informado'} · vence em ${formatDate(c.vigencia_fim)}`, dias: alert.days, vencido: alert.level === 'vencido' });
    });
    certidoes.forEach((c) => {
      const alert = alertLevel(c.data_validade);
      if (alert) items.push({ tipo: 'certidao', registroId: c.id, dataRef: c.data_validade, titulo: `Certidão ${c.tipo}`, meta: `vence em ${formatDate(c.data_validade)}`, dias: alert.days, vencido: alert.level === 'vencido' });
    });
    eventos.filter((e) => e.lembrete).forEach((e) => {
      const alert = alertLevel(e.data);
      if (alert) items.push({ tipo: 'agenda', registroId: e.id, dataRef: e.data, titulo: e.titulo, meta: `${e.tipo} · ${alert.level === 'vencido' ? 'já passou' : formatDate(e.data)}`, dias: alert.days, vencido: alert.level === 'vencido' });
    });

    const visiveis = items.filter((i) => !lidasSet.has(notifKey(i.tipo, i.registroId, i.dataRef)));
    visiveis.sort((a, b) => a.dias - b.dias);

    byId('notif-dot').classList.toggle('hidden', visiveis.length === 0);
    byId('notifications-dropdown').innerHTML = `
      <div class="dropdown-header">Alertas e lembretes</div>
      <div class="dropdown-list">
        ${visiveis.length
          ? visiveis.map((i) => `
            <div class="dropdown-item dropdown-item-notif">
              <div>
                <span class="dropdown-item-title">${i.titulo}</span>
                <span class="dropdown-item-meta">${i.meta}</span>
              </div>
              <button type="button" class="icon-btn" data-action="notif.marcarLido" data-tipo="${i.tipo}" data-registro-id="${i.registroId}" data-data-ref="${i.dataRef || ''}" title="Marcar como lido">${ICONS.check}</button>
            </div>`).join('')
          : '<div class="dropdown-item"><span class="dropdown-item-meta">Nenhum vencimento ou lembrete próximo.</span></div>'}
      </div>
    `;
  } catch (err) {
    console.error('Falha ao carregar alertas', err);
  }
}

async function marcarNotificacaoLida(target) {
  const { tipo, registroId, dataRef } = target.dataset;
  try {
    await SupabaseService.marcarNotificacaoLida(currentUser()?.id, { tipo, registroId: Number(registroId), dataRef: dataRef || null });
    await refreshNotifications();
  } catch (err) {
    showToast(err.message || 'Erro ao marcar como lido.', 'error');
  }
}

// ---------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------
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
  setLoading(true);
  try {
    await SupabaseService.signIn(email, password);
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
  if (localStorage.getItem('gl-sidebar')) {
    byId('sidebar').classList.add('collapsed');
    updateCollapseIcon();
  }
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
function initSidebarTooltip() {
  const tip = Object.assign(document.createElement('div'), { className: 'sidebar-tooltip' });
  document.body.appendChild(tip);
  const sbEl = byId('sidebar');
  sbEl.addEventListener('mouseover', (e) => {
    if (!sbEl.classList.contains('collapsed')) return;
    const item = e.target.closest('[data-tooltip]');
    if (!item || !sbEl.contains(item)) return;
    const r = item.getBoundingClientRect();
    tip.textContent = item.dataset.tooltip;
    tip.style.top = `${r.top + r.height / 2}px`;
    tip.style.left = `${r.right + 10}px`;
    tip.classList.add('visible');
  });
  sbEl.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-tooltip]')) tip.classList.remove('visible');
  });
  sbEl.addEventListener('click', () => tip.classList.remove('visible'));
}

function bindGlobalEvents() {
  byId('login-form').addEventListener('submit', handleLoginSubmit);
  initSidebarTooltip();

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

    if (action === 'nav.go') {
      const params = {};
      if (target.dataset.filterKey) params.filter = { key: target.dataset.filterKey, value: target.dataset.filterValue, label: target.dataset.filterLabel };
      if (target.dataset.openId) params.openId = Number(target.dataset.openId);
      navigateTo(target.dataset.page, params);
      const sb = byId('sidebar');
      if (window.innerWidth >= 881 && !sb.classList.contains('collapsed')) {
        sb.classList.add('collapsed');
        localStorage.setItem('gl-sidebar', '1');
        updateCollapseIcon();
      }
      return;
    }
    if (action === 'notif.marcarLido') { marcarNotificacaoLida(target); return; }
    if (action === 'ui.toggleSidebar') {
      toggleSidebar();
      const sb = byId('sidebar');
      sb.classList.toggle('collapsed');
      localStorage.setItem('gl-sidebar', sb.classList.contains('collapsed') ? '1' : '');
      updateCollapseIcon();
      return;
    }
    if (action === 'ui.toggleMobileSidebar') { byId('sidebar').classList.toggle('mobile-open'); return; }
    if (action === 'ui.toggleNotifications') { toggleDropdown('notifications-dropdown'); return; }
    if (action === 'ui.toggleUserMenu') { renderUserMenu(); toggleDropdown('user-menu-dropdown'); return; }
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
