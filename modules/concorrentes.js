import * as Service from '../supabase-service.js';
import { refreshLookups } from '../state.js';
import { buildCrudModule } from './_crud.js';
import * as External from '../external-apis.js';
import { byId, escapeHtml, formatCurrency, formatDate, sumBy, groupBy } from '../helpers.js';
import { showToast, renderEmptyState, badge } from '../ui.js';
import { drawBarChart, drawDonutChart } from '../charts.js';
import { ICONS } from '../constants.js';

const crudMod = buildCrudModule({
  actionPrefix: 'concorrentes',
  service: Service.Concorrentes,
  title: 'Concorrentes',
  singular: 'Concorrente',
  description: 'Empresas concorrentes, produtos com que costumam vencer os pregões, e análise pública de CNPJ.',
  searchKeys: ['nome', 'cnpj'],
  columns: [
    { key: 'nome', label: 'Nome' },
    { key: 'cnpj', label: 'CNPJ', render: (r) => escapeHtml(r.cnpj || '-') },
    { key: 'observacoes', label: 'Observações' },
  ],
  fields: [
    { key: 'nome', label: 'Nome da Empresa', required: true, span: 2 },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'observacoes', label: 'Produtos/observações', type: 'textarea', span: 2 },
  ],
  afterChange: refreshLookups,
  extraRowActions: (r) => (r.cnpj
    ? `<button class="icon-btn" data-action="concorrentes.analisarLinha" data-cnpj="${escapeHtml(r.cnpj)}" title="Analisar CNPJ">${ICONS.search}</button>`
    : ''),
});

let ultimaAnalise = null;

function fmtShort(val) {
  if (val >= 1e6) return `R$ ${(val / 1e6).toFixed(1).replace('.', ',')}M`;
  if (val >= 1e3) return `R$ ${(val / 1e3).toFixed(0)}K`;
  return formatCurrency(val);
}

export async function render(container) {
  await crudMod.render(container);

  // Remove caixa anterior para evitar duplicatas em renders concorrentes
  document.getElementById('analise-cnpj-box')?.remove();

  const box = document.createElement('div');
  box.className = 'card';
  box.id = 'analise-cnpj-box';
  box.style.marginBottom = '16px';
  box.innerHTML = `
    <div class="dash-card-header">
      <div class="dash-card-title">Análise de Concorrente</div>
      <div class="dash-card-subtitle">Consulta dados públicos da Receita Federal e do PNCP. Nada é armazenado no sistema.</div>
    </div>
    <div class="conc-search-row">
      <input type="text" id="analise-cnpj-input" placeholder="00.000.000/0000-00" class="form-input conc-search-input" />
      <button class="btn btn-primary" id="analise-btn-buscar" data-action="concorrentes.analisarBusca">${ICONS.search} Analisar</button>
      <button class="btn btn-ghost" data-action="concorrentes.limparAnalise">Limpar</button>
    </div>
    <div id="analise-resultado"></div>
  `;
  container.insertBefore(box, container.firstChild);

  byId('analise-cnpj-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') analisarBusca();
  });
}

function analisarBusca() {
  const cnpj = External.onlyDigits(byId('analise-cnpj-input').value);
  analisarCnpj(cnpj);
}

function analisarLinha(target) {
  const cnpj = External.onlyDigits(target.dataset.cnpj);
  byId('analise-cnpj-input').value = target.dataset.cnpj;
  byId('analise-cnpj-box')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  analisarCnpj(cnpj);
}

function limparAnalise() {
  ultimaAnalise = null;
  byId('analise-cnpj-input').value = '';
  byId('analise-resultado').innerHTML = '';
  byId('analise-cnpj-input').focus();
}

function setAnalisarBusy(busy) {
  const btn = byId('analise-btn-buscar');
  if (!btn) return;
  btn.disabled = busy;
  btn.innerHTML = busy ? `<span class="spinner spinner-sm"></span> Consultando...` : `${ICONS.search} Analisar`;
}

