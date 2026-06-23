import * as Service from '../supabase-service.js';
import { refreshLookups } from '../state.js';
import { buildCrudModule } from './_crud.js';

const mod = buildCrudModule({
  actionPrefix: 'parceiros',
  service: Service.Parceiros,
  title: 'Parceiros',
  singular: 'Parceiro',
  description: 'Distribuidoras e revendas que representam a empresa nos pregões.',
  searchKeys: ['razao_social', 'cnpj', 'contato'],
  columns: [
    { key: 'razao_social', label: 'Razão Social' },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'contato', label: 'Contato' },
    { key: 'telefone', label: 'Telefone' },
  ],
  fields: [
    { key: 'razao_social', label: 'Razão Social', required: true, span: 2 },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'contato', label: 'Contato' },
    { key: 'telefone', label: 'Telefone' },
    { key: 'email', label: 'E-mail' },
    { key: 'prazo_entrega', label: 'Prazo de entrega' },
    { key: 'prazo_entrega_uteis', label: 'Prazo de entrega em dias úteis?', type: 'checkbox' },
    { key: 'prazo_pagamento', label: 'Prazo de pagamento' },
    { key: 'prazo_pagamento_uteis', label: 'Prazo de pagamento em dias úteis?', type: 'checkbox' },
    { key: 'observacoes', label: 'Observações', type: 'textarea', span: 2 },
  ],
  afterChange: refreshLookups,
});

export const render = mod.render;
export const actions = mod.actions;
