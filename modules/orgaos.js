import * as Service from '../supabase-service.js';
import { refreshLookups } from '../state.js';
import { buildCrudModule } from './_crud.js';
import { UFS } from '../constants.js';
import { byId } from '../helpers.js';
import { showToast } from '../ui.js';

function setupCepOrgao() {
  const cepEl = byId('f-cep');
  if (!cepEl) return;
  cepEl.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').replace(/(\d{5})(\d)/, '$1-$2').slice(0, 9);
  });
  cepEl.addEventListener('blur', async (e) => {
    const digits = e.target.value.replace(/\D/g, '');
    if (digits.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (data.erro) { showToast('CEP não encontrado.', 'error'); return; }
      if (byId('f-logradouro')) byId('f-logradouro').value = data.logradouro || '';
      if (byId('f-bairro'))     byId('f-bairro').value     = data.bairro || '';
      if (byId('f-cidade'))     byId('f-cidade').value     = data.localidade || '';
      if (byId('f-uf'))         byId('f-uf').value         = data.uf || '';
    } catch {
      showToast('Erro ao consultar CEP.', 'error');
    }
  });
}

const mod = buildCrudModule({
  actionPrefix: 'orgaos',
  service: Service.Orgaos,
  title: 'Órgãos',
  singular: 'Órgão',
  description: 'Órgãos públicos, prefeituras e autarquias com quem a empresa já disputou licitações.',
  modalSize: 'lg',
  gridCols: 3,
  allowView: true,
  afterOpen: setupCepOrgao,
  searchKeys: ['nome', 'cnpj', 'cidade'],
  columns: [
    { key: 'nome', label: 'Nome' },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'uf', label: 'UF' },
    { key: 'cidade', label: 'Cidade' },
  ],
  fields: [
    { key: 'nome', label: 'Nome do Órgão', required: true, span: 3 },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'uf', label: 'UF', type: 'select', options: UFS },
    { key: 'cep', label: 'CEP' },
    { key: 'cidade', label: 'Cidade' },
    { key: 'logradouro', label: 'Logradouro' },
    { key: 'numero', label: 'Número' },
    { key: 'bairro', label: 'Bairro' },
    { key: 'complemento', label: 'Complemento' },
    { key: 'responsavel_nome', label: 'Responsável (Nome)', span: 3 },
    { key: 'responsavel_cpf', label: 'Responsável (CPF)' },
    { key: 'responsavel_cargo', label: 'Cargo do Responsável' },
    { key: 'responsavel_email', label: 'E-mail do Responsável', span: 3 },
    { key: 'observacoes', label: 'Observações', type: 'textarea', span: 3 },
  ],
  afterChange: refreshLookups,
});

export const render = mod.render;
export const actions = mod.actions;
