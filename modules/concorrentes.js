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

export async function render(container) {
  await crudMod.render(container);

  const box = document.createElement('div');
  box.className = 'card';
  box.id = 'analise-cnpj-box';
  box.style.marginBottom = '16px';
  box.innerHTML = `
    <div>
      <strong>Análise de Concorrente</strong>
      <p style="color:var(--gray-500); font-size:13px; margin:4px 0 12px;">
        Consulte dados públicos (Receita Federal e Portal Nacional de Contratações Públicas) de qualquer CNPJ. Nada é armazenado no sistema.
      </p>
    </div>
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <input type="text" id="analise-cnpj-input" placeholder="00.000.000/0000-00" style="flex:1; min-width:220px; max-width:320px; border:1px solid var(--gray-200); border-radius:8px; padding:9px 11px;" />
      <button class="btn btn-primary" data-action="concorrentes.analisarBusca">${ICONS.search} Analisar</button>
    </div>
    <div id="analise-resultado" style="margin-top:18px;"></div>
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
  analisarCnpj(cnpj);
}

async function analisarCnpj(cnpjDigits) {
  if (cnpjDigits.length !== 14) {
    showToast('Informe um CNPJ válido (14 dígitos).', 'error');
    return;
  }
  const wrap = byId('analise-resultado');
  wrap.innerHTML = renderEmptyState('Consultando fontes públicas...');

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
  }
}

function renderResultado() {
  const wrap = byId('analise-resultado');
  const { empresa, contratos, totalContratos, certidoes } = ultimaAnalise;

  if (empresa.erro) {
    wrap.innerHTML = renderEmptyState(`Não foi possível consultar os dados da empresa: ${escapeHtml(empresa.erro)}`);
    return;
  }

  const valorTotal = sumBy(contratos, (c) => c.valor_global);
  const porModalidade = groupBy(contratos, (c) => c.modalidade_licitacao_nome || 'Não informada');
  const porUf = groupBy(contratos, (c) => c.uf || '-');
  const donutData = [...porModalidade.entries()].map(([label, list], idx) => ({
    label, value: list.length, color: ['#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2'][idx % 6],
  })).sort((a, b) => b.value - a.value).slice(0, 6);
  const barUfData = [...porUf.entries()]
    .map(([label, list]) => ({ label, value: sumBy(list, (c) => c.valor_global) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  wrap.innerHTML = `
    <div class="form-section-title">Dados da empresa</div>
    <div class="form-grid cols-3">
      <div class="form-field"><label>CNPJ</label><div>${escapeHtml(empresa.cnpj || '-')}</div></div>
      <div class="form-field"><label>Razão social</label><div>${escapeHtml(empresa.razao_social || '-')}</div></div>
      <div class="form-field"><label>Nome fantasia</label><div>${escapeHtml(empresa.nome_fantasia || '-')}</div></div>
      <div class="form-field"><label>Situação</label><div>${badge(empresa.descricao_situacao_cadastral || '-', empresa.descricao_situacao_cadastral === 'ATIVA' ? 'success' : 'danger')}</div></div>
      <div class="form-field"><label>Porte</label><div>${escapeHtml(empresa.porte || '-')}</div></div>
      <div class="form-field"><label>Natureza jurídica</label><div>${escapeHtml(empresa.natureza_juridica || '-')}</div></div>
      <div class="form-field"><label>Capital social</label><div>${formatCurrency(empresa.capital_social)}</div></div>
      <div class="form-field"><label>Início de atividade</label><div>${formatDate(empresa.data_inicio_atividade)}</div></div>
      <div class="form-field"><label>Simples Nacional</label><div>${empresa.opcao_pelo_simples ? badge('Optante', 'success') : badge('Não optante', 'muted')}</div></div>
    </div>

    <div class="form-section-title">Endereço e contato</div>
    <div class="form-grid cols-3">
      <div class="form-field span-2"><label>Logradouro</label><div>${escapeHtml(empresa.logradouro || '-')}, ${escapeHtml(empresa.numero || '-')} ${escapeHtml(empresa.complemento || '')}</div></div>
      <div class="form-field"><label>Bairro</label><div>${escapeHtml(empresa.bairro || '-')}</div></div>
      <div class="form-field"><label>Cidade/UF</label><div>${escapeHtml(empresa.municipio || '-')}/${escapeHtml(empresa.uf || '-')}</div></div>
      <div class="form-field"><label>Telefone</label><div>${escapeHtml(empresa.ddd_telefone_1 || '-')}</div></div>
      <div class="form-field"><label>Email</label><div>${escapeHtml(empresa.email || '-')}</div></div>
    </div>

    <div class="form-section-title">Atividade econômica</div>
    <p style="margin:0 0 8px;"><strong>${escapeHtml(empresa.cnae_fiscal_descricao || '-')}</strong></p>
    ${empresa.cnaes_secundarios?.length ? `<p style="color:var(--gray-500); font-size:12.5px;">+ ${empresa.cnaes_secundarios.length} atividade(s) secundária(s)</p>` : ''}

    <div class="form-section-title">Quadro de sócios e administradores</div>
    ${empresa.qsa?.length ? empresa.qsa.map((s) => `
      <div class="card" style="background:var(--blue-light); box-shadow:none; border:none; margin-bottom:8px; padding:12px 16px;">
        <strong>${escapeHtml(s.nome_socio || '-')}</strong> — ${escapeHtml(s.qualificacao_socio || '-')}
      </div>
    `).join('') : renderEmptyState('Nenhum sócio informado.')}

    <div class="form-section-title">Certidões (CEIS/CNEP — Portal da Transparência)</div>
    ${renderCertidoes(certidoes)}

    <div class="form-section-title">Estatísticas (Portal Nacional de Contratações Públicas)</div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Contratos encontrados</div><div class="stat-value">${totalContratos}</div></div>
      <div class="stat-card"><div class="stat-label">Valor total (carregado)</div><div class="stat-value">${formatCurrency(valorTotal)}</div></div>
      <div class="stat-card"><div class="stat-label">Carregados nesta consulta</div><div class="stat-value">${contratos.length}</div></div>
    </div>
    ${contratos.length ? `
      <div class="form-grid cols-2" style="margin-bottom:18px;">
        <div><p style="font-size:12.5px; color:var(--gray-500); margin-bottom:6px;">Por modalidade (quantidade)</p><canvas id="chart-concorrente-modalidade" style="width:100%; height:200px;"></canvas></div>
        <div><p style="font-size:12.5px; color:var(--gray-500); margin-bottom:6px;">Por UF (valor)</p><canvas id="chart-concorrente-uf" style="width:100%; height:200px;"></canvas></div>
      </div>
    ` : ''}

    <div class="card items-table-card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <strong>Contratos/Empenhos encontrados no PNCP</strong>
        ${contratos.length ? `<button type="button" class="btn btn-ghost btn-sm" data-action="concorrentes.exportarExcel">${ICONS.download} Exportar Excel</button>` : ''}
      </div>
      ${contratos.length ? `
        <div class="table-wrap" style="max-height:420px; overflow-y:auto;">
          <table class="data-table">
            <thead><tr><th>Título</th><th>Órgão</th><th>Cidade/UF</th><th>Modalidade</th><th>Assinatura</th><th>Valor</th></tr></thead>
            <tbody>
              ${contratos.map((c) => `
                <tr>
                  <td><strong>${escapeHtml(c.title || '-')}</strong><br/><span style="font-size:11.5px; color:var(--gray-500);">${escapeHtml((c.description || '').slice(0, 90))}${(c.description || '').length > 90 ? '…' : ''}</span></td>
                  <td>${escapeHtml(c.orgao_nome || '-')}</td>
                  <td>${escapeHtml(c.municipio_nome || '-')}/${escapeHtml(c.uf || '-')}</td>
                  <td>${escapeHtml(c.modalidade_licitacao_nome || '-')}</td>
                  <td>${formatDate(c.data_assinatura)}</td>
                  <td>${formatCurrency(c.valor_global)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : renderEmptyState('Nenhum contrato encontrado no PNCP para este CNPJ.')}
    </div>
  `;

  if (contratos.length) {
    drawDonutChart(byId('chart-concorrente-modalidade'), donutData, { centerLabel: String(contratos.length) });
    drawBarChart(byId('chart-concorrente-uf'), barUfData, { valueFormatter: (v) => formatCurrency(v).replace('R$', '').trim() });
  }
}

function renderCertidoes(certidoes) {
  if (!certidoes.configured) {
    return `<p style="color:var(--gray-500); font-size:13px;">Chave da API do Portal da Transparência não configurada. Cadastre uma chave gratuita em
      <a href="https://api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email" target="_blank" rel="noopener">api.portaldatransparencia.gov.br</a>
      e cole em <code>config.js</code> (<code>portalTransparenciaApiKey</code>) para ativar esta seção.</p>`;
  }
  if (certidoes.erro) {
    return `<p style="color:var(--danger); font-size:13px;">Erro ao consultar certidões: ${escapeHtml(certidoes.erro)}</p>`;
  }
  const semNada = !certidoes.ceis.length && !certidoes.cnep.length;
  if (semNada) {
    return `<div class="card" style="background:var(--success-bg); box-shadow:none; border:none; padding:14px 16px;">${badge('Nada consta', 'success')} Nenhuma sanção encontrada no CEIS ou CNEP.</div>`;
  }
  const linhas = [...certidoes.ceis.map((s) => ({ ...s, fonte: 'CEIS' })), ...certidoes.cnep.map((s) => ({ ...s, fonte: 'CNEP' }))];
  return `
    <div class="card" style="background:var(--danger-bg); box-shadow:none; border:none; padding:14px 16px;">
      ${badge(`${linhas.length} sanção(ões) encontrada(s)`, 'danger')}
      <table class="data-table" style="margin-top:10px;">
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
  `;
}

function exportarExcel() {
  if (!window.XLSX) {
    showToast('Biblioteca de exportação Excel não carregada.', 'error');
    return;
  }
  if (!ultimaAnalise?.contratos?.length) return;
  const rows = [
    ['Título', 'Descrição', 'Órgão', 'Cidade', 'UF', 'Modalidade', 'Data Assinatura', 'Valor'],
    ...ultimaAnalise.contratos.map((c) => [
      c.title || '', c.description || '', c.orgao_nome || '', c.municipio_nome || '', c.uf || '',
      c.modalidade_licitacao_nome || '', formatDate(c.data_assinatura), Number(c.valor_global) || 0,
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
};
