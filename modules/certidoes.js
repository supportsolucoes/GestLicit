import * as Service from '../supabase-service.js';
import { buildCrudModule } from './_crud.js';
import { TIPOS_CERTIDAO } from '../constants.js';
import { formatDate, alertLevel } from '../helpers.js';
import { badge } from '../ui.js';

const mod = buildCrudModule({
  actionPrefix: 'certidoes',
  service: Service.Certidoes,
  title: 'Certidões',
  singular: 'Certidão',
  description: 'Documentos de regularidade fiscal e trabalhista da própria empresa, com alerta de vencimento.',
  searchKeys: ['tipo', 'numero'],
  columns: [
    { key: 'tipo', label: 'Tipo' },
    { key: 'numero', label: 'Número' },
    { key: 'data_validade', label: 'Validade', render: (r) => formatDate(r.data_validade) },
    {
      key: 'situacao',
      label: 'Situação',
      render: (r) => {
        const alert = alertLevel(r.data_validade);
        if (!alert) return badge('Regular', 'success');
        if (alert.level === 'vencido') return badge('Vencido', 'danger');
        return badge(`Vence em ${alert.days}d`, 'warning');
      },
    },
  ],
  fields: [
    { key: 'tipo', label: 'Tipo de Certidão', type: 'select', options: TIPOS_CERTIDAO, required: true },
    { key: 'numero', label: 'Número' },
    { key: 'data_emissao', label: 'Data de emissão', type: 'date' },
    { key: 'data_validade', label: 'Data de validade', type: 'date' },
    { key: 'observacoes', label: 'Observações', type: 'textarea', span: 2 },
    { key: 'arquivo', label: 'Anexar arquivo', type: 'file', span: 2 },
  ],
  onFileUpload: async (saved, file) => {
    const path = await Service.uploadCertidaoArquivo(file, saved.id);
    await Service.Certidoes.update(saved.id, { arquivo_url: path });
  },
});

export const render = mod.render;
export const actions = mod.actions;