async function analisarCnpj(cnpjDigits) {
  if (cnpjDigits.length !== 14) {
    showToast('Informe um CNPJ válido (14 dígitos).', 'error');
    return;
  }
  const wrap = byId('analise-resultado');
  wrap.innerHTML = `
    <div class="loading-inline" style="margin-top:20px;">
      <div class="spinner"></div>
      <div>Consultando Receita Federal, PNCP e Portal da Transparência...</div>
    </div>
  `;
  setAnalisarBusy(true);

  try {
    const [empresa, pncp, certidoes] = await Promise.all([
      External.fetchEmpresaCnpj(cnpjDigits).catch((err) => ({ erro: err.message })),
      External.fetchContratosPncp(cnpjDigits).catch((err) => ({ erro: err.message, items: [], total: 0 })),
      External.fetchCertidoesPortalTransparencia(cnpjDigits).catch((err) => ({ erro: err.message, configured: true, ceis: [], cnep: [] })),
    ]);
    ultimaAnalise = { cnpj: cnpjDigits, empresa, contratos: pncp.items || [], totalContratos: pncp.total || 0, certidoes };
    renderResultado();
  } catch (err) {
    wrap.innerHTML = renderEmptyState(`Erro ao consultar: ${err.message || err}`);
  } finally {
    setAnalisarBusy(false);
  }
}

