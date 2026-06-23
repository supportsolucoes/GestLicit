import * as Service from '../supabase-service.js';
import { formatCurrency, sumBy, groupBy } from '../helpers.js';
import { showToast } from '../ui.js';
import { STATUS_LICITACAO } from '../constants.js';

export async function render(container) {
  container.innerHTML = `
    <div class="page-header"><div><h1>Relatórios</h1><p>Exportação de relatórios em Excel e PDF.</p></div></div>
    <div class="grid-3">
      <div class="card">
        <strong>Resultado mensal</strong>
        <p style="color:var(--gray-500); font-size:13px;">Ganhou, Declinou, Desclassificado, Fracassado e Revogado por mês.</p>
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="btn btn-ghost btn-sm" data-action="relatorios.resultadoExcel">Excel</button>
          <button class="btn btn-ghost btn-sm" data-action="relatorios.resultadoPdf">PDF</button>
        </div>
      </div>
      <div class="card">
        <strong>Licitações</strong>
        <p style="color:var(--gray-500); font-size:13px;">Lista completa de editais e itens disputados.</p>
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="btn btn-ghost btn-sm" data-action="relatorios.licitacoesExcel">Excel</button>
        </div>
      </div>
      <div class="card">
        <strong>Atas e vencimentos</strong>
        <p style="color:var(--gray-500); font-size:13px;">Atas/empenhos com vigência e situação.</p>
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="btn btn-ghost btn-sm" data-action="relatorios.atasExcel">Excel</button>
        </div>
      </div>
      <div class="card">
        <strong>Certidões</strong>
        <p style="color:var(--gray-500); font-size:13px;">Situação e vencimento das certidões da empresa.</p>
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="btn btn-ghost btn-sm" data-action="relatorios.certidoesExcel">Excel</button>
        </div>
      </div>
    </div>
  `;
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

function ensureXlsx() {
  if (!window.XLSX) {
    showToast('Biblioteca de exportação Excel não carregada.', 'error');
    return false;
  }
  return true;
}

function ensureJsPdf() {
  if (!window.jspdf) {
    showToast('Biblioteca de exportação PDF não carregada.', 'error');
    return false;
  }
  return true;
}

function exportSheet(rows, sheetName, fileName) {
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
  window.XLSX.writeFile(wb, fileName);
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
  'relatorios.certidoesExcel': () => certidoesExcel(),
};
