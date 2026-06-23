import * as Service from '../supabase-service.js';
import { refreshLookups } from '../state.js';
import { buildCrudModule } from './_crud.js';
import { UFS } from '../constants.js';

const mod = buildCrudModule({
  actionPrefix: 'orgaos',
  service: Service.Orgaos,
  title: 'Órgãos',
  singular: 'Órgão',
  description: 'Órgãos públicos, prefeituras e autarquias com quem a empresa já disputou licitações.',
  searchKeys: ['nome', 'cnpj', 'cidade'],
  columns: [
    { key: 'nome', label: 'Nome' },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'uf', label: 'UF' },
    { key: 'cidade', label: 'Cidade' },
  ],
  fields: [
    { key: 'nome', label: 'Nome do Órgão', required: true, span: 2 },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'uf', label: 'UF', type: 'select', options: UFS },
    { key: 'cidade', label: 'Cidade' },
    { key: 'observacoes', label: 'Observações', type: 'textarea', span: 2 },
  ],
  afterChange: refreshLookups,
});

export const render = mod.render;
export const actions = mod.actions;
