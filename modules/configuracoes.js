import * as Service from '../supabase-service.js';
import { refreshLookups, currentUser, getState, canWrite, isAdmin } from '../state.js';
import { byId, escapeHtml, todayISO } from '../helpers.js';
import { showToast, confirmDialog, badge, renderEmptyState } from '../ui.js';
import { ICONS, UFS } from '../constants.js';

const EMPRESA_KEYS = ['razao_social', 'cnpj', 'ie', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep'];

function empresaVal(key) {
  return escapeHtml(getState().lookups.settings?.[`empresa_${key}`] || '');
}

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Configurações</h1>
        <p>Dados da empresa, integrações e dados de demonstração.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <strong>Minha Empresa</strong>
      <p style="color:var(--gray-500); font-size:13px; margin:4px 0 14px;">
        Dados do fornecedor que aparecem no corpo do Atestado de Capacidade Técnica gerado automaticamente pelo sistema.
      </p>
      <div class="form-grid cols-3">
        <div class="form-field span-2"><label>Razão Social *</label><input type="text" id="emp-razao_social" value="${empresaVal('razao_social')}" placeholder="Nome completo da empresa" /></div>
        <div class="form-field"><label>CNPJ</label><input type="text" id="emp-cnpj" value="${empresaVal('cnpj')}" placeholder="00.000.000/0000-00" /></div>
        <div class="form-field"><label>Inscrição Estadual</label><input type="text" id="emp-ie" value="${empresaVal('ie')}" placeholder="000.000.000.000" /></div>
        <div class="form-field span-2"><label>Logradouro</label><input type="text" id="emp-logradouro" value="${empresaVal('logradouro')}" placeholder="Rua, Avenida..." /></div>
        <div class="form-field"><label>Número</label><input type="text" id="emp-numero" value="${empresaVal('numero')}" /></div>
        <div class="form-field"><label>Complemento</label><input type="text" id="emp-complemento" value="${empresaVal('complemento')}" /></div>
        <div class="form-field"><label>Bairro</label><input type="text" id="emp-bairro" value="${empresaVal('bairro')}" /></div>
        <div class="form-field span-2"><label>Cidade</label><input type="text" id="emp-cidade" value="${empresaVal('cidade')}" /></div>
        <div class="form-field"><label>UF</label>
          <select id="emp-uf">
            <option value="">—</option>
            ${UFS.map((uf) => `<option value="${uf}" ${empresaVal('uf') === uf ? 'selected' : ''}>${uf}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>CEP</label><input type="text" id="emp-cep" value="${empresaVal('cep')}" placeholder="00000-000" /></div>
      </div>
      ${canWrite() ? `<div style="margin-top:14px;"><button type="button" class="btn btn-primary btn-sm" data-action="configuracoes.salvarEmpresa">Salvar dados da empresa</button></div>` : ''}
    </div>

    <div class="card" style="margin-bottom:16px;">
      <strong>Integrações</strong>
      <p style="color:var(--gray-500); font-size:13px; margin:4px 0 14px;">
        Chave da API do Portal da Transparência, usada na Análise de Concorrente para consultar CEIS/CNEP (empresas sancionadas).
        Cadastro gratuito em <a href="https://api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email" target="_blank" rel="noopener">api.portaldatransparencia.gov.br</a>.
      </p>
      <div class="form-grid cols-3">
        <div class="form-field span-2">
          <label>Chave da API (Portal da Transparência)</label>
          <input type="text" id="f-portal-transparencia-key" ${canWrite() ? '' : 'disabled'} value="${escapeHtml(getState().lookups.settings?.portal_transparencia_api_key || '')}" placeholder="Cole aqui a chave recebida por e-mail" />
        </div>
        ${canWrite() ? `
          <div class="form-field" style="justify-content:flex-end;">
            <button type="button" class="btn btn-primary" data-action="configuracoes.salvarChave" style="height:38px;">Salvar chave</button>
          </div>
        ` : ''}
      </div>
    </div>

    <div class="card" id="demo-card">
      <strong>Dados de demonstração</strong>
      <p style="color:var(--gray-500); font-size:13px; margin:4px 0 14px;">
        Cria uma licitação de exemplo completa (cadastro, itens, precificação, resultado, contrato, ata e empenho vinculados) para mostrar o sistema a outros usuários.
        Tudo fica marcado com "(EXEMPLO)" no nome e pode ser removido de uma vez quando não precisar mais.
      </p>
      <div id="demo-status"></div>
    </div>
  `;

  if (canWrite()) {
    byId('f-portal-transparencia-key').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') salvarChave();
    });
  }

  await renderDemoStatus();
}

