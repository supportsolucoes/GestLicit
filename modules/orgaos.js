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
  modalSize: 'lg',
  allowView: true,
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
    { key: 'logradouro', label: 'Logradouro', span: 2 },
    { key: 'numero', label: 'Número' },
    { key: 'bairro', label: 'Bairro' },
    { key: 'complemento', label: 'Complemento' },
    { key: 'cep', label: 'CEP' },
    { key: 'responsavel_nome', label: 'Responsável (Nome)', span: 2 },
    { key: 'responsavel_cpf', label: 'Responsável (CPF)' },
    { key: 'responsavel_cargo', label: 'Cargo do Responsável' },
    { key: 'responsavel_email', label: 'E-mail do Responsável', span: 2 },
    { key: 'observacoes', label: 'Observações', type: 'textarea', span: 2 },
  ],
  afterChange: refreshLookups,
});

export const render = mod.render;
export const actions = mod.actions;
