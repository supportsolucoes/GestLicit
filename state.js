import * as Service from './supabase-service.js';

const state = {
  session: null,
  profile: null,
  ui: {
    page: 'dashboard',
    sidebarCollapsed: false,
  },
  lookups: {
    orgaos: [],
    concorrentes: [],
    parceiros: [],
    produtos: [],
    profiles: [],
    tags: [],
  },
};

const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn(state));
}

export function setSession(session, profile) {
  state.session = session;
  state.profile = profile;
  notify();
}

export function setPage(page) {
  state.ui.page = page;
  notify();
}

export function toggleSidebar() {
  state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
  notify();
}

export function setLookups(patch) {
  Object.assign(state.lookups, patch);
  notify();
}

export async function refreshLookups() {
  const [orgaos, concorrentes, parceiros, produtos, profiles, tags] = await Promise.all([
    Service.Orgaos.list(),
    Service.Concorrentes.list(),
    Service.Parceiros.list(),
    Service.Produtos.list(),
    Service.Profiles.list(),
    Service.Tags.list(),
  ]);
  setLookups({ orgaos, concorrentes, parceiros, produtos, profiles, tags });
}

export function currentUser() {
  return state.session?.user || null;
}

export function currentRole() {
  return state.profile?.role || 'consulta';
}

export function isAdmin() {
  return currentRole() === 'administrador';
}

export function canWrite() {
  return currentRole() !== 'consulta';
}

export function lookupName(list, id) {
  const item = (state.lookups[list] || []).find((i) => String(i.id) === String(id));
  return item ? (item.nome || item.razao_social) : '';
}