async function salvarEmpresa() {
  const vals = {};
  for (const key of EMPRESA_KEYS) {
    vals[key] = byId(`emp-${key}`)?.value.trim() || null;
  }
  if (!vals.razao_social) {
    showToast('Informe a Razão Social da empresa.', 'error');
    return;
  }
  try {
    for (const [key, valor] of Object.entries(vals)) {
      await Service.upsertAppSetting(`empresa_${key}`, valor);
    }
    await refreshLookups();
    showToast('Dados da empresa salvos.', 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao salvar dados da empresa.', 'error');
  }
}

async function salvarChave() {
  const valor = byId('f-portal-transparencia-key').value.trim();
  try {
    await Service.upsertAppSetting('portal_transparencia_api_key', valor || null);
    await refreshLookups();
    showToast('Chave salva.', 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao salvar chave.', 'error');
  }
}

// ============================================================
// Dados de demonstração
// ============================================================
async function renderDemoStatus() {
  const wrap = byId('demo-status');
  let log;
  try {
    log = await Service.listDemoSeedLog();
  } catch (err) {
    wrap.innerHTML = `<p style="color:var(--danger); font-size:13px;">Não foi possível carregar o status dos dados de demonstração (${escapeHtml(err.message || String(err))}). Confirme que a migração "ALTERAÇÕES v1.7" do <code>supabase/schema.sql</code> foi aplicada no banco.</p>`;
    return;
  }
  if (!isAdmin()) {
    wrap.innerHTML = `<p style="color:var(--gray-500); font-size:13px;">Disponível apenas para administradores (a remoção depende de excluir registros que só administrador pode excluir).</p>`;
    return;
  }
  if (log.length) {
    wrap.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        ${badge(`${log.length} registro(s) de demonstração criado(s)`, 'info')}
        <button type="button" class="btn btn-danger btn-sm" data-action="configuracoes.removerDemo">${ICONS.trash} Remover dados de demonstração</button>
      </div>
    `;
  } else {
    wrap.innerHTML = `
      <button type="button" class="btn btn-primary btn-sm" data-action="configuracoes.criarDemo">${ICONS.plus} Criar exemplo completo</button>
    `;
  }
}

async function criarDemo() {
  const ok = await confirmDialog('Isso vai criar uma licitação de exemplo completa (com órgão, produto, contrato, ata e empenho vinculados). Continuar?');
  if (!ok) return;

  const wrap = byId('demo-status');
  wrap.innerHTML = renderEmptyState('Criando dados de demonstração...');

  try {
    const hoje = todayISO();
    const log = [];
    const registrar = async (tabela, registro) => {
      await Service.logDemoSeed(tabela, registro.id);
      log.push({ tabela, registro_id: registro.id });
      return registro;
    };

    const orgao = await registrar('orgaos', await Service.Orgaos.create({
      nome: 'Prefeitura Municipal de Exemplo', uf: 'ES', cidade: 'Exemplolândia',
      observacoes: 'Órgão fictício criado para demonstração do sistema.',
    }));

    const produto = await registrar('produtos', await Service.Produtos.create({
      nome: 'Resma de Papel A4 (Exemplo)', fabricante: 'Chamex', preco_custo: 15.0,
    }));

    const licitacao = await registrar('licitacoes', await Service.createLicitacao({
      numero_pregao: 'PE 999/2026 (EXEMPLO)', numero_processo: '2026.999.0001',
      orgao_id: orgao.id, uf: 'ES', modalidade: 'Pregão Eletrônico',
      registro_preco: false, valor_total_estimado: 11000, modo_disputa: 'Aberto-Fechado',
      data_sessao: hoje,
      objeto: 'Aquisição de resmas de papel A4 — licitação de demonstração.',
      observacoes: 'Registro de demonstração gerado automaticamente. Use "Remover dados de demonstração" em Configurações para excluir.',
    }));

    await Service.createLicitacaoItem({
      licitacao_id: licitacao.id, item_numero: 1, produto_id: produto.id,
      produto_descricao: produto.nome, quantidade: 500, marca_fabricante: 'Chamex',
      valor_referencia: 25.0, custo_unitario: 15.0, margem_percentual: 20,
      valor_minimo: 18.0, valor_inicial: 24.0, valor_final: 22.0, valor_arrematado: 22.0,
      status: 'Ganhou',
    });

    const tag = await registrar('tags', await Service.Tags.create({ nome: 'Exemplo', cor: '#64748B' }));
    await Service.assignTag(licitacao.id, tag.id);

    await registrar('agenda_eventos', await Service.AgendaEventos.create({
      titulo: 'Lembrete de exemplo', tipo: 'Outro', data: hoje, lembrete: true,
      observacoes: 'Lembrete de demonstração.', referencia_tipo: 'licitacao', referencia_id: licitacao.id,
      criado_por: currentUser()?.id || null,
    }));

    const contrato = await registrar('contratos', await Service.createContrato({
      numero_contrato: 'CT 999/2026 (EXEMPLO)', licitacao_id: licitacao.id, orgao_id: orgao.id,
      data_contrato: hoje, data_assinatura: hoje, valor_contrato: 11000,
      vigencia_inicio: hoje, viabilidade: 'Viável',
      prazo_entrega: '15 dias', prazo_entrega_uteis: true, prazo_pagamento: '30 dias',
      telefone_contato: '(27) 99999-0000', email_contato: 'contato@exemplo.gov.br',
      situacao: 'Vigente', observacoes: 'Registro de demonstração.',
    }));

    await Service.createContratoItem({
      contrato_id: contrato.id, item_numero: 1, produto_id: produto.id, produto_descricao: produto.nome,
      marca_fabricante: 'Chamex', unidade: '1 UN', quantidade_total: 500, valor_unitario: 22.0,
    });

    const ata = await registrar('atas', await Service.createAta({
      numero_ata: 'ATA 999/2026 (EXEMPLO)', tipo: 'ATA', licitacao_id: licitacao.id, orgao_id: orgao.id,
      data_assinatura: hoje, vigencia_inicio: hoje, valor_total: 11000,
      situacao: 'Vigente', observacoes: 'Registro de demonstração.',
    }));

    await Service.createAtaItem({
      ata_id: ata.id, produto_id: produto.id, produto_descricao: produto.nome,
      quantidade_total: 500, valor_unitario: 22.0,
    });

    const empenho = await registrar('empenhos', await Service.createEmpenho({
      numero_empenho: '2026NE999000 (EXEMPLO)', ata_id: ata.id, orgao_id: orgao.id,
      data_empenho: hoje, valor_empenhado: 4400, situacao: 'Vigente',
      observacoes: 'Registro de demonstração.',
    }));

    await Service.createEmpenhoItem({
      empenho_id: empenho.id, item_numero: 1, produto_id: produto.id, produto_descricao: produto.nome,
      quantidade_empenhada: 200, valor_unitario: 22.0,
    });

    await refreshLookups();
    showToast('Dados de demonstração criados com sucesso.', 'success');
    await renderDemoStatus();
  } catch (err) {
    showToast(err.message || 'Erro ao criar dados de demonstração.', 'error');
    await renderDemoStatus();
  }
}

async function removerDemo() {
  const ok = await confirmDialog('Remover todos os dados de demonstração criados? Essa ação não pode ser desfeita.');
  if (!ok) return;

  const wrap = byId('demo-status');
  wrap.innerHTML = renderEmptyState('Removendo dados de demonstração...');

  try {
    const log = await Service.listDemoSeedLog();
    const idsPorTabela = (tabela) => log.filter((l) => l.tabela === tabela).map((l) => l.registro_id);

    const removedores = {
      empenhos: Service.deleteEmpenho,
      atas: Service.deleteAta,
      contratos: Service.deleteContrato,
      agenda_eventos: (id) => Service.AgendaEventos.remove(id),
      licitacoes: Service.deleteLicitacao,
      produtos: (id) => Service.Produtos.remove(id),
      orgaos: (id) => Service.Orgaos.remove(id),
      tags: (id) => Service.Tags.remove(id),
    };

    for (const tabela of ['empenhos', 'atas', 'contratos', 'agenda_eventos', 'licitacoes', 'produtos', 'orgaos', 'tags']) {
      for (const id of idsPorTabela(tabela)) {
        try {
          await removedores[tabela](id);
        } catch (err) {
          console.warn(`Falha ao remover ${tabela}#${id}`, err);
        }
      }
    }

    await Service.clearDemoSeedLog();
    await refreshLookups();
    showToast('Dados de demonstração removidos.', 'success');
    await renderDemoStatus();
  } catch (err) {
    showToast(err.message || 'Erro ao remover dados de demonstração.', 'error');
    await renderDemoStatus();
  }
}

export const actions = {
  'configuracoes.salvarEmpresa': () => salvarEmpresa(),
  'configuracoes.salvarChave': () => salvarChave(),
  'configuracoes.criarDemo': () => criarDemo(),
  'configuracoes.removerDemo': () => removerDemo(),
};
