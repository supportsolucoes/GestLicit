import * as Service from '../supabase-service.js';
import { buildCrudModule } from './_crud.js';
import { TIPOS_CERTIDAO, ICONS } from '../constants.js';
import { formatDate, alertLevel } from '../helpers.js';
import { badge } from '../ui.js';

const mod = buildCrudModule({
  actionPrefix: 'certidoes',
  service: Service.Certidoes,
  title: 'Certidões',
  singular: 'Certidão',
  description: 'Documentos de regularidade fiscal e trabalhista da própria empresa, com alerta de vencimento.',
  searchKeys: ['tipo', 'numero'],
  kpiFn: (records) => {
    const regulares = records.filter((r) => !alertLevel(r.data_validade));
    const a30d = records.filter((r) => { const al = alertLevel(r.data_validade); return al && al.level !== 'vencido' && al.days <= 30; });
    const vencidas = records.filter((r) => alertLevel(r.data_validade)?.level === 'vencido');
    const renovacao = records.filter((r) => r.data_renovacao && alertLevel(r.data_renovacao) && alertLevel(r.data_validade)?.level !== 'vencido');
    return `
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--blue">${ICONS.certidoes}</div>
        <div class="kpi-value">${records.length}</div>
        <div class="kpi-label">Total cadastradas</div>
        <div class="kpi-foot">certidões monitoradas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--green">${ICONS.check}</div>
        <div class="kpi-value">${regulares.length}</div>
        <div class="kpi-label">Regulares</div>
        <div class="kpi-foot">dentro do prazo</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--amber">${ICONS.agenda}</div>
        <div class="kpi-value">${a30d.length}</div>
        <div class="kpi-label">Vencendo em 30 dias</div>
        <div class="kpi-foot">requer renovação</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--danger">${ICONS.close}</div>
        <div class="kpi-value">${vencidas.length}</div>
        <div class="kpi-label">Vencidas</div>
        <div class="kpi-foot">prazo encerrado</div>
      </div>
    `;
  },
  columns: [
    { key: 'tipo', label: 'Tipo' },
    { key: 'numero', label: 'Número' },
    { key: 'data_validade', label: 'Validade', render: (r) => formatDate(r.data_validade) },
    { key: 'data_renovacao', label: 'Iniciar Renovação', render: (r) => r.data_renovacao ? formatDate(r.data_renovacao) : '-' },
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
    { key: 'tipo', label: 'Tipo de Certidão', type: 'datalist', options: TIPOS_CERTIDAO, required: true },
    { key: 'numero', label: 'Número' },
    { key: 'data_emissao', label: 'Data de emissão', type: 'date' },
    { key: 'data_validade', label: 'Data de validade', type: 'date' },
    { key: 'data_renovacao', label: 'Iniciar renovação em', type: 'date' },
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