function renderResultado() {
  const wrap = byId('analise-resultado');
  const { empresa, contratos, totalContratos, certidoes } = ultimaAnalise;

  if (empresa.erro) {
    wrap.innerHTML = renderEmptyState(`Não foi possível consultar os dados da empresa: ${escapeHtml(empresa.erro)}`);
    return;
  }

  // ── Métricas ────────────────────────────────────────────────────────────
  const valorTotal = sumBy(contratos, (c) => Number(c.valor_global || 0));
  const ticketMedio = contratos.length ? valorTotal / contratos.length : 0;
  const datasValidas = contratos.map((c) => c.data_assinatura).filter(Boolean).sort().reverse();
  const ultimoContrato = datasValidas[0] || null;

  // ── Por modalidade (donut) ───────────────────────────────────────────────
  const PALETA = ['#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2'];
  const porModalidade = groupBy(contratos, (c) => c.modalidade_licitacao_nome || 'Não informada');
  const donutData = [...porModalidade.entries()]
    .map(([label, list], idx) => ({ label, value: list.length, color: PALETA[idx % PALETA.length] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // ── Evolução por ano (bar) ───────────────────────────────────────────────
  const porAno = groupBy(
    contratos.filter((c) => c.data_assinatura),
    (c) => c.data_assinatura.slice(0, 4),
  );
  const barAnoData = [...porAno.entries()]
    .map(([label, list]) => ({ label, value: sumBy(list, (c) => Number(c.valor_global || 0)) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(-7); // últimos 7 anos

  // ── Top 5 órgãos ────────────────────────────────────────────────────────
  const porOrgao = groupBy(contratos, (c) => c.orgao_nome || '-');
  const top5Orgaos = [...porOrgao.entries()]
    .map(([nome, list]) => ({ nome, valor: sumBy(list, (c) => Number(c.valor_global || 0)), qtd: list.length }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5);
  const maxOrgao = top5Orgaos[0]?.valor || 1;

  // ── Top 5 UFs ───────────────────────────────────────────────────────────
  const porUf = groupBy(contratos, (c) => c.uf || '-');
  const top5Ufs = [...porUf.entries()]
    .map(([nome, list]) => ({ nome, valor: sumBy(list, (c) => Number(c.valor_global || 0)), qtd: list.length }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5);
  const maxUf = top5Ufs[0]?.valor || 1;

  // ── HTML ────────────────────────────────────────────────────────────────
  wrap.innerHTML = `
    <div class="conc-result-header">
      <div>
        <div class="conc-result-nome">${escapeHtml(empresa.razao_social || empresa.cnpj || '-')}</div>
        ${empresa.nome_fantasia ? `<div class="conc-result-fantasia">${escapeHtml(empresa.nome_fantasia)}</div>` : ''}
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="concorrentes.novaConsulta">${ICONS.plus} Nova consulta</button>
    </div>

    <div class="kpi-grid kpi-grid-4" style="margin-top:16px; margin-bottom:0;">
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--blue">${ICONS.licitacoes}</div>
        <div class="kpi-value">${totalContratos}</div>
        <div class="kpi-label">Contratos no PNCP</div>
        <div class="kpi-foot">${contratos.length < totalContratos ? `${contratos.length} carregados` : 'todos carregados'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--indigo">${ICONS.empenhos}</div>
        <div class="kpi-value">${fmtShort(valorTotal)}</div>
        <div class="kpi-label">Valor total</div>
        <div class="kpi-foot">Contratos carregados</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--green">${ICONS.check}</div>
        <div class="kpi-value">${contratos.length ? fmtShort(ticketMedio) : '-'}</div>
        <div class="kpi-label">Ticket médio</div>
        <div class="kpi-foot">Por contrato</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--orange">${ICONS.agenda}</div>
        <div class="kpi-value">${ultimoContrato ? ultimoContrato.slice(0, 7).replace('-', '/') : '-'}</div>
        <div class="kpi-label">Último contrato</div>
        <div class="kpi-foot">${ultimoContrato ? formatDate(ultimoContrato) : 'Sem data'}</div>
      </div>
    </div>

    <div style="margin-top:18px;">${renderCertidoes(certidoes)}</div>

    ${contratos.length ? `
      <div class="grid-2" style="margin-top:18px;">
        <div class="card">
          <div class="dash-card-header">
            <div class="dash-card-title">Evolução por ano</div>
            <div class="dash-card-subtitle">Valor total dos contratos assinados</div>
          </div>
          <canvas id="chart-conc-ano" style="width:100%; height:200px;"></canvas>
        </div>
        <div class="card">
          <div class="dash-card-header">
            <div class="dash-card-title">Por modalidade</div>
            <div class="dash-card-subtitle">Quantidade de contratos · ${contratos.length} total</div>
          </div>
          <canvas id="chart-conc-modalidade" style="width:100%; height:160px;"></canvas>
          <div class="donut-legend">
            ${donutData.map((d) => `
              <span class="donut-legend-item">
                <span class="donut-legend-dot" style="background:${d.color}"></span>
                ${escapeHtml(d.label)} <strong>${d.value}</strong>
              </span>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="grid-2" style="margin-top:18px;">
        <div class="card">
          <div class="dash-card-header">
            <div class="dash-card-title">Top órgãos</div>
            <div class="dash-card-subtitle">Por valor total dos contratos</div>
          </div>
          <div class="rel-top5">
            ${top5Orgaos.map((o, i) => `
              <div class="rel-top5-row">
                <span class="rel-top5-rank">${i + 1}</span>
                <span class="rel-top5-label" title="${escapeHtml(o.nome)}">${escapeHtml(o.nome)}</span>
                <div class="rel-top5-bar-wrap"><div class="rel-top5-bar" style="width:${(o.valor / maxOrgao * 100).toFixed(1)}%"></div></div>
                <span class="rel-top5-value">${fmtShort(o.valor)}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="card">
          <div class="dash-card-header">
            <div class="dash-card-title">Top estados (UF)</div>
            <div class="dash-card-subtitle">Por valor total dos contratos</div>
          </div>
          <div class="rel-top5">
            ${top5Ufs.map((u, i) => `
              <div class="rel-top5-row">
                <span class="rel-top5-rank">${i + 1}</span>
                <span class="rel-top5-label">${escapeHtml(u.nome)} <span style="color:var(--gray-400); font-size:11px;">(${u.qtd} contratos)</span></span>
                <div class="rel-top5-bar-wrap"><div class="rel-top5-bar" style="width:${(u.valor / maxUf * 100).toFixed(1)}%; background:#7C3AED"></div></div>
                <span class="rel-top5-value">${fmtShort(u.valor)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    ` : ''}

    <div class="info-section" style="margin-top:18px;">
      <div class="info-section-title">Dados da empresa</div>
      <div class="info-grid">
        <div class="info-field"><label>CNPJ</label><div>${escapeHtml(empresa.cnpj || '-')}</div></div>
        <div class="info-field"><label>Situação</label><div>${badge(empresa.descricao_situacao_cadastral || '-', empresa.descricao_situacao_cadastral === 'ATIVA' ? 'success' : 'danger')}</div></div>
        <div class="info-field"><label>Porte</label><div>${escapeHtml(empresa.porte || '-')}</div></div>
        <div class="info-field"><label>Capital social</label><div>${formatCurrency(empresa.capital_social)}</div></div>
        <div class="info-field"><label>Natureza jurídica</label><div>${escapeHtml(empresa.natureza_juridica || '-')}</div></div>
        <div class="info-field"><label>Simples Nacional</label><div>${empresa.opcao_pelo_simples ? badge('Optante', 'success') : badge('Não optante', 'muted')}</div></div>
        <div class="info-field"><label>Início de atividade</label><div>${formatDate(empresa.data_inicio_atividade)}</div></div>
        <div class="info-field span-2"><label>Endereço</label><div>${escapeHtml([empresa.logradouro, empresa.numero, empresa.complemento, empresa.bairro, empresa.municipio, empresa.uf].filter(Boolean).join(', ') || '-')}</div></div>
        <div class="info-field span-2"><label>Atividade principal</label><div>${escapeHtml(empresa.cnae_fiscal_descricao || '-')}</div></div>
        ${empresa.ddd_telefone_1 ? `<div class="info-field"><label>Telefone</label><div>${escapeHtml(empresa.ddd_telefone_1)}</div></div>` : ''}
        ${empresa.email ? `<div class="info-field"><label>E-mail</label><div>${escapeHtml(empresa.email)}</div></div>` : ''}
      </div>
    </div>

    <div class="info-section">
      <div class="info-section-title">Quadro de sócios e administradores</div>
      ${empresa.qsa?.length ? `
        <div class="conc-qsa-list">
          ${empresa.qsa.map((s) => `
            <div class="conc-qsa-item">
              <div class="conc-qsa-nome">${escapeHtml(s.nome_socio || '-')}</div>
              <div class="conc-qsa-qual">${escapeHtml(s.qualificacao_socio || '-')}</div>
            </div>
          `).join('')}
        </div>
      ` : `<p style="color:var(--gray-500); font-size:13px; margin:0;">Nenhum sócio informado.</p>`}
    </div>

    <div class="card" style="margin-top:4px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
        <div>
          <div class="dash-card-title">Contratos/Empenhos encontrados no PNCP</div>
          <div class="dash-card-subtitle" style="margin-top:2px;">${contratos.length} de ${totalContratos} registros carregados · ordenado por data de assinatura</div>
        </div>
        ${contratos.length ? `<button type="button" class="btn btn-ghost btn-sm" data-action="concorrentes.exportarExcel">${ICONS.download} Excel</button>` : ''}
      </div>
      ${contratos.length ? `
        <div class="table-wrap" style="max-height:400px; overflow-y:auto;">
          <table class="data-table">
            <thead>
              <tr><th>Objeto</th><th>Órgão</th><th>UF</th><th>Modalidade</th><th>Assinatura</th><th>Valor</th><th></th></tr>
            </thead>
            <tbody>
              ${contratos.map((c) => `
                <tr>
                  <td>
                    <div style="font-weight:500;">${escapeHtml(c.title || '-')}</div>
                    <div style="font-size:11.5px; color:var(--gray-500); margin-top:2px;">${escapeHtml((c.description || '').slice(0, 80))}${(c.description || '').length > 80 ? '…' : ''}</div>
                  </td>
                  <td style="font-size:12.5px;">${escapeHtml(c.orgao_nome || '-')}</td>
                  <td style="font-size:12.5px; white-space:nowrap;">${escapeHtml(c.municipio_nome || '-')}/${escapeHtml(c.uf || '-')}</td>
                  <td style="font-size:12px;">${escapeHtml(c.modalidade_licitacao_nome || '-')}</td>
                  <td style="white-space:nowrap; font-size:12.5px;">${formatDate(c.data_assinatura)}</td>
                  <td style="white-space:nowrap; font-weight:600;">${formatCurrency(c.valor_global)}</td>
                  <td>${c.item_url ? `<a href="https://pncp.gov.br/app${escapeHtml(c.item_url)}" target="_blank" rel="noopener" class="link-btn">PNCP</a>` : ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `<div style="padding:10px 0;">${renderEmptyState('Nenhum contrato encontrado no PNCP para este CNPJ.')}</div>`}
    </div>
  `;

  if (contratos.length) {
    if (barAnoData.length) drawBarChart(byId('chart-conc-ano'), barAnoData, { color: '#2563EB', valueFormatter: (v) => fmtShort(v).replace('R$ ', '') });
    drawDonutChart(byId('chart-conc-modalidade'), donutData, { centerLabel: String(contratos.length) });
  }
}

function renderCertidoes(certidoes) {
  if (!certidoes.configured) {
    return `
      <div class="conc-certidoes-banner conc-certidoes-banner--info">
        ${ICONS.certidoes}
        <div>
          <strong>Certidões de sanção (CEIS/CNEP) não disponíveis</strong>
          <p>Configure uma chave gratuita em <a href="https://api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email" target="_blank" rel="noopener">api.portaldatransparencia.gov.br</a> e cole em <strong>Configurações → Integrações</strong> para ativar.</p>
        </div>
      </div>`;
  }
  if (certidoes.erro) {
    return `<div class="conc-certidoes-banner conc-certidoes-banner--warning">${ICONS.bell}<div><strong>Erro ao consultar certidões</strong><p>${escapeHtml(certidoes.erro)}</p></div></div>`;
  }
  const linhas = [...(certidoes.ceis || []).map((s) => ({ ...s, fonte: 'CEIS' })), ...(certidoes.cnep || []).map((s) => ({ ...s, fonte: 'CNEP' }))];
  if (!linhas.length) {
    return `
      <div class="conc-certidoes-banner conc-certidoes-banner--success">
        ${ICONS.check}
        <div><strong>Nada consta</strong><p>Nenhuma sanção encontrada no CEIS ou CNEP.</p></div>
      </div>`;
  }
  return `
    <div class="conc-certidoes-banner conc-certidoes-banner--danger">
      ${ICONS.certidoes}
      <div style="flex:1; min-width:0;">
        <strong>${badge(`${linhas.length} sanção(ões) encontrada(s)`, 'danger')}</strong>
        <div class="table-wrap" style="margin-top:10px;">
          <table class="data-table">
            <thead><tr><th>Fonte</th><th>Órgão sancionador</th><th>Tipo</th><th>Início</th><th>Fim</th></tr></thead>
            <tbody>
              ${linhas.map((s) => `
                <tr>
                  <td>${s.fonte}</td>
                  <td>${escapeHtml(s.orgaoSancionador?.nome || s.nomeOrgaoSancionador || '-')}</td>
                  <td>${escapeHtml(s.tipoSancao?.descricaoResumida || s.tipoSancao?.descricao || '-')}</td>
                  <td>${formatDate(s.dataInicioSancao)}</td>
                  <td>${formatDate(s.dataFimSancao)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function exportarExcel() {
  if (!window.XLSX) { showToast('Biblioteca de exportação Excel não carregada.', 'error'); return; }
  if (!ultimaAnalise?.contratos?.length) return;
  const rows = [
    ['Título', 'Descrição', 'Órgão', 'Cidade', 'UF', 'Modalidade', 'Data Assinatura', 'Valor', 'Link PNCP'],
    ...ultimaAnalise.contratos.map((c) => [
      c.title || '', c.description || '', c.orgao_nome || '', c.municipio_nome || '', c.uf || '',
      c.modalidade_licitacao_nome || '', formatDate(c.data_assinatura), Number(c.valor_global) || 0,
      c.item_url ? `https://pncp.gov.br/app${c.item_url}` : '',
    ]),
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Contratos PNCP');
  window.XLSX.writeFile(wb, `analise-concorrente-${ultimaAnalise.cnpj}.xlsx`);
}

export const actions = {
  ...crudMod.actions,
  'concorrentes.analisarBusca': () => analisarBusca(),
  'concorrentes.analisarLinha': (target) => analisarLinha(target),
  'concorrentes.exportarExcel': () => exportarExcel(),
  'concorrentes.limparAnalise': () => limparAnalise(),
  'concorrentes.novaConsulta': () => limparAnalise(),
};
