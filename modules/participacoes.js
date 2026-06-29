import * as Service from '../supabase-service.js';
import { byId, formatCurrency, sumBy, groupBy, escapeHtml, todayISO } from '../helpers.js';
import { drawBarChart } from '../charts.js';
import { ICONS } from '../constants.js';

// ─── estado ──────────────────────────────────────────────────────────────────
let _itens = [];
let _container = null;
let _filtros = {
  inicio: `${new Date().getFullYear()}-01-01`,
  fim: todayISO(),
  uf: '',
  modalidade: '',
};

function fmtShort(val) {
  if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(1).replace('.', ',')}M`;
  if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(0)}K`;
  return formatCurrency(val);
}

// ─── render principal ─────────────────────────────────────────────────────────
export async function render(container) {
  _container = container;
  container.innerHTML = `<div class="empty-state">Carregando participações...</div>`;
  _itens = await Service.listParticipacoes();
  renderContent();
}

// ─── filtragem ────────────────────────────────────────────────────────────────
function itensFiltrados() {
  return _itens.filter((i) => {
    const data = i.licitacao?.data_abertura || i.licitacao?.data_sessao;
    if (!data) return false;
    if (_filtros.inicio && data < _filtros.inicio) return false;
    if (_filtros.fim && data > _filtros.fim) return false;
    if (_filtros.uf) {
      const uf = i.licitacao?.uf || i.licitacao?.orgao?.uf || '';
      if (uf !== _filtros.uf) return false;
    }
    if (_filtros.modalidade && i.licitacao?.modalidade !== _filtros.modalidade) return false;
    return true;
  });
}

// ─── cálculo de KPIs ─────────────────────────────────────────────────────────
function calcKpis(itens) {
  const decididos = itens.filter((i) => i.status !== 'Em disputa');
  const ganhos = itens.filter((i) => i.status === 'Ganhou');
  const desclassificados = itens.filter((i) => i.status === 'Desclassificado');

  const licIds = new Set(itens.map((i) => i.licitacao?.id).filter(Boolean));
  const licVencidas = new Set(ganhos.map((i) => i.licitacao?.id).filter(Boolean));
  const licDecididas = new Set(decididos.map((i) => i.licitacao?.id).filter(Boolean));

  const taxaExito = licDecididas.size > 0 ? (licVencidas.size / licDecididas.size) * 100 : 0;
  const aprovItens = decididos.length > 0 ? (ganhos.length / decididos.length) * 100 : 0;

  const valorParticipado = sumBy(
    itens.filter((i) => i.valor_final),
    (i) => Number(i.valor_final) * Number(i.quantidade || 1),
  );
  const valorArrematado = sumBy(
    ganhos,
    (i) => Number(i.valor_arrematado || i.valor_final || 0) * Number(i.quantidade || 1),
  );

  return {
    taxaExito, licIds, licVencidas, licDecididas,
    itensGanhos: ganhos.length, itensDecididos: decididos.length, aprovItens,
    valorParticipado, valorArrematado,
    ganhos, desclassificados,
  };
}

