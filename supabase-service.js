import { getSupabaseClient } from './supabase-client.js';

const sb = () => getSupabaseClient();

async function handle(promiseLike) {
  const { data, error } = await promiseLike;
  if (error) throw error;
  return data;
}

// ============================================================
// Auth
// ============================================================
export async function signIn(email, password) {
  return handle(sb().auth.signInWithPassword({ email, password }));
}

export async function signOut() {
  await sb().auth.signOut();
}

export async function getSession() {
  const { data } = await sb().auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  return sb().auth.onAuthStateChange((_event, session) => cb(session));
}

export async function getProfile(userId) {
  return handle(sb().from('app_profiles').select('*').eq('id', userId).single());
}

export async function adminCreateUser(payload) {
  const { data, error } = await sb().functions.invoke('admin-create-user', { body: payload });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json();
      if (body?.error) message = body.error;
    } catch (_err) {
      // mantém a mensagem genérica do erro de rede/HTTP
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ============================================================
// CRUD genérico
// ============================================================
function makeCrud(table, orderCol = 'id', ascending = true) {
  return {
    list: () => handle(sb().from(table).select('*').order(orderCol, { ascending })),
    get: (id) => handle(sb().from(table).select('*').eq('id', id).single()),
    create: (payload) => handle(sb().from(table).insert(payload).select().single()),
    update: (id, payload) => handle(sb().from(table).update(payload).eq('id', id).select().single()),
    remove: (id) => handle(sb().from(table).delete().eq('id', id)),
  };
}

export const Orgaos = makeCrud('orgaos', 'nome');
export const Concorrentes = makeCrud('concorrentes', 'nome');
export const Parceiros = makeCrud('parceiros', 'razao_social');
export const Produtos = makeCrud('produtos', 'nome');
export const Certidoes = makeCrud('certidoes', 'data_validade');
export const AgendaEventos = makeCrud('agenda_eventos', 'data');
export const Profiles = makeCrud('app_profiles', 'nome');
export const Tags = makeCrud('tags', 'nome');

// ============================================================
// Notificações lidas (dispensar alertas do sininho, por usuário)
// ============================================================
export async function listNotificacoesLidas() {
  return handle(sb().from('notificacoes_lidas').select('*'));
}

export async function marcarNotificacaoLida(userId, { tipo, registroId, dataRef }) {
  return handle(
    sb()
      .from('notificacoes_lidas')
      .upsert(
        { user_id: userId, tipo, registro_id: registroId, data_ref: dataRef || null },
        { onConflict: 'user_id,tipo,registro_id,data_ref' }
      )
  );
}

// ============================================================
// Tags de Licitação (associação N:N)
// ============================================================
export async function listLicitacaoTags() {
  return handle(sb().from('licitacao_tags').select('licitacao_id, tag:tags(id,nome,cor)'));
}

export async function assignTag(licitacaoId, tagId) {
  return handle(sb().from('licitacao_tags').insert({ licitacao_id: licitacaoId, tag_id: tagId }));
}

export async function unassignTag(licitacaoId, tagId) {
  return handle(sb().from('licitacao_tags').delete().eq('licitacao_id', licitacaoId).eq('tag_id', tagId));
}

// ============================================================
// Licitações
// ============================================================
const LICITACAO_SELECT = '*, orgao:orgaos(id,nome,uf)';

export async function listLicitacoes() {
  return handle(sb().from('licitacoes').select(LICITACAO_SELECT).order('data_sessao', { ascending: false }));
}

export async function getLicitacao(id) {
  return handle(sb().from('licitacoes').select(LICITACAO_SELECT).eq('id', id).single());
}

export async function createLicitacao(payload) {
  return handle(sb().from('licitacoes').insert(payload).select(LICITACAO_SELECT).single());
}

export async function updateLicitacao(id, payload) {
  return handle(sb().from('licitacoes').update(payload).eq('id', id).select(LICITACAO_SELECT).single());
}

export async function deleteLicitacao(id) {
  return handle(sb().from('licitacoes').delete().eq('id', id));
}

const LICITACAO_ITEM_SELECT = '*, produto:produtos(id,nome), vencedor:concorrentes(id,nome), parceiro:parceiros(id,razao_social)';

export async function listLicitacaoItens(licitacaoId) {
  return handle(sb().from('licitacao_itens').select(LICITACAO_ITEM_SELECT).eq('licitacao_id', licitacaoId).order('item_numero'));
}

export async function listAllLicitacaoItens() {
  return handle(sb().from('licitacao_itens').select('*, licitacao:licitacoes(id,numero_pregao,numero_processo,data_sessao,orgao_id)'));
}

export async function createLicitacaoItem(payload) {
  return handle(sb().from('licitacao_itens').insert(payload).select(LICITACAO_ITEM_SELECT).single());
}

export async function updateLicitacaoItem(id, payload) {
  return handle(sb().from('licitacao_itens').update(payload).eq('id', id).select(LICITACAO_ITEM_SELECT).single());
}

export async function deleteLicitacaoItem(id) {
  return handle(sb().from('licitacao_itens').delete().eq('id', id));
}

// ============================================================
// Atas e Empenhos
// ============================================================
const ATA_SELECT = '*, orgao:orgaos(id,nome), licitacao:licitacoes(id,numero_pregao)';

export async function listAtas() {
  return handle(sb().from('atas').select(ATA_SELECT).order('vigencia_fim', { ascending: true }));
}

export async function getAta(id) {
  return handle(sb().from('atas').select(ATA_SELECT).eq('id', id).single());
}

export async function createAta(payload) {
  return handle(sb().from('atas').insert(payload).select(ATA_SELECT).single());
}

export async function updateAta(id, payload) {
  return handle(sb().from('atas').update(payload).eq('id', id).select(ATA_SELECT).single());
}

export async function deleteAta(id) {
  return handle(sb().from('atas').delete().eq('id', id));
}

export async function listAtaItens(ataId) {
  return handle(sb().from('ata_itens').select('*, produto:produtos(id,nome)').eq('ata_id', ataId).order('id'));
}

export async function listAllAtaItens() {
  return handle(sb().from('ata_itens').select('*, ata:atas(id,numero_ata,situacao,vigencia_fim,orgao_id)'));
}

export async function createAtaItem(payload) {
  return handle(sb().from('ata_itens').insert(payload).select('*, produto:produtos(id,nome)').single());
}

export async function updateAtaItem(id, payload) {
  return handle(sb().from('ata_itens').update(payload).eq('id', id).select('*, produto:produtos(id,nome)').single());
}

export async function deleteAtaItem(id) {
  return handle(sb().from('ata_itens').delete().eq('id', id));
}

export async function listConsumosByItens(itemIds) {
  if (!itemIds || !itemIds.length) return [];
  return handle(sb().from('ata_consumos').select('*').in('ata_item_id', itemIds).order('data_compra'));
}

export async function listAllConsumos() {
  return handle(sb().from('ata_consumos').select('*'));
}

export async function addConsumo(payload) {
  return handle(sb().from('ata_consumos').insert(payload).select().single());
}

export async function deleteConsumo(id) {
  return handle(sb().from('ata_consumos').delete().eq('id', id));
}

// ============================================================
// Contratos
// ============================================================
const CONTRATO_SELECT = '*, orgao:orgaos(id,nome), licitacao:licitacoes(id,numero_pregao,numero_processo)';

export async function listContratos() {
  return handle(sb().from('contratos').select(CONTRATO_SELECT).order('vigencia_fim', { ascending: true }));
}

export async function getContrato(id) {
  return handle(sb().from('contratos').select(CONTRATO_SELECT).eq('id', id).single());
}

export async function createContrato(payload) {
  return handle(sb().from('contratos').insert(payload).select(CONTRATO_SELECT).single());
}

export async function updateContrato(id, payload) {
  return handle(sb().from('contratos').update(payload).eq('id', id).select(CONTRATO_SELECT).single());
}

export async function deleteContrato(id) {
  return handle(sb().from('contratos').delete().eq('id', id));
}

const CONTRATO_ITEM_SELECT = '*, produto:produtos(id,nome,fabricante,preco_custo)';

export async function listContratoItens(contratoId) {
  return handle(sb().from('contrato_itens').select(CONTRATO_ITEM_SELECT).eq('contrato_id', contratoId).order('item_numero'));
}

export async function listAllContratoItens() {
  return handle(sb().from('contrato_itens').select('*'));
}

export async function createContratoItem(payload) {
  return handle(sb().from('contrato_itens').insert(payload).select(CONTRATO_ITEM_SELECT).single());
}

export async function updateContratoItem(id, payload) {
  return handle(sb().from('contrato_itens').update(payload).eq('id', id).select(CONTRATO_ITEM_SELECT).single());
}

export async function deleteContratoItem(id) {
  return handle(sb().from('contrato_itens').delete().eq('id', id));
}

// ============================================================
// Empenhos
// ============================================================
const EMPENHO_SELECT = '*, orgao:orgaos(id,nome), ata:atas(id,numero_ata), contrato:contratos(id,numero_contrato)';

export async function listEmpenhos() {
  return handle(sb().from('empenhos').select(EMPENHO_SELECT).order('data_empenho', { ascending: false }));
}

export async function getEmpenho(id) {
  return handle(sb().from('empenhos').select(EMPENHO_SELECT).eq('id', id).single());
}

export async function createEmpenho(payload) {
  return handle(sb().from('empenhos').insert(payload).select(EMPENHO_SELECT).single());
}

export async function updateEmpenho(id, payload) {
  return handle(sb().from('empenhos').update(payload).eq('id', id).select(EMPENHO_SELECT).single());
}

export async function deleteEmpenho(id) {
  return handle(sb().from('empenhos').delete().eq('id', id));
}

const EMPENHO_ITEM_SELECT = '*, produto:produtos(id,nome)';

export async function listEmpenhoItens(empenhoId) {
  return handle(sb().from('empenho_itens').select(EMPENHO_ITEM_SELECT).eq('empenho_id', empenhoId).order('item_numero'));
}

export async function listAllEmpenhoItens() {
  return handle(sb().from('empenho_itens').select('*, empenho:empenhos(id,numero_empenho,ata_id,contrato_id,data_empenho,situacao)'));
}

export async function createEmpenhoItem(payload) {
  return handle(sb().from('empenho_itens').insert(payload).select(EMPENHO_ITEM_SELECT).single());
}

export async function updateEmpenhoItem(id, payload) {
  return handle(sb().from('empenho_itens').update(payload).eq('id', id).select(EMPENHO_ITEM_SELECT).single());
}

export async function deleteEmpenhoItem(id) {
  return handle(sb().from('empenho_itens').delete().eq('id', id));
}

export async function listEntregasByItens(itemIds) {
  if (!itemIds || !itemIds.length) return [];
  return handle(sb().from('empenho_entregas').select('*').in('empenho_item_id', itemIds).order('data_entrega'));
}

export async function listAllEntregas() {
  return handle(sb().from('empenho_entregas').select('*'));
}

export async function addEntrega(payload) {
  return handle(sb().from('empenho_entregas').insert(payload).select().single());
}

export async function deleteEntrega(id) {
  return handle(sb().from('empenho_entregas').delete().eq('id', id));
}

export async function listAllEntregasComItem() {
  return handle(sb().from('empenho_entregas').select('*, item:empenho_itens(id,empenho_id,produto_descricao,valor_unitario)'));
}

export async function marcarEntregasFaturamento(entregaIds, faturamentoId) {
  if (!entregaIds || !entregaIds.length) return;
  return handle(sb().from('empenho_entregas').update({ faturamento_id: faturamentoId }).in('id', entregaIds));
}

// ============================================================
// Faturamento e Recebimentos
// ============================================================
const FATURAMENTO_SELECT = '*, empenho:empenhos(id,numero_empenho,orgao:orgaos(id,nome))';

export async function listFaturamentos() {
  return handle(sb().from('faturamentos').select(FATURAMENTO_SELECT).order('data_emissao', { ascending: false }));
}

export async function getFaturamento(id) {
  return handle(sb().from('faturamentos').select(FATURAMENTO_SELECT).eq('id', id).single());
}

export async function createFaturamento(payload) {
  return handle(sb().from('faturamentos').insert(payload).select(FATURAMENTO_SELECT).single());
}

export async function updateFaturamento(id, payload) {
  return handle(sb().from('faturamentos').update(payload).eq('id', id).select(FATURAMENTO_SELECT).single());
}

export async function deleteFaturamento(id) {
  return handle(sb().from('faturamentos').delete().eq('id', id));
}

export async function listAllRecebimentos() {
  return handle(sb().from('faturamento_recebimentos').select('*'));
}

export async function listRecebimentos(faturamentoId) {
  return handle(sb().from('faturamento_recebimentos').select('*').eq('faturamento_id', faturamentoId).order('data_recebimento'));
}

export async function addRecebimento(payload) {
  return handle(sb().from('faturamento_recebimentos').insert(payload).select().single());
}

export async function deleteRecebimento(id) {
  return handle(sb().from('faturamento_recebimentos').delete().eq('id', id));
}

// ============================================================
// Configurações: app_settings e log de dados de demonstração
// ============================================================
export async function listAppSettings() {
  return handle(sb().from('app_settings').select('*'));
}

export async function upsertAppSetting(chave, valor) {
  return handle(sb().from('app_settings').upsert({ chave, valor }).select().single());
}

export async function logDemoSeed(tabela, registroId) {
  return handle(sb().from('demo_seed_log').insert({ tabela, registro_id: registroId }));
}

export async function listDemoSeedLog() {
  return handle(sb().from('demo_seed_log').select('*').order('created_at'));
}

export async function clearDemoSeedLog() {
  return handle(sb().from('demo_seed_log').delete().neq('id', 0));
}

// ============================================================
// Documentos (Supabase Storage)
// ============================================================
const DOCUMENTOS_BUCKET = 'documentos';

export async function uploadDocumento(file, { categoria, referenciaTipo, referenciaId, uploadedBy }) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${categoria}/${Date.now()}_${safeName}`;
  const { error: uploadError } = await sb().storage.from(DOCUMENTOS_BUCKET).upload(path, file);
  if (uploadError) throw uploadError;
  return handle(
    sb()
      .from('documentos')
      .insert({
        categoria,
        referencia_tipo: referenciaTipo || null,
        referencia_id: referenciaId || null,
        nome_arquivo: file.name,
        arquivo_url: path,
        uploaded_by: uploadedBy || null,
      })
      .select()
      .single()
  );
}

export async function listDocumentos() {
  return handle(sb().from('documentos').select('*').order('created_at', { ascending: false }));
}

export async function deleteDocumento(doc) {
  await sb().storage.from(DOCUMENTOS_BUCKET).remove([doc.arquivo_url]);
  return handle(sb().from('documentos').delete().eq('id', doc.id));
}

export async function getSignedUrl(path) {
  const { data, error } = await sb().storage.from(DOCUMENTOS_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function uploadCertidaoArquivo(file, certidaoId) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `Certidão/${Date.now()}_${safeName}`;
  const { error } = await sb().storage.from(DOCUMENTOS_BUCKET).upload(path, file);
  if (error) throw error;
  return path;
}

export async function uploadContratoArquivo(file, contratoId) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `Contrato/${Date.now()}_${safeName}`;
  const { error } = await sb().storage.from(DOCUMENTOS_BUCKET).upload(path, file);
  if (error) throw error;
  return path;
}

export async function uploadEmpenhoArquivo(file, empenhoId) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `Empenho/${Date.now()}_${safeName}`;
  const { error } = await sb().storage.from(DOCUMENTOS_BUCKET).upload(path, file);
  if (error) throw error;
  return path;
}

export async function uploadFaturamentoArquivo(file, faturamentoId) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `Faturamento/${Date.now()}_${safeName}`;
  const { error } = await sb().storage.from(DOCUMENTOS_BUCKET).upload(path, file);
  if (error) throw error;
  return path;
}
