import * as Service from '../supabase-service.js';
import { byId, formatCurrency, formatDate, alertLevel, sumBy, groupBy } from '../helpers.js';
import { badge, showToast } from '../ui.js';
import { drawBarChart } from '../charts.js';
import { ICONS, STATUS_LICITACAO } from '../constants.js';

// ─── estado do módulo ────────────────────────────────────────────────────────
let _itens = [], _atas = [], _contratos = [], _faturamentos = [], _recebimentos = [];
let _ano = new Date().getFullYear();

function fmtShort(val) {
  if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(1).replace('.', ',')}M`;
  if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(0)}K`;
  return formatCurrency(val);
}

// ─── render principal ────────────────────────────────────────────────────────
export async function render(container) {
  container.innerHTML = `<div class="empty-state">Carregando relatórios...</div>`;

  [_itens, _atas, _contratos, _faturamentos, _recebimentos] = await Promise.all([
    Service.listAllLicitacaoItens(),
    Service.listAtas(),
    Service.listContratos(),
    Service.listFaturamentos(),
    Service.listAllRecebimentos(),
  ]);

  _ano = new Date().getFullYear();
  renderContent(container);
}

function renderContent(container) {
  // ── Desempenho comercial ─────────────────────────────────────────────────
  const itensFiltrados = _itens.filter((i) => {
    if (!i.licitacao?.data_sessao) return false;
    return new Date(`${i.licitacao.data_sessao}T00:00:00`).getFullYear() === _ano;
  });
  const decididos = itensFiltrados.filter((i) => i.status !== 'Em disputa');
  const ganhos = itensFiltrados.filter((i) => i.status === 'Ganhou');
  const taxaExito = decididos.length ? (ganhos.length / decididos.length) * 100 : 0;
  const valorGanho = sumBy(ganhos, (i) => Number(i.valor_final || 0) * Number(i.quantidade || 0));

  // gráfico: valor ganho por mês do ano selecionado
  const barData = Array.from({ length: 12 }, (_, m) => {
    const d = new Date(_ano, m, 1);
    const label = d.toLocaleDateString('pt-BR', { month: 'short' });
    const value = sumBy(
      ganhos.filter((i) => new Date(`${i.licitacao.data_sessao}T00:00:00`).getMonth() === m),
      (i) => Number(i.valor_final || 0) * Number(i.quantidade || 0),
    );
    return { label, value };
  });

  // top 5 órgãos por valor ganho
  const porOrgao = groupBy(ganhos, (i) => i.licitacao?.orgao?.nome || 'Não informado');
  const top5 = [...porOrgao.entries()]
    .map(([nome, list]) => ({ nome, valor: sumBy(list, (i) => Number(i.valor_final || 0) * Number(i.quantidade || 0)) }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5);
  const maxTop5 = top5[0]?.valor || 1;

  // ── Contratos & Atas ─────────────────────────────────────────────────────
  const atasVigentes = _atas.filter((a) => a.situacao === 'Vigente');
  const contratosVigentes = _contratos.filter((c) => c.situacao === 'Vigente');
  const valorAtasVig = sumBy(atasVigentes, (a) => Number(a.valor_total || 0));
  const valorContratosVig = sumBy(contratosVigentes, (c) => Number(c.valor_contrato || 0));
  const valorTotalVig = valorAtasVig + valorContratosVig;

  const vencimentos = [
    ...atasVigentes.map((a) => ({ tipo: 'Ata', titulo: a.numero_ata, orgao: a.orgao?.nome || '-', data: a.vigencia_fim, alert: alertLevel(a.vigencia_fim) })),
    ...contratosVigentes.map((c) => ({ tipo: 'Contrato', titulo: c.numero_contrato, orgao: c.orgao?.nome || '-', data: c.vigencia_fim, alert: alertLevel(c.vigencia_fim) })),
  ].filter((v) => v.alert).sort((a, b) => a.alert.days - b.alert.days).slice(0, 6);

  // ── Faturamento ──────────────────────────────────────────────────────────
  const faturamentosAtivos = _faturamentos.filter((f) => f.situacao !== 'Cancelada');
  const totalFaturado = sumBy(faturamentosAtivos, (f) => Number(f.valor_fatura || 0));
  const recebPorFatura = new Map();
  _recebimentos.forEach((r) => recebPorFatura.set(r.faturamento_id, (recebPorFatura.get(r.faturamento_id) || 0) + Number(r.valor || 0)));
  const totalRecebido = [...recebPorFatura.values()].reduce((a, b) => a + b, 0);
  const totalEmAberto = Math.max(0, totalFaturado - totalRecebido);
  const percRecebido = totalFaturado > 0 ? (totalRecebido / totalFaturado) * 100 : 0;

  const faturasEmAberto = faturamentosAtivos
    .map((f) => {
      const receb = recebPorFatura.get(f.id) || 0;
      return { ...f, receb, emAberto: Number(f.valor_fatura || 0) - receb, perc: f.valor_fatura > 0 ? (receb / f.valor_fatura) * 100 : 0 };
    })
    .filter((f) => f.emAberto > 0.01)
    .sort((a, b) => b.emAberto - a.emAberto)
    .slice(0, 5);

  // ── Anos disponíveis ─────────────────────────────────────────────────────
  const anos = [...new Set(
    _itens.filter((i) => i.licitacao?.data_sessao)
      .map((i) => new Date(`${i.licitacao.data_sessao}T00:00:00`).getFullYear()),
  )].sort((a, b) => b - a);
  if (!anos.includes(_ano)) anos.unshift(_ano);

  // ── HTML ─────────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Relatórios</h1>
        <p>Indicadores e exportações do ciclo licitatório</p>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <label for="rel-ano-select" style="font-size:13px; color:var(--gray-500); white-space:nowrap;">Ano de referência:</label>
        <select id="rel-ano-select" class="form-input" style="width:auto; min-width:90px;">
          ${anos.map((a) => `<option value="${a}" ${a === _ano ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
      </div>
    </div>

    <!-- ─── Desempenho Comercial ─────────────────────────────────────────── -->
    <div class="rel-section">
      <div class="rel-section-header">
        <div class="rel-section-title">Desempenho Comercial</div>
        <div class="rel-section-count">${itensFiltrados.length} itens disputados em ${_ano}</div>
      </div>
      <div class="kpi-grid kpi-grid-4">
        <div class="kpi-card">
          <div class="kpi-icon kpi-icon--blue">${ICONS.licitacoes}</div>
          <div class="kpi-value">${itensFiltrados.length}</div>
          <div class="kpi-label">Itens disputados</div>
          <div class="kpi-foot">${decididos.length} com resultado</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon kpi-icon--green">${ICONS.check}</div>
          <div class="kpi-value">${ganhos.length}</div>
          <div class="kpi-label">Itens ganhos</div>
          <div class="kpi-foot">de ${decididos.length} decididos</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon kpi-icon--indigo">${ICONS.relatorios}</div>
          <div class="kpi-value">${taxaExito.toFixed(1)}%</div>
          <div class="kpi-label">Taxa de êxito</div>
          <div class="kpi-foot">${decididos.length ? `${ganhos.length}/${decididos.length} itens` : 'sem dados'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon kpi-icon--purple">${ICONS.empenhos}</div>
          <div class="kpi-value">${fmtShort(valorGanho)}</div>
          <div class="kpi-label">Valor ganho</div>
          <div class="kpi-foot">Soma dos itens ganhos</div>
        </div>
      </div>
      <div class="grid-2" style="margin-top:16px;">
        <div class="card">
          <div class="dash-card-header">
            <div class="dash-card-title">Valor ganho por mês</div>
            <div class="dash-card-subtitle">${_ano} · todos os meses</div>
          </div>
          <canvas id="chart-mensal" style="width:100%; height:200px;"></canvas>
        </div>
        <div class="card">
          <div class="dash-card-header">
            <div class="dash-card-title">Top 5 órgãos</div>
            <div class="dash-card-subtitle">Por valor ganho em ${_ano}</div>
          </div>
          ${top5.length ? `
            <div class="rel-top5">
              ${top5.map((o, idx) => `
                <div class="rel-top5-row">
                  <span class="rel-top5-rank">${idx + 1}</span>
                  <span class="rel-top5-label">${o.nome}</span>
                  <div class="rel-top5-bar-wrap"><div class="rel-top5-bar" style="width:${(o.valor / maxTop5 * 100).toFixed(1)}%"></div></div>
                  <span class="rel-top5-value">${fmtShort(o.valor)}</span>
                </div>
              `).join('')}
            </div>
          ` : `<p class="rel-empty">Nenhum item ganho em ${_ano}.</p>`}
        </div>
      </div>
    </div>

    <!-- ─── Contratos & Atas ─────────────────────────────────────────────── -->
    <div class="rel-section">
      <div class="rel-section-header">
        <div class="rel-section-title">Contratos &amp; Atas</div>
        <div class="rel-section-count">${_atas.length} atas · ${_contratos.length} contratos</div>
      </div>
      <div class="kpi-grid kpi-grid-3">
        <div class="kpi-card">
          <div class="kpi-icon kpi-icon--blue">${ICONS.contratos}</div>
          <div class="kpi-value">${contratosVigentes.length}</div>
          <div class="kpi-label">Contratos vigentes</div>
          <div class="kpi-foot">${fmtShort(valorContratosVig)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon kpi-icon--purple">${ICONS.atas}</div>
          <div class="kpi-value">${atasVigentes.length}</div>
          <div class="kpi-label">Atas vigentes</div>
          <div class="kpi-foot">${fmtShort(valorAtasVig)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon kpi-icon--green">${ICONS.empenhos}</div>
          <div class="kpi-value">${fmtShort(valorTotalVig)}</div>
          <div class="kpi-label">Valor em vigência</div>
          <div class="kpi-foot">Contratos + Atas vigentes</div>
        </div>
      </div>
      <div class="card" style="margin-top:16px;">
        <div class="dash-card-header">
          <div class="dash-card-title">Próximos vencimentos</div>
          <div class="dash-card-subtitle">Contratos e atas com alerta ativo</div>
        </div>
        <div class="alert-list">
          ${vencimentos.length ? vencimentos.map((v) => `
            <div class="alert-row">
              <div class="alert-row-body">
                <div class="alert-row-title">${v.tipo}: ${v.titulo}</div>
                <div class="alert-row-meta">${v.orgao} · vence ${formatDate(v.data)}</div>
              </div>
              ${badge(v.alert.level === 'vencido' ? 'Vencido' : `${v.alert.days}d`, v.alert.level === 'vencido' ? 'danger' : 'warning')}
            </div>
          `).join('') : `<p class="rel-empty">Nenhum vencimento próximo nos próximos 90 dias.</p>`}
        </div>
      </div>
    </div>

    <!-- ─── Faturamento ──────────────────────────────────────────────────── -->
    <div class="rel-section">
      <div class="rel-section-header">
        <div class="rel-section-title">Faturamento</div>
        <div class="rel-section-count">${faturamentosAtivos.length} faturas ativas</div>
      </div>
      <div class="kpi-grid kpi-grid-3">
        <div class="kpi-card">
          <div class="kpi-icon kpi-icon--indigo">${ICONS.faturamento}</div>
          <div class="kpi-value">${fmtShort(totalFaturado)}</div>
          <div class="kpi-label">Total faturado</div>
          <div class="kpi-foot">${faturamentosAtivos.length} faturas ativas</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon kpi-icon--green">${ICONS.check}</div>
          <div class="kpi-value">${fmtShort(totalRecebido)}</div>
          <div class="kpi-label">Total recebido</div>
          <div class="kpi-foot">${percRecebido.toFixed(1)}% do faturado</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon kpi-icon--orange">${ICONS.agenda}</div>
          <div class="kpi-value">${fmtShort(totalEmAberto)}</div>
          <div class="kpi-label">Em aberto</div>
          <div class="kpi-foot">${faturasEmAberto.length} fatura(s) pendentes</div>
        </div>
      </div>
      ${faturasEmAberto.length ? `
        <div class="card" style="margin-top:16px;">
          <div class="dash-card-header">
            <div class="dash-card-title">Faturas em aberto</div>
            <div class="dash-card-subtitle">Maiores valores pendentes de recebimento</div>
          </div>
          <div class="rel-prog-list">
            ${faturasEmAberto.map((f) => {
              const barColor = f.perc >= 75 ? '#16A34A' : f.perc >= 40 ? '#2563EB' : '#D97706';
              return `
                <div class="rel-prog-row">
                  <div class="rel-prog-header">
                    <span class="rel-prog-title">${f.numero_fatura || `Fatura #${f.id}`} · ${f.empenho?.orgao?.nome || '-'}</span>
                    <span class="rel-prog-meta">${fmtShort(f.receb)} recebido de ${fmtShort(f.valor_fatura)}</span>
                  </div>
                  <div class="rel-prog-bar-wrap">
                    <div class="rel-prog-bar" style="width:${f.perc.toFixed(1)}%; background:${barColor}"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>

    <!-- ─── Exportações ──────────────────────────────────────────────────── -->
    <div class="rel-section">
      <div class="rel-section-header">
        <div class="rel-section-title">Exportações</div>
      </div>
      <div class="rel-export-grid">
        <div class="rel-export-card">
          <div class="rel-export-title">Resultado Mensal</div>
          <div class="rel-export-desc">Ganhos, perdas e valores por mês, com breakdown por status de item.</div>
          <div class="rel-export-actions">
            <button class="btn btn-ghost btn-sm" data-action="relatorios.resultadoExcel">Excel</button>
            <button class="btn btn-ghost btn-sm" data-action="relatorios.resultadoPdf">PDF</button>
          </div>
        </div>
        <div class="rel-export-card">
          <div class="rel-export-title">Licitações</div>
          <div class="rel-export-desc">Lista completa de editais e itens com status, valores e motivo de perda.</div>
          <div class="rel-export-actions">
            <button class="btn btn-ghost btn-sm" data-action="relatorios.licitacoesExcel">Excel</button>
          </div>
        </div>
        <div class="rel-export-card">
          <div class="rel-export-title">Atas</div>
          <div class="rel-export-desc">Vigência, situação e valores de todas as atas de registro de preço.</div>
          <div class="rel-export-actions">
            <button class="btn btn-ghost btn-sm" data-action="relatorios.atasExcel">Excel</button>
          </div>
        </div>
        <div class="rel-export-card">
          <div class="rel-export-title">Contratos</div>
          <div class="rel-export-desc">Vigência, situação e valores de todos os contratos formais.</div>
          <div class="rel-export-actions">
            <button class="btn btn-ghost btn-sm" data-action="relatorios.contratosExcel">Excel</button>
          </div>
        </div>
        <div class="rel-export-card">
          <div class="rel-export-title">Faturamento</div>
          <div class="rel-export-desc">Faturas com valor, recebimentos e saldo em aberto por empenho.</div>
          <div class="rel-export-actions">
            <button class="btn btn-ghost btn-sm" data-action="relatorios.faturamentoExcel">Excel</button>
          </div>
        </div>
        <div class="rel-export-card">
          <div class="rel-export-title">Certidões</div>
          <div class="rel-export-desc">Situação e vencimento das certidões da empresa.</div>
          <div class="rel-export-actions">
            <button class="btn btn-ghost btn-sm" data-action="relatorios.certidoesExcel">Excel</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind seletor de ano (change não é capturado pelo dispatcher global)
  container.querySelector('#rel-ano-select')?.addEventListener('change', (e) => {
    _ano = Number(e.target.value);
    renderContent(container);
  });

  // Desenha gráfico após o DOM estar pronto
  const canvas = byId('chart-mensal');
  if (canvas) {
    drawBarChart(canvas, barData, {
      color: '#2563EB',
      valueFormatter: (v) => v > 0 ? fmtShort(v).replace('R$ ', '') : '0',
    });
  }
}

// ─── Exportações ─────────────────────────────────────────────────────────────
function ensureXlsx() {
  if (!window.XLSX) { showToast('Biblioteca de exportação Excel não carregada.', 'error'); return false; }
  return true;
}
function ensureJsPdf() {
  if (!window.jspdf) { showToast('Biblioteca de exportação PDF não carregada.', 'error'); return false; }
  return true;
}
function exportSheet(rows, sheetName, fileName) {
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
  window.XLSX.writeFile(wb, fileName);
}

async function getResultadoMensalData() {
  const itens = await Service.listAllLicitacaoItens();
  const comData = itens.filter((i) => i.licitacao?.data_sessao);
  const porMes = groupBy(comData, (i) => i.licitacao.data_sessao.slice(0, 7));
  const meses = [...porMes.keys()].sort();
  return meses.map((mes) => {
    const lista = porMes.get(mes);
    const total = sumBy(lista, (i) => Number(i.valor_final || 0) * Number(i.quantidade || 0));
    const porStatus = STATUS_LICITACAO.map((status) => {
      const subset = lista.filter((i) => i.status === status);
      const valor = sumBy(subset, (i) => Number(i.valor_final || 0) * Number(i.quantidade || 0));
      return { status, valor, percentual: total ? (valor / total) * 100 : 0, qtd: subset.length };
    });
    return { mes, total, porStatus };
  });
}

async function resultadoExcel() {
  if (!ensureXlsx()) return;
  const dados = await getResultadoMensalData();
  const rows = [['Mês', 'Status', 'Quantidade de itens', 'Valor', '% do total participado']];
  dados.forEach((m) => m.porStatus.forEach((s) => rows.push([m.mes, s.status, s.qtd, s.valor, `${s.percentual.toFixed(1)}%`])));
  exportSheet(rows, 'Resultado Mensal', 'resultado_mensal.xlsx');
}

async function resultadoPdf() {
  if (!ensureJsPdf()) return;
  const dados = await getResultadoMensalData();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 16;
  doc.setFontSize(14);
  doc.text('GestLicit — Resultado Mensal', 14, y);
  y += 10;
  doc.setFontSize(10);
  dados.forEach((m) => {
    if (y > 270) { doc.addPage(); y = 16; }
    doc.setFont(undefined, 'bold');
    doc.text(`${m.mes} — Total participado: ${formatCurrency(m.total)}`, 14, y);
    y += 6;
    doc.setFont(undefined, 'normal');
    m.porStatus.forEach((s) => {
      if (y > 270) { doc.addPage(); y = 16; }
      doc.text(`  ${s.status}: ${s.qtd} item(ns) - ${formatCurrency(s.valor)} - ${s.percentual.toFixed(1)}%`, 14, y);
      y += 5;
    });
    y += 4;
  });
  doc.save('resultado_mensal.pdf');
}

async function licitacoesExcel() {
  if (!ensureXlsx()) return;
  const itens = await Service.listAllLicitacaoItens();
  const rows = [['Pregão', 'Processo', 'Data Sessão', 'Item', 'Produto', 'Quantidade', 'Valor Final', 'Status', 'Motivo da Perda']];
  itens.forEach((i) => rows.push([
    i.licitacao?.numero_pregao || '', i.licitacao?.numero_processo || '', i.licitacao?.data_sessao || '',
    i.item_numero, i.produto_descricao || '', i.quantidade, i.valor_final, i.status, i.motivo_perda || '',
  ]));
  exportSheet(rows, 'Licitações', 'licitacoes.xlsx');
}

async function atasExcel() {
  if (!ensureXlsx()) return;
  const atas = await Service.listAtas();
  const rows = [['Número', 'Tipo', 'Órgão', 'Situação', 'Vigência Início', 'Vigência Fim', 'Valor Total']];
  atas.forEach((a) => rows.push([a.numero_ata, a.tipo, a.orgao?.nome || '', a.situacao, a.vigencia_inicio, a.vigencia_fim, a.valor_total]));
  exportSheet(rows, 'Atas', 'atas.xlsx');
}

async function contratosExcel() {
  if (!ensureXlsx()) return;
  const contratos = await Service.listContratos();
  const rows = [['Número', 'Órgão', 'Situação', 'Vigência Início', 'Vigência Fim', 'Valor']];
  contratos.forEach((c) => rows.push([c.numero_contrato, c.orgao?.nome || '', c.situacao, c.vigencia_inicio, c.vigencia_fim, c.valor_contrato]));
  exportSheet(rows, 'Contratos', 'contratos.xlsx');
}

async function faturamentoExcel() {
  if (!ensureXlsx()) return;
  const faturamentos = await Service.listFaturamentos();
  const recebimentos = await Service.listAllRecebimentos();
  const recebPorFatura = new Map();
  recebimentos.forEach((r) => recebPorFatura.set(r.faturamento_id, (recebPorFatura.get(r.faturamento_id) || 0) + Number(r.valor || 0)));
  const rows = [['Fatura', 'Órgão', 'Data Emissão', 'Valor Fatura', 'Recebido', 'Em Aberto', 'Situação']];
  faturamentos.forEach((f) => {
    const receb = recebPorFatura.get(f.id) || 0;
    rows.push([f.numero_fatura || '', f.empenho?.orgao?.nome || '', f.data_emissao || '', f.valor_fatura, receb, Math.max(0, Number(f.valor_fatura || 0) - receb), f.situacao]);
  });
  exportSheet(rows, 'Faturamento', 'faturamento.xlsx');
}

async function certidoesExcel() {
  if (!ensureXlsx()) return;
  const certidoes = await Service.Certidoes.list();
  const rows = [['Tipo', 'Número', 'Data Emissão', 'Data Validade']];
  certidoes.forEach((c) => rows.push([c.tipo, c.numero, c.data_emissao, c.data_validade]));
  exportSheet(rows, 'Certidões', 'certidoes.xlsx');
}

export const actions = {
  'relatorios.resultadoExcel': () => resultadoExcel(),
  'relatorios.resultadoPdf': () => resultadoPdf(),
  'relatorios.licitacoesExcel': () => licitacoesExcel(),
  'relatorios.atasExcel': () => atasExcel(),
  'relatorios.contratosExcel': () => contratosExcel(),
  'relatorios.faturamentoExcel': () => faturamentoExcel(),
  'relatorios.certidoesExcel': () => certidoesExcel(),
};
