import * as Service from '../supabase-service.js';
import { currentUser, canWrite } from '../state.js';
import { buildCrudModule } from './_crud.js';
import { TIPOS_AGENDA } from '../constants.js';
import { byId, escapeHtml, formatDate, daysUntil, todayISO, dateToISO, groupBy } from '../helpers.js';
import { openModal, closeModal, confirmDialog, showToast, badge, renderEmptyState } from '../ui.js';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DIAS_LONGO = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const TIPO_LABEL     = { agenda: 'Evento direto', lembrete: 'Lembrete vinculado', ata: 'Vencimento de Ata', contrato: 'Vencimento de Contrato', certidao: 'Vencimento de Certidão', 'certidao-renovacao': 'Iniciar renovação (Certidão)' };
const TIPO_PAGE      = { ata: 'atas', contrato: 'contratos', certidao: 'certidoes' };
const TIPO_LABEL_REF = { licitacao: 'Licitação', contrato: 'Contrato', ata: 'Ata', empenho: 'Empenho' };
const TIPO_PAGE_REF  = { licitacao: 'licitacoes', contrato: 'contratos', ata: 'atas', empenho: 'empenhos' };

const crudMod = buildCrudModule({
  actionPrefix: 'agenda',
  service: Service.AgendaEventos,
  title: 'Agenda',
  singular: 'Evento',
  description: 'Sessões públicas, prazos de recurso e vencimentos.',
  searchKeys: ['titulo', 'tipo'],
  columns: [
    { key: 'titulo', label: 'Título' },
    { key: 'tipo', label: 'Tipo' },
    {
      key: 'data',
      label: 'Data',
      render: (r) => {
        const dias = daysUntil(r.data);
        const sufixo = dias === null ? '' : dias < 0 ? ' (passado)' : dias === 0 ? ' (hoje)' : ` (em ${dias}d)`;
        return `${formatDate(r.data)}${sufixo}`;
      },
    },
    { key: 'referencia_tipo', label: 'Origem', render: (r) => r.referencia_tipo ? badge(TIPO_LABEL_REF[r.referencia_tipo] || r.referencia_tipo, 'info') : badge('Direto', 'muted') },
    { key: 'lembrete', label: 'Lembrete', render: (r) => (r.lembrete ? badge('Ativo', 'info') : badge('Sem lembrete', 'muted')) },
  ],
  fields: [
    { key: 'titulo', label: 'Título', required: true, span: 2 },
    { key: 'tipo', label: 'Tipo', type: 'select', options: TIPOS_AGENDA },
    { key: 'data', label: 'Data', type: 'date', required: true },
    { key: 'lembrete', label: 'Lembrete', type: 'checkbox', checkboxLabel: 'Notificar' },
    { key: 'observacoes', label: 'Observações', type: 'textarea', span: 2 },
  ],
  transformPayload: () => ({ criado_por: currentUser()?.id || null }),
});

let pageContainer = null;
let viewMode = 'mes';
let cursorDate = new Date();
let todosEventos = [];

export async function render(container) {
  pageContainer = container;
  viewMode = 'mes';
  cursorDate = new Date();
  renderShell();
}

function renderShell() {
  pageContainer.innerHTML = `
    <div class="agenda-toolbar">
      <div class="view-toggle">
        ${[['lista', 'Lista'], ['mes', 'Mês'], ['semana', 'Semana'], ['dia', 'Dia']].map(([v, label]) => `
          <button type="button" class="view-toggle-btn ${viewMode === v ? 'active' : ''}" data-action="agenda.setView" data-view="${v}">${label}</button>
        `).join('')}
      </div>
    </div>
    <div id="agenda-body"></div>
  `;
  renderBody();
}