// ─── renderização ─────────────────────────────────────────────────────────────
function renderContent() {
  if (!_container) return;
  const itens = itensFiltrados();
  const k = calcKpis(itens);

  const ufsDisp = [...new Set(
    _itens.map((i) => i.licitacao?.uf || i.licitacao?.orgao?.uf || '').filter(Boolean),
  )].sort();
  const modalDisp = [...new Set(
    _itens.map((i) => i.licitacao?.modalidade || '').filter(Boolean),
  )].sort();

  // dados do gráfico de barras (valor arrematado por mês)
  const porMes = groupBy(
    k.ganhos.filter((i) => i.licitacao?.data_abertura || i.licitacao?.data_sessao),
    (i) => (i.licitacao.data_abertura || i.licitacao.data_sessao).slice(0, 7),
  );
  const meses = [...porMes.keys()].sort();
  const barData = meses.map((m) => ({
    label: new Date(`${m}-01T00:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
    value: sumBy(porMes.get(m), (i) => Number(i.valor_arrematado || i.valor_final || 0) * Number(i.quantidade || 1)),
  }));

  // participação por UF
  const porUf = groupBy(itens, (i) => i.licitacao?.uf || i.licitacao?.orgao?.uf || 'N/D');
  const porUfArr = [...porUf.entries()]
    .map(([uf, lista]) => ({
      uf,
      total: new Set(lista.map((i) => i.licitacao?.id).filter(Boolean)).size,
      vitórias: new Set(lista.filter((i) => i.status === 'Ganhou').map((i) => i.licitacao?.id).filter(Boolean)).size,
    }))
    .sort((a, b) => b.total - a.total);

  // principais modalidades
  const porMod = groupBy(itens, (i) => i.licitacao?.modalidade || 'Não informada');
  const porModArr = [...porMod.entries()]
    .map(([mod, lista]) => ({
      mod,
      total: new Set(lista.map((i) => i.licitacao?.id).filter(Boolean)).size,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
  const maxMod = porModArr[0]?.total || 1;

  // SVG gauge
  const R = 36;
  const circ = 2 * Math.PI * R;
  const dash = (k.taxaExito / 100) * circ;
  const gaugeColor = k.taxaExito >= 50 ? '#16A34A' : k.taxaExito >= 25 ? '#D97706' : '#DC2626';

  _container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Minhas Participações</h1>
        <p>Desempenho em pregões por período, UF e modalidade</p>
      </div>
    </div>

    <div class="card no-sticky" style="margin-bottom:16px;">
      <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end;">
        <div class="form-field" style="flex:1; min-width:130px;">
          <label>Data início</label>
          <input type="date" id="part-inicio" class="form-input" value="${_filtros.inicio}">
        </div>
        <div class="form-field" style="flex:1; min-width:130px;">
          <label>Data fim</label>
          <input type="date" id="part-fim" class="form-input" value="${_filtros.fim}">
        </div>
        <div class="form-field" style="flex:1; min-width:100px;">
          <label>UF</label>
          <select id="part-uf" class="form-input">
            <option value="">Todas</option>
            ${ufsDisp.map((u) => `<option value="${escapeHtml(u)}" ${_filtros.uf === u ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field" style="flex:2; min-width:160px;">
          <label>Modalidade</label>
          <select id="part-modalidade" class="form-input">
            <option value="">Todas</option>
            ${modalDisp.map((m) => `<option value="${escapeHtml(m)}" ${_filtros.modalidade === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" data-action="participacoes.filtrar" style="height:38px; align-self:flex-end;">Filtrar</button>
      </div>
    </div>

    <div class="kpi-grid kpi-grid-4" style="margin-bottom:16px;">
      <div class="kpi-card" style="display:flex; flex-direction:column; align-items:center; gap:6px; padding:16px 8px;">
        <svg width="84" height="84" viewBox="0 0 84 84">
          <circle cx="42" cy="42" r="${R}" fill="none" stroke="var(--gray-100)" stroke-width="9"/>
          <circle cx="42" cy="42" r="${R}" fill="none" stroke="${gaugeColor}" stroke-width="9"
            stroke-dasharray="${dash.toFixed(2)} ${circ.toFixed(2)}"
            stroke-linecap="round" transform="rotate(-90 42 42)"/>
          <text x="42" y="42" text-anchor="middle" dominant-baseline="central"
            fill="${gaugeColor}" font-size="15" font-weight="700">${k.taxaExito.toFixed(0)}%</text>
        </svg>
        <div class="kpi-label">Taxa de êxito</div>
        <div class="kpi-foot">${k.licVencidas.size} de ${k.licDecididas.size} licitações</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--blue">${ICONS.licitacoes}</div>
        <div class="kpi-value">${k.licIds.size}</div>
        <div class="kpi-label">Licitações disputadas</div>
        <div class="kpi-foot">${k.licVencidas.size} com vitórias</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--green">${ICONS.check}</div>
        <div class="kpi-value">${k.itensGanhos}/${k.itensDecididos}</div>
        <div class="kpi-label">Itens ganhos</div>
        <div class="kpi-foot">${k.aprovItens.toFixed(1)}% de aproveitamento</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--purple">${ICONS.empenhos}</div>
        <div class="kpi-value">${fmtShort(k.valorArrematado)}</div>
        <div class="kpi-label">Valor arrematado</div>
        <div class="kpi-foot">${fmtShort(k.valorParticipado)} participado</div>
      </div>
    </div>

    <div class="grid-2" style="margin-bottom:16px;">
      <div class="card">
        <div class="dash-card-header">
          <div class="dash-card-title">Arrematações por período</div>
          <div class="dash-card-subtitle">Valor ganho por mês (data de abertura)</div>
        </div>
        ${barData.length
          ? `<canvas id="chart-part-bar" style="width:100%; height:200px;"></canvas>`
          : `<p class="rel-empty" style="margin-top:16px;">Nenhum item ganho no período.</p>`}
      </div>
      <div class="card">
        <div class="dash-card-header">
          <div class="dash-card-title">Principais modalidades</div>
          <div class="dash-card-subtitle">Licitações por modalidade no período</div>
        </div>
        ${porModArr.length ? `
          <div class="rel-top5" style="margin-top:8px;">
            ${porModArr.map((m) => `
              <div class="rel-top5-row">
                <span class="rel-top5-label" style="flex:2; font-size:12px;">${escapeHtml(m.mod)}</span>
                <div class="rel-top5-bar-wrap"><div class="rel-top5-bar" style="width:${(m.total / maxMod * 100).toFixed(1)}%"></div></div>
                <span class="rel-top5-value">${m.total}</span>
              </div>
            `).join('')}
          </div>
        ` : `<p class="rel-empty" style="margin-top:16px;">Nenhuma licitação no período.</p>`}
      </div>
    </div>

    <div class="grid-2" style="margin-bottom:16px;">
      <div class="card">
        <div class="dash-card-header">
          <div class="dash-card-title">Participação por estado</div>
          <div class="dash-card-subtitle">${porUfArr.length} estado(s) no período</div>
        </div>
        ${porUfArr.length ? `
          <table class="data-table" style="margin-top:8px;">
            <thead>
              <tr><th>UF</th><th>Licitações</th><th>Vitórias</th><th>Êxito</th></tr>
            </thead>
            <tbody>
              ${porUfArr.map((u) => `
                <tr>
                  <td><strong>${escapeHtml(u.uf)}</strong></td>
                  <td>${u.total}</td>
                  <td>${u['vitórias']}</td>
                  <td>${u.total > 0 ? ((u['vitórias'] / u.total) * 100).toFixed(0) : 0}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `<p class="rel-empty" style="margin-top:16px;">Nenhuma participação no período.</p>`}
      </div>
      <div class="card">
        <div class="dash-card-header">
          <div class="dash-card-title">Desclassificações no período</div>
          <div class="dash-card-subtitle">${k.desclassificados.length} item(ns)</div>
        </div>
        ${k.desclassificados.length ? `
          <div class="alert-list" style="margin-top:8px;">
            ${k.desclassificados.slice(0, 8).map((i) => `
              <div class="alert-row">
                <div class="alert-row-body">
                  <div class="alert-row-title">${escapeHtml(i.produto_descricao || i.produto?.nome || 'Produto não informado')}</div>
                  <div class="alert-row-meta">${escapeHtml(i.licitacao?.numero_pregao || '-')} · ${escapeHtml(i.motivo_perda || 'Motivo não informado')}</div>
                </div>
              </div>
            `).join('')}
            ${k.desclassificados.length > 8 ? `
              <div class="alert-row">
                <div class="alert-row-meta">+ ${k.desclassificados.length - 8} desclassificação(ões)</div>
              </div>` : ''}
          </div>
        ` : `
          <div style="display:flex; flex-direction:column; align-items:center; padding:24px; gap:8px; color:var(--green-600);">
            ${ICONS.check}
            <p style="margin:0; font-size:13px; color:var(--gray-500);">Nenhuma desclassificação no período</p>
          </div>`}
      </div>
    </div>
  `;

  const canvas = byId('chart-part-bar');
  if (canvas && barData.length) {
    drawBarChart(canvas, barData, {
      color: '#1E3A5F',
      valueFormatter: (v) => v > 0 ? fmtShort(v).replace('R$ ', '') : '0',
    });
  }
}

// ─── actions ─────────────────────────────────────────────────────────────────
export const actions = {
  'participacoes.filtrar': () => {
    _filtros.inicio = byId('part-inicio')?.value || '';
    _filtros.fim = byId('part-fim')?.value || '';
    _filtros.uf = byId('part-uf')?.value || '';
    _filtros.modalidade = byId('part-modalidade')?.value || '';
    renderContent();
  },
};
