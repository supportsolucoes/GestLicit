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
  'Revogado': '#B5790A',
  'Em disputa': '#1E3A5F',
};

let _periodo = 'mes';
let _data = null;
let _container = null;

function fmtShort(val) {
  if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(1).replace('.', ',')}M`;
  if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(0)}K`;
  return formatCurrency(val);
}

function inPeriodo(dateStr) {
  if (!dateStr) return _periodo === 'total';
  const [yyyy, mm] = dateStr.slice(0, 7).split('-').map(Number);
  const now = new Date();
  if (_periodo === 'mes') return yyyy === now.getFullYear() && mm === now.getMonth() + 1;
  if (_periodo === 'ano') return yyyy === now.getFullYear();
  return true;
}

export async function render(container) {
  _container = container;
  _periodo = 'mes';
  container.innerHTML = `<div class="empty-state">Carregando indicadores...</div>`;

  const [itens, atas, contratos, certidoes, faturamentos, recebimentos] = await Promise.all([
    Service.listAllLicitacaoItens(),
    Service.listAtas(),
    Service.listContratos(),
    Service.Certidoes.list(),
    Service.listFaturamentos(),
    Service.listAllRecebimentos(),
  ]);

  _data = { itens, atas, contratos, certidoes, faturamentos, recebimentos };
  renderContent();
}