async function renderBody() {
  const body = byId('agenda-body');
  if (viewMode === 'lista') {
    await crudMod.render(body);
    return;
  }
  body.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Agenda</h1>
        <p>Sessões públicas, prazos de recurso e vencimentos.</p>
      </div>
    </div>
    <div id="agenda-calendar">${renderEmptyState('Carregando agenda...')}</div>
  `;
  await reloadEventos();
  const calendarContainer = byId('agenda-calendar');
  if (viewMode === 'mes') renderMes(calendarContainer);
  else if (viewMode === 'semana') renderSemana(calendarContainer);
  else renderDia(calendarContainer);
}

async function reloadEventos() {
  const [eventos, atas, contratos, certidoes] = await Promise.all([
    Service.AgendaEventos.list(),
    Service.listAtas(),
    Service.listContratos(),
    Service.Certidoes.list(),
  ]);
  todosEventos = [];
  for (const e of eventos) {
    const vinculado = !!e.referencia_tipo;
    todosEventos.push({ id: `agenda-${e.id}`, tipo: vinculado ? 'lembrete' : 'agenda', titulo: e.titulo, data: e.data, cor: vinculado ? '#7C3AED' : '#2563EB', raw: e });
  }
  for (const a of atas) {
    if (a.situacao === 'Vigente' && a.vigencia_fim) {
      todosEventos.push({ id: `ata-${a.id}`, tipo: 'ata', titulo: `Vencimento — Ata ${a.numero_ata}`, data: a.vigencia_fim, cor: '#16A34A', raw: a });
    }
  }
  for (const c of contratos) {
    if (c.situacao === 'Vigente' && c.vigencia_fim) {
      todosEventos.push({ id: `contrato-${c.id}`, tipo: 'contrato', titulo: `Vencimento — Contrato ${c.numero_contrato}`, data: c.vigencia_fim, cor: '#D97706', raw: c });
    }
  }
  for (const cert of certidoes) {
    if (cert.data_validade) {
      todosEventos.push({ id: `certidao-${cert.id}`, tipo: 'certidao', titulo: `Vencimento — Certidão ${cert.tipo}`, data: cert.data_validade, cor: '#DC2626', raw: cert });
    }
    if (cert.data_renovacao) {
      todosEventos.push({ id: `certidao-renov-${cert.id}`, tipo: 'certidao-renovacao', titulo: `Iniciar renovação — ${cert.tipo}`, data: cert.data_renovacao, cor: '#F59E0B', raw: cert });
    }
  }
}

function setView(view) {
  viewMode = view;
  renderShell();
}

function navPeriodo(dir) {
  const d = new Date(cursorDate);
  if (viewMode === 'mes') d.setMonth(d.getMonth() + dir);
  else if (viewMode === 'semana') d.setDate(d.getDate() + dir * 7);
  else d.setDate(d.getDate() + dir);
  cursorDate = d;
  renderBody();
}

function irHoje() {
  cursorDate = new Date();
  renderBody();
}

function abrirDia(dateStr) {
  cursorDate = new Date(`${dateStr}T00:00:00`);
  viewMode = 'dia';
  renderShell();
}

// ============================================================
// Visão Mês
// ============================================================
function renderMes(container) {
  const year = cursorDate.getFullYear();
  const month = cursorDate.getMonth();
  const startWeekday = new Date(year, month, 1).getDay();
  const startDate = new Date(year, month, 1 - startWeekday);
  const eventosPorDia = groupBy(todosEventos, (e) => e.data);
  const todayStr = todayISO();

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    return d;
  });

  container.innerHTML = `
    <div class="card">
      <div class="calendar-nav">
        <div class="calendar-nav-controls">
          <button type="button" class="icon-btn" data-action="agenda.nav" data-dir="-1">‹</button>
          <button type="button" class="icon-btn" data-action="agenda.nav" data-dir="1">›</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="agenda.hoje">Hoje</button>
        </div>
        <strong>${MESES[month]} ${year}</strong>
      </div>
      <div class="calendar-grid calendar-month">
        ${DIAS_CURTO.map((d) => `<div class="calendar-weekday">${d}</div>`).join('')}
        ${cells.map((d) => {
          const dateStr = dateToISO(d);
          const eventos = eventosPorDia.get(dateStr) || [];
          const classes = ['calendar-day'];
          if (d.getMonth() !== month) classes.push('is-other-month');
          if (dateStr === todayStr) classes.push('is-today');
          return `
            <div class="${classes.join(' ')}" data-action="agenda.abrirDia" data-date="${dateStr}">
              <span class="calendar-day-number">${d.getDate()}</span>
              <div class="calendar-day-events">
                ${eventos.slice(0, 3).map((e) => `<div class="calendar-event-pill" style="background:${e.cor}1a; color:${e.cor};" data-action="agenda.abrirEvento" data-event-id="${e.id}">${escapeHtml(e.titulo)}</div>`).join('')}
                ${eventos.length > 3 ? `<div class="calendar-event-more">+${eventos.length - 3} mais</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ============================================================
// Visão Semana
// ============================================================
function renderSemana(container) {
  const start = new Date(cursorDate);
  start.setDate(start.getDate() - start.getDay());
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const eventosPorDia = groupBy(todosEventos, (e) => e.data);
  const todayStr = todayISO();
  const fim = days[6];

  container.innerHTML = `
    <div class="card">
      <div class="calendar-nav">
        <div class="calendar-nav-controls">
          <button type="button" class="icon-btn" data-action="agenda.nav" data-dir="-1">‹</button>
          <button type="button" class="icon-btn" data-action="agenda.nav" data-dir="1">›</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="agenda.hoje">Hoje</button>
        </div>
        <strong>${formatDate(dateToISO(start))} a ${formatDate(dateToISO(fim))}</strong>
      </div>
      <div class="calendar-grid calendar-week">
        ${days.map((d) => {
          const dateStr = dateToISO(d);
          const eventos = eventosPorDia.get(dateStr) || [];
          return `
            <div class="calendar-week-col ${dateStr === todayStr ? 'is-today' : ''}">
              <div class="calendar-week-col-header" data-action="agenda.abrirDia" data-date="${dateStr}">
                <span>${DIAS_CURTO[d.getDay()]}</span>
                <strong>${d.getDate()}</strong>
              </div>
              <div class="calendar-week-col-events">
                ${eventos.length ? eventos.map((e) => `<div class="calendar-event-pill block" style="background:${e.cor}1a; color:${e.cor};" data-action="agenda.abrirEvento" data-event-id="${e.id}">${escapeHtml(e.titulo)}</div>`).join('') : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ============================================================
// Visão Dia
// ============================================================
function renderDia(container) {
  const dateStr = dateToISO(cursorDate);
  const eventosPorDia = groupBy(todosEventos, (e) => e.data);
  const eventos = eventosPorDia.get(dateStr) || [];

  container.innerHTML = `
    <div class="card">
      <div class="calendar-nav">
        <div class="calendar-nav-controls">
          <button type="button" class="icon-btn" data-action="agenda.nav" data-dir="-1">‹</button>
          <button type="button" class="icon-btn" data-action="agenda.nav" data-dir="1">›</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="agenda.hoje">Hoje</button>
        </div>
        <strong>${DIAS_LONGO[cursorDate.getDay()]}, ${formatDate(dateStr)}</strong>
      </div>
      <div class="calendar-day-list">
        ${eventos.length ? eventos.map((e) => `
          <div class="calendar-day-list-item" data-action="agenda.abrirEvento" data-event-id="${e.id}">
            <span class="calendar-event-dot" style="background:${e.cor};"></span>
            <div>
              <strong>${escapeHtml(e.titulo)}</strong>
              <div class="calendar-event-meta">${TIPO_LABEL[e.tipo]}</div>
            </div>
          </div>
        `).join('') : renderEmptyState('Nenhum evento neste dia.')}
      </div>
      ${canWrite() ? `<button type="button" class="btn btn-ghost btn-sm" data-action="agenda.novoNoDia" data-date="${dateStr}" style="margin-top:14px;">+ Novo evento neste dia</button>` : ''}
    </div>
  `;
}

// ============================================================
// Clique em evento (agenda própria ou vencimento de outro módulo)
// ============================================================
function abrirEvento(target) {
  const evento = todosEventos.find((e) => e.id === target.dataset.eventId);
  if (!evento) return;

  if (evento.tipo === 'agenda') {
    abrirFormularioEventoCal(evento.raw);
    return;
  }

  if (evento.tipo === 'lembrete') {
    const refTipo = evento.raw.referencia_tipo;
    const pagina = TIPO_PAGE_REF[refTipo];
    const origemLabel = TIPO_LABEL_REF[refTipo] || refTipo;
    openModal(evento.titulo, `<p style="color:var(--gray-500); font-size:13.5px;">Lembrete vinculado a <strong>${origemLabel}</strong>, criado em ${formatDate(evento.data)}.</p>`, {
      size: 'sm',
      footerHtml: `
        <button type="button" class="btn btn-ghost" data-action="modal.close">Fechar</button>
        ${pagina ? `<button type="button" class="btn btn-primary" data-action="nav.go" data-page="${pagina}">Ir para ${origemLabel}</button>` : ''}
      `,
    });
    return;
  }

  if (evento.tipo === 'certidao-renovacao') {
    openModal(evento.titulo, `<p style="color:var(--gray-500); font-size:13.5px;">Prazo para iniciar o processo de renovação desta certidão (${formatDate(evento.data)}). Para alterar a data, edite o cadastro da certidão.</p>`, {
      size: 'sm',
      footerHtml: `
        <button type="button" class="btn btn-ghost" data-action="modal.close">Fechar</button>
        <button type="button" class="btn btn-primary" data-action="nav.go" data-page="certidoes">Ir para Certidões</button>
      `,
    });
    return;
  }

  const pagina = TIPO_PAGE[evento.tipo];
  openModal(evento.titulo, `<p style="color:var(--gray-500); font-size:13.5px;">Vence em ${formatDate(evento.data)}. Esse compromisso é calculado automaticamente a partir do cadastro — para alterá-lo, edite o registro de origem.</p>`, {
    size: 'sm',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Fechar</button>
      <button type="button" class="btn btn-primary" data-action="nav.go" data-page="${pagina}">Ir para ${pagina === 'atas' ? 'Atas' : pagina === 'contratos' ? 'Contratos' : 'Certidões'}</button>
    `,
  });
}

// ============================================================
// Criar/editar evento de agenda a partir do calendário
// (independente do _crud.js, que mantém seu próprio cache para a Lista)
// ============================================================
function abrirFormularioEventoCal(evento, dataPadrao) {
  const ev = evento || { titulo: '', tipo: 'Outro', data: dataPadrao || dateToISO(cursorDate), lembrete: true, observacoes: '' };
  const bodyHtml = `
    <div class="form-grid">
      <div class="form-field span-2"><label>Título *</label><input id="f-cal-titulo" value="${escapeHtml(ev.titulo)}" /></div>
      <div class="form-field"><label>Tipo</label><select id="f-cal-tipo">${TIPOS_AGENDA.map((t) => `<option ${t === ev.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="form-field"><label>Data *</label><input type="date" id="f-cal-data" value="${ev.data}" /></div>
      <div class="form-field"><label>Lembrete</label><div class="checkbox-field" style="height:38px;"><input type="checkbox" id="f-cal-lembrete" ${ev.lembrete ? 'checked' : ''} /> Notificar</div></div>
      <div class="form-field span-2"><label>Observações</label><textarea id="f-cal-obs">${escapeHtml(ev.observacoes || '')}</textarea></div>
    </div>
  `;
  openModal(evento ? 'Editar evento' : 'Novo evento', bodyHtml, {
    size: 'sm',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      ${evento && canWrite() ? `<button type="button" class="btn btn-danger" data-action="agenda.calExcluir" data-id="${evento.id}">${'Excluir'}</button>` : ''}
      ${canWrite() ? `<button type="button" class="btn btn-primary" data-action="agenda.calSalvar" data-id="${evento ? evento.id : ''}">Salvar</button>` : ''}
    `,
  });
}

async function salvarEventoCal(target) {
  const id = target.dataset.id ? Number(target.dataset.id) : null;
  const titulo = byId('f-cal-titulo').value.trim();
  const data = byId('f-cal-data').value;
  if (!titulo || !data) {
    showToast('Informe título e data.', 'error');
    return;
  }
  const payload = {
    titulo,
    tipo: byId('f-cal-tipo').value,
    data,
    lembrete: byId('f-cal-lembrete').checked,
    observacoes: byId('f-cal-obs').value.trim() || null,
  };
  try {
    if (id) {
      await Service.AgendaEventos.update(id, payload);
    } else {
      await Service.AgendaEventos.create({ ...payload, criado_por: currentUser()?.id || null });
    }
    showToast('Evento salvo.', 'success');
    closeModal();
    await renderBody();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar evento.', 'error');
  }
}

async function excluirEventoCal(target) {
  const ok = await confirmDialog('Excluir este evento?');
  if (!ok) return;
  try {
    await Service.AgendaEventos.remove(Number(target.dataset.id));
    showToast('Evento excluído.', 'success');
    closeModal();
    await renderBody();
  } catch (err) {
    showToast(err.message || 'Erro ao excluir evento.', 'error');
  }
}

// ============================================================
// Lembrete genérico — criado a partir de qualquer módulo
// ============================================================
function abrirLembreteGenerico(refTipo, refId, refLabel) {
  const bodyHtml = `
    <div class="form-grid">
      <div class="form-field span-2"><label>Título *</label><input id="f-lem-titulo" /></div>
      <div class="form-field"><label>Tipo</label><select id="f-lem-tipo">${TIPOS_AGENDA.map((t) => `<option>${escapeHtml(t)}</option>`).join('')}</select></div>
      <div class="form-field"><label>Data *</label><input type="date" id="f-lem-data" value="${todayISO()}" /></div>
      <div class="form-field"><label>Lembrete</label><div class="checkbox-field" style="height:38px;"><input type="checkbox" id="f-lem-lembrete" checked /> Notificar</div></div>
      <div class="form-field span-2"><label>Observações</label><textarea id="f-lem-obs"></textarea></div>
    </div>
  `;
  openModal(`Lembrete — ${escapeHtml(refLabel || '')}`, bodyHtml, {
    size: 'sm',
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-action="modal.close">Cancelar</button>
      <button type="button" class="btn btn-primary" data-action="agenda.salvarLembreteGenerico" data-ref-tipo="${escapeHtml(refTipo)}" data-ref-id="${refId}">Salvar</button>
    `,
  });
}

async function salvarLembreteGenerico(target) {
  const titulo = byId('f-lem-titulo').value.trim();
  const data = byId('f-lem-data').value;
  if (!titulo || !data) { showToast('Informe título e data.', 'error'); return; }
  const payload = {
    titulo,
    tipo: byId('f-lem-tipo').value,
    data,
    lembrete: byId('f-lem-lembrete').checked,
    observacoes: byId('f-lem-obs').value.trim() || null,
    referencia_tipo: target.dataset.refTipo,
    referencia_id: Number(target.dataset.refId),
    criado_por: currentUser()?.id || null,
  };
  try {
    await Service.AgendaEventos.create(payload);
    showToast('Lembrete criado.', 'success');
    closeModal();
  } catch (err) {
    showToast(err.message || 'Erro ao criar lembrete.', 'error');
  }
}

export const actions = {
  ...crudMod.actions,
  'agenda.setView': (target) => setView(target.dataset.view),
  'agenda.nav': (target) => navPeriodo(Number(target.dataset.dir)),
  'agenda.hoje': () => irHoje(),
  'agenda.abrirDia': (target) => abrirDia(target.dataset.date),
  'agenda.abrirEvento': (target) => abrirEvento(target),
  'agenda.novoNoDia': (target) => abrirFormularioEventoCal(null, target.dataset.date),
  'agenda.calSalvar': (target) => salvarEventoCal(target),
  'agenda.calExcluir': (target) => excluirEventoCal(target),
  'agenda.criarLembrete': (target) => abrirLembreteGenerico(target.dataset.refTipo, target.dataset.refId, target.dataset.refLabel),
  'agenda.salvarLembreteGenerico': (target) => salvarLembreteGenerico(target),
};
