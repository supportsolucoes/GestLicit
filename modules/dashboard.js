import * as Service from '../supabase-service.js';
import { byId, formatCurrency, formatDate, alertLevel, sumBy, groupBy } from '../helpers.js';
import { renderEmptyState, badge } from '../ui.js';
import { drawBarChart, drawDonutChart } from '../charts.js';
import { STATUS_COLOR } from '../constants.js';

const STATUS_HEX = {
  'Ganhou': '#16A34A',
  'Declinou': '#94A3B8',
  'Desclassificado': '#DC2626',
  'Fracassado': '#DC2626',
  'Revogado': '#D97706',
  'Em disputa': '#2563EB',
};

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
  const donutData = [...statusCounts.entries()].map(([status, list]) => ({ label: status, value: list.length, color: STATUS_HEX[status] || '#94A3B8' }));

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
      (i) => Number(i.valor_final || 0) * Number(i.quantidade || 0)
    );
    return { label, value: valor };
  });

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <p>Visão geral do ciclo licitatório.</p>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Itens em disputa</div>
        <div class="stat-value">${emDisputa.length}</div>
        <div class="stat-foot">Aguardando resultado</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Taxa de êxito</div>
        <div class="stat-value">${taxaExito.toFixed(1)}%</div>
        <div class="stat-foot">${ganhos.length} ganhos de ${decididos.length} decididos</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Atas/Empenhos vigentes</div>
        <div class="stat-value">${atasVigentes.length}</div>
        <div class="stat-foot">${formatCurrency(valorAtasVigentes)} em vigência</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Valor ganho (itens)</div>
        <div class="stat-value">${formatCurrency(valorGanho)}</div>
        <div class="stat-foot">Soma de itens com status Ganhou</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Vencimentos próximos</div>
        <div class="stat-value">${alertas.length}</div>
        <div class="stat-foot">Atas e certidões em até 90 dias</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <strong>Evolução mensal — valor ganho</strong>
        <canvas id="chart-evolucao" style="width:100%; height:240px; margin-top:10px;"></canvas>
      </div>
      <div class="card">
        <strong>Resultado dos itens disputados</strong>
        <canvas id="chart-status" style="width:100%; height:240px; margin-top:10px;"></canvas>
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;">
          ${donutData.map((d) => `<span style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--gray-700);"><span style="width:9px;height:9px;border-radius:50%;background:${d.color};display:inline-block;"></span>${d.label} (${d.value})</span>`).join('')}
        </div>
      </div>
    </div>

    <div class="grid-2" style="margin-top:18px;">
      <div class="card">
        <strong>Valor de atas por órgão (top 6)</strong>
        <canvas id="chart-orgaos" style="width:100%; height:240px; margin-top:10px;"></canvas>
      </div>
      <div class="card">
        <strong>Alertas de vencimento</strong>
        <div style="margin-top:10px; max-height:260px; overflow-y:auto;">
          ${alertas.length ? alertas.map((a) => `
            <div style="display:flex; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid var(--gray-100); font-size:13px;">
              <div>
                <strong>${a.tipo}: ${a.titulo}</strong><br/>
                <span style="color:var(--gray-500); font-size:12px;">${a.meta} · vence em ${formatDate(a.data)}</span>
              </div>
              ${badge(a.alert.level === 'vencido' ? 'Vencido' : `${a.alert.days}d`, a.alert.level === 'vencido' ? 'danger' : 'warning')}
            </div>
          `).join('') : renderEmptyState('Nenhum vencimento nos próximos 90 dias.')}
        </div>
      </div>
    </div>
  `;

  drawBarChart(byId('chart-evolucao'), evolucaoData, { valueFormatter: (v) => formatCurrency(v).replace('R$', '').trim() });
  drawDonutChart(byId('chart-status'), donutData, { centerLabel: String(itens.length) });
  drawBarChart(byId('chart-orgaos'), barOrgaoData, { color: '#2563EB', valueFormatter: (v) => formatCurrency(v).replace('R$', '').trim() });
}

export const actions = {};
