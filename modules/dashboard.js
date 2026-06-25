import * as Service from '../supabase-service.js';
import { byId, formatCurrency, formatDate, alertLevel, sumBy, groupBy } from '../helpers.js';
import { badge } from '../ui.js';
import { drawBarChart, drawDonutChart } from '../charts.js';
import { ICONS } from '../constants.js';

const STATUS_HEX = {
  'Ganhou': '#16A34A',
  'Declinou': '#94A3B8',
  'Desclassificado': '#DC2626',
  'Fracassado': '#DC2626',
  'Revogado': '#D97706',
  'Em disputa': '#2563EB',
};

function fmtShort(val) {
  if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(1).replace('.', ',')}M`;
  if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(0)}K`;
  return formatCurrency(val);
}

export async function render(container) {
  container.innerHTML = `<div class="empty-state">Carregando indicadores...</div>`;

  const [itens, atas, certidoes] = await Promise.all([
    Service.listAllLicitacaoItens(),
    Service.listAtas(),
    Service.Certidoes.list(),
  ]);

  const decididos = itens.filter((i) => i.status !== 'Em disputa');
  const ganhos = itens.filter((i) => i.status === 'Ganhou');
  const emDisputa = itens.filter((i) => i.status === 'Em disputa');
  const taxaExito = decididos.length ? (ganhos.length / decididos.length) * 100 : 0;
  const valorGanho = sumBy(ganhos, (i) => Number(i.valor_final || 0) * Number(i.quantidade || 0));
  const atasVigentes = atas.filter((a) => a.situacao === 'Vigente');
  const valorAtasVigentes = sumBy(atasVigentes, (a) => a.valor_total);

  const alertasAta = atasVigentes
    .map((a) => ({ tipo: 'Ata', titulo: a.numero_ata, meta: a.orgao?.nome || '-', data: a.vigencia_fim, alert: alertLevel(a.vigencia_fim) }))
    .filter((a) => a.alert);
  const alertasCertidao = certidoes
    .map((c) => ({ tipo: 'Certidão', titulo: c.tipo, meta: c.numero || '-', data: c.data_validade, alert: alertLevel(c.data_validade) }))
    .filter((c) => c.alert);
  const alertas = [...alertasAta, ...alertasCertidao].sort((a, b) => a.alert.days - b.alert.days);

  const statusCounts = groupBy(itens, (i) => i.status);
  const donutData = [...statusCounts.entries()].map(([status, list]) => ({
    label: status, value: list.length, color: STATUS_HEX[status] || '#94A3B8',
  }));

  const porOrgao = groupBy(atas, (a) => a.orgao?.nome || 'Não informado');
  const barOrgaoData = [...porOrgao.entries()]
    .map(([nome, list]) => ({ label: nome, value: sumBy(list, (a) => a.valor_total) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const meses = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    meses.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('pt-BR', { month: 'short' }) });
  }
  const evolucaoData = meses.map(({ key, label }) => {
    const [y, m] = key.split('-').map(Number);
    const valor = sumBy(
      ganhos.filter((i) => {
        if (!i.licitacao?.data_sessao) return false;
        const d = new Date(`${i.licitacao.data_sessao}T00:00:00`);
        return d.getFullYear() === y && d.getMonth() === m;
      }),
      (i) => Number(i.valor_final || 0) * Number(i.quantidade || 0),
    );
    return { label, value: valor };
  });

  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <p>${hoje.charAt(0).toUpperCase() + hoje.slice(1)} · Visão geral do ciclo licitatório</p>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--blue">${ICONS.licitacoes}</div>
        <div class="kpi-value">${emDisputa.length}</div>
        <div class="kpi-label">Em disputa</div>
        <div class="kpi-foot">Aguardando resultado</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--green">${ICONS.check}</div>
        <div class="kpi-value">${taxaExito.toFixed(1)}%</div>
        <div class="kpi-label">Taxa de êxito</div>
        <div class="kpi-foot">${ganhos.length} de ${decididos.length} decididos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--purple">${ICONS.atas}</div>
        <div class="kpi-value">${atasVigentes.length}</div>
        <div class="kpi-label">Atas vigentes</div>
        <div class="kpi-foot">${fmtShort(valorAtasVigentes)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--indigo">${ICONS.empenhos}</div>
        <div class="kpi-value">${fmtShort(valorGanho)}</div>
        <div class="kpi-label">Valor ganho</div>
        <div class="kpi-foot">Itens com status Ganhou</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--orange">${ICONS.agenda}</div>
        <div class="kpi-value">${alertas.length}</div>
        <div class="kpi-label">Vencimentos</div>
        <div class="kpi-foot">Próximos 90 dias</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="dash-card-header">
          <div class="dash-card-title">Evolução mensal</div>
          <div class="dash-card-subtitle">Valor ganho nos últimos 6 meses</div>
        </div>
        <canvas id="chart-evolucao" style="width:100%; height:220px;"></canvas>
      </div>
      <div class="card">
        <div class="dash-card-header">
          <div class="dash-card-title">Resultado dos itens</div>
          <div class="dash-card-subtitle">Distribuição por status</div>
        </div>
        <canvas id="chart-status" style="width:100%; height:180px;"></canvas>
        <div class="donut-legend">
          ${donutData.map((d) => `
            <span class="donut-legend-item">
              <span class="donut-legend-dot" style="background:${d.color}"></span>
              ${d.label} <strong>${d.value}</strong>
            </span>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="grid-2" style="margin-top:18px;">
      <div class="card">
        <div class="dash-card-header">
          <div class="dash-card-title">Valor por órgão</div>
          <div class="dash-card-subtitle">Top 6 atas por valor total</div>
        </div>
        <canvas id="chart-orgaos" style="width:100%; height:220px;"></canvas>
      </div>
      <div class="card">
        <div class="dash-card-header">
          <div class="dash-card-title">Alertas de vencimento</div>
          <div class="dash-card-subtitle">Atas e certidões a vencer</div>
        </div>
        <div class="alert-list">
          ${alertas.length ? alertas.slice(0, 8).map((a) => `
            <div class="alert-row">
              <div class="alert-row-body">
                <div class="alert-row-title">${a.tipo}: ${a.titulo}</div>
                <div class="alert-row-meta">${a.meta} · vence ${formatDate(a.data)}</div>
              </div>
              ${badge(a.alert.level === 'vencido' ? 'Vencido' : `${a.alert.days}d`, a.alert.level === 'vencido' ? 'danger' : 'warning')}
            </div>
          `).join('') : `<p style="color:var(--gray-500);font-size:13px;padding:20px 0;text-align:center;">Nenhum vencimento nos próximos 90 dias.</p>`}
        </div>
      </div>
    </div>
  `;

  drawBarChart(byId('chart-evolucao'), evolucaoData, { valueFormatter: (v) => formatCurrency(v).replace('R$', '').trim() });
  drawDonutChart(byId('chart-status'), donutData, { centerLabel: String(itens.length) });
  drawBarChart(byId('chart-orgaos'), barOrgaoData, { color: '#2563EB', valueFormatter: (v) => formatCurrency(v).replace('R$', '').trim() });
}

export const actions = {};
