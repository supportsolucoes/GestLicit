import * as Service from '../supabase-service.js';
import { refreshLookups } from '../state.js';
import { buildCrudModule } from './_crud.js';
import { formatCurrency } from '../helpers.js';

const mod = buildCrudModule({
  actionPrefix: 'produtos',
  service: Service.Produtos,
  title: 'Produtos',
  singular: 'Produto',
  description: 'Catálogo de produtos: fabricante, preço de custo e código SINC do edital.',
  searchKeys: ['nome', 'fabricante', 'codigo_sinc'],
  columns: [
    { key: 'nome', label: 'Nome' },
    { key: 'fabricante', label: 'Fabricante' },
    { key: 'preco_custo', label: 'Preço de custo', render: (r) => formatCurrency(r.preco_custo) },
    { key: 'codigo_sinc', label: 'Código SINC' },
  ],
  fields: [
    { key: 'nome', label: 'Nome do Produto', required: true, span: 2 },
    { key: 'fabricante', label: 'Fabricante' },
    { key: 'preco_custo', label: 'Preço de custo', type: 'number' },
    { key: 'codigo_sinc', label: 'Código SINC' },
    { key: 'sinonimos', label: 'Nomes similares (separados por vírgula)', type: 'tags', span: 2 },
  ],
  afterChange: refreshLookups,
});

export const render = mod.render;
export const actions = mod.actions;
