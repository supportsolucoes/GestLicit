import * as Service from '../supabase-service.js';
import { currentUser } from '../state.js';
import { buildCrudModule } from './_crud.js';
import { TIPOS_AGENDA } from '../constants.js';
import { formatDate, daysUntil } from '../helpers.js';
import { badge } from '../ui.js';

const mod = buildCrudModule({
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

export const render = mod.render;
export const actions = mod.actions;
