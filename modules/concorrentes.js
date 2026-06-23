import * as Service from '../supabase-service.js';
import { refreshLookups } from '../state.js';
import { buildCrudModule } from './_crud.js';

const mod = buildCrudModule({
  actionPrefix: 'concorrentes',
  service: Service.Concorrentes,
  title: 'Concorrentes',
  singular: 'Concorrente',
  description: 'Empresas concorrentes e produtos com que costumam vencer os pregões.',
  searchKeys: ['nome'],
  columns: [
    { key: 'nome', label: 'Nome' },
    { key: 'observacoes', label: 'Observações' },
  ],
  fields: [
    { key: 'nome', label: 'Nome da Empresa', required: true, span: 2 },
    { key: 'observacoes', label: 'Produtos/observações', type: 'textarea', span: 2 },
  ],
  afterChange: refreshLookups,
});

export const render = mod.render;
export const actions = mod.actions;
