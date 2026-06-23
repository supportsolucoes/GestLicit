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

export async function signUp(email, password, nome) {
  return handle(sb().auth.signUp({ email, password, options: { data: { nome } } }));
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