function renderContent() {
  const { itens, atas, contratos, certidoes, faturamentos, recebimentos } = _data;

  // ── Período ───────────────────────────────────────────────────────────────
  const itensPeriodo = itens.filter((i) => inPeriodo(i.licitacao?.data_sessao));
  const ganhosP = itensPeriodo.filter((i) => i.status === 'Ganhou');
  const decididosP = itensPeriodo.filter((i) => i.status !== 'Em disputa');
  const licDisputadasIds = [...new Set(itensPeriodo.map((i) => i.licitacao_id))];
  const licGanhasIds = [...new Set(ganhosP.map((i) => i.licitacao_id))];
  const valorArremP = sumBy(ganhosP, (i) => Number(i.valor_final || 0) * Number(i.quantidade || 0));
  const taxaP = decididosP.length ? (ganhosP.length / decididosP.length) * 100 : 0;
  const faturamentosP = faturamentos.filter((f) => f.situacao !== 'Cancelada' && inPeriodo(f.data_emissao));
  const valorFaturadoP = sumBy(faturamentosP, (f) => Number(f.valor_fatura || 0));
  const recebimentosP = recebimentos.filter((r) => inPeriodo(r.data_recebimento));
  const valorRecebidoP = sumBy(recebimentosP, (r) => Number(r.valor || 0));

  // ── Acumulado ─────────────────────────────────────────────────────────────
  const emDisputa = itens.filter((i) => i.status === 'Em disputa');
  const ganhos = itens.filter((i) => i.status === 'Ganhou');
  const decididos = itens.filter((i) => i.status !== 'Em disputa');
  const taxaExito = decididos.length ? (ganhos.length / decididos.length) * 100 : 0;
  const valorGanho = sumBy(ganhos, (i) => Number(i.valor_final || 0) * Number(i.quantidade || 0));
  const atasVigentes = atas.filter((a) => a.situacao === 'Vigente');
  const valorAtasVigentes = sumBy(atasVigentes, (a) => Number(a.valor_total || 0));
  const faturamentosAtivos = faturamentos.filter((f) => f.situacao !== 'Cancelada');
  const recebPorFatura = new Map();
  recebimentos.forEach((r) => recebPorFatura.set(r.faturamento_id, (recebPorFatura.get(r.faturamento_id) || 0) + Number(r.valor || 0)));
  const totalFaturado = sumBy(faturamentosAtivos, (f) => Number(f.valor_fatura || 0));
  const totalRecebido = [...recebPorFatura.values()].reduce((a, b) => a + b, 0);
  const totalEmAberto = Math.max(0, totalFaturado - totalRecebido);
  const faturasEmAberto = faturamentosAtivos
    .map((f) => {
      const receb = recebPorFatura.get(f.id) || 0;
      return { ...f, receb, emAberto: Number(f.valor_fatura || 0) - receb, perc: f.valor_fatura > 0 ? (receb / f.valor_fatura) * 100 : 0 };
    })
    .filter((f) => f.emAberto > 0.01)
    .sort((a, b) => b.emAberto - a.emAberto)
    .slice(0, 6);

  // ── Alertas ───────────────────────────────────────────────────────────────
  const alertasAta = atasVigentes
    .map((a) => ({ tipo: 'Ata', titulo: a.numero_ata, meta: a.orgao?.nome || '-', data: a.vigencia_fim, alert: alertLevel(a.vigencia_fim) }))
    .filter((a) => a.alert);
  const alertasContrato = contratos.filter((c) => c.situacao === 'Vigente')
    .map((c) => ({ tipo: 'Contrato', titulo: c.numero_contrato, meta: c.orgao?.nome || '-', data: c.vigencia_fim, alert: alertLevel(c.vigencia_fim) }))
    .filter((c) => c.alert);
  const alertasCertidao = certidoes
    .map((c) => ({ tipo: 'Certidão', titulo: c.tipo, meta: c.numero || '-', data: c.data_validade, alert: alertLevel(c.data_validade) }))
    .filter((c) => c.alert);
  const alertas = [...alertasAta, ...alertasContrato, ...alertasCertidao].sort((a, b) => a.alert.days - b.alert.days);

  // ── Gráficos ──────────────────────────────────────────────────────────────
  const statusCounts = groupBy(itens, (i) => i.status);
  const donutData = [...statusCounts.entries()].map(([status, list]) => ({
    label: status, value: list.length, color: STATUS_HEX[status] || '#94A3B8',
  }));
  const now = new Date();
  const meses = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString('pt-BR', { month: 'short' }) };
  });
  const evolucaoData = meses.map(({ y, m, label }) => ({
    label,
    value: sumBy(
      ganhos.filter((i) => {
        if (!i.licitacao?.data_sessao) return false;
        const d = new Date(`${i.licitacao.data_sessao}T00:00:00`);
        return d.getFullYear() === y && d.getMonth() === m;
      }),
      (i) => Number(i.valor_final || 0) * Number(i.quantidade || 0),
    ),
  }));

  // ── Labels ────────────────────────────────────────────────────────────────
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const periodoLabel = { mes: 'Este mês', ano: 'Este ano', total: 'Acumulado total' }[_periodo];
  const periodoSub = _periodo === 'mes'
    ? new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : _periodo === 'ano' ? String(new Date().getFullYear()) : 'Todos os períodos';

  const tabBtn = (p, lbl) =>
    `<button class="periodo-tab${_periodo === p ? ' periodo-tab--active' : ''}" data-action="dashboard.setPeriodo" data-periodo="${p}">${lbl}</button>`;

  _container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <p>${hoje.charAt(0).toUpperCase() + hoje.slice(1)} · Visão geral do ciclo licitatório</p>
      </div>
      <div class="periodo-tabs">
        ${tabBtn('mes', 'Este mês')}
        ${tabBtn('ano', 'Este ano')}
        ${tabBtn('total', 'Total')}
      </div>
    </div>

    <div class="periodo-kpi-block">
      <div class="periodo-kpi-label">${periodoLabel}<span> · ${periodoSub}</span></div>
      <div class="kpi-grid">
        <div class="kpi-card kpi-card--periodo">
          <div class="kpi-icon kpi-icon--blue">${ICONS.licitacoes}</div>
          <div class="kpi-value">${licDisputadasIds.length}</div>
          <div class="kpi-label">Pregões disputados</div>
          <div class="kpi-foot">${itensPeriodo.length} itens participados</div>
        </div>
        <div class="kpi-card kpi-card--periodo">
          <div class="kpi-icon kpi-icon--green">${ICONS.check}</div>
          <div class="kpi-value">${licGanhasIds.length}</div>
          <div class="kpi-label">Pregões ganhos</div>
          <div class="kpi-foot">${decididosP.length ? taxaP.toFixed(0) + '% de êxito no período' : '—'}</div>
        </div>
        <div class="kpi-card kpi-card--periodo">
          <div class="kpi-icon kpi-icon--indigo">${ICONS.empenhos}</div>
          <div class="kpi-value">${fmtShort(valorArremP)}</div>
          <div class="kpi-label">Valor arrematado</div>
          <div class="kpi-foot">${ganhosP.length} itens ganhos</div>
        </div>
        <div class="kpi-card kpi-card--periodo">
          <div class="kpi-icon kpi-icon--orange">${ICONS.faturamento}</div>
          <div class="kpi-value">${fmtShort(valorFaturadoP)}</div>
          <div class="kpi-label">Faturado</div>
          <div class="kpi-foot">${faturamentosP.length} fatura(s) emitidas</div>
        </div>
        <div class="kpi-card kpi-card--periodo">
          <div class="kpi-icon kpi-icon--purple">${ICONS.certidoes}</div>
          <div class="kpi-value">${fmtShort(valorRecebidoP)}</div>
          <div class="kpi-label">Recebido</div>
          <div class="kpi-foot">${recebimentosP.length} pagamento(s)</div>
        </div>
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
          <div class="dash-card-subtitle">Distribuição por status · ${itens.length} itens total</div>
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

    <div class="dash-section-label">Visão geral · acumulado</div>
    <div class="kpi-grid" style="margin-bottom: 18px;">
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
        <div class="kpi-foot">${ganhos.length} itens · acumulado</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--orange">${ICONS.faturamento}</div>
        <div class="kpi-value">${fmtShort(totalEmAberto)}</div>
        <div class="kpi-label">Em aberto</div>
        <div class="kpi-foot">${faturasEmAberto.length} fatura(s) pendentes</div>
      </div>
    </div>

    <div class="grid-2" style="margin-top:0;">
      <div class="card">
        <div class="dash-card-header">
          <div class="dash-card-title">Alertas de vencimento</div>
          <div class="dash-card-subtitle">Atas, contratos e certidões a vencer</div>
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
      <div class="card">
        <div class="dash-card-header">
          <div class="dash-card-title">Faturas pendentes</div>
          <div class="dash-card-subtitle">${faturasEmAberto.length ? `${faturasEmAberto.length} fatura(s) · ${fmtShort(totalEmAberto)} a receber` : 'Tudo recebido'}</div>
        </div>
        ${faturasEmAberto.length ? `
          <div class="rel-prog-list">
            ${faturasEmAberto.map((f) => {
              const barColor = f.perc >= 75 ? '#16A34A' : f.perc >= 40 ? '#1E3A5F' : '#B5790A';
              return `
                <div class="rel-prog-row">
                  <div class="rel-prog-header">
                    <span class="rel-prog-title">${f.numero_fatura || `Fatura #${f.id}`} · ${f.empenho?.orgao?.nome || '-'}</span>
                    <span class="rel-prog-meta">${fmtShort(f.emAberto)} em aberto</span>
                  </div>
                  <div class="rel-prog-bar-wrap">
                    <div class="rel-prog-bar" style="width:${f.perc.toFixed(1)}%; background:${barColor}"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : `<p style="color:var(--gray-500);font-size:13px;padding:20px 0;text-align:center;">Nenhuma fatura em aberto.</p>`}
      </div>
    </div>
  `;

  drawBarChart(byId('chart-evolucao'), evolucaoData, { valueFormatter: (v) => formatCurrency(v).replace('R$', '').trim() });
  drawDonutChart(byId('chart-status'), donutData, { centerLabel: String(itens.length) });
}

export const actions = {
  'dashboard.setPeriodo': (target) => {
    _periodo = target.dataset.periodo;
    renderContent();
  },
};
