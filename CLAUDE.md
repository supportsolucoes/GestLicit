# CLAUDE.md

Guia para trabalhar no código do **GestLicit** — sistema interno da Humana Alimentar para controle do ciclo licitatório do ponto de vista de **fornecedora** (não do órgão público).

## Comandos

```bash
# Servir localmente (ES Modules exigem servidor HTTP, não funciona abrindo o index.html direto)
python3 -m http.server 4173
# ou
npx serve .
# acesse http://localhost:4173
```

Sem bundler nem transpilador — qualquer mudança em `.js`/`.html`/`.css` é refletida ao recarregar o browser.

## Configuração do Supabase (uma vez)

1. Crie um projeto em supabase.com.
2. No SQL Editor, execute todo o conteúdo de `supabase/schema.sql` (cria tabelas, RLS, bucket de Storage `documentos` e suas policies).
3. Em **Project Settings → API**, copie a `URL` e a `anon key` para `config.js`.
4. Crie o primeiro usuário pela própria tela de login do app ("Criar conta"). Ele nasce com perfil `consulta`.
5. No SQL Editor, promova esse usuário a administrador:
   ```sql
   select public.promover_administrador('UUID-DO-USUARIO');
   ```
   O UUID é visto em **Authentication → Users**. A partir daí, esse usuário pode promover os demais pela tela **Configurações** do app.

## Arquitetura

### Stack
- **Frontend puro**: HTML + CSS + ES Modules nativos (sem bundler, sem framework)
- **Backend**: Supabase (Auth + Postgres relacional + Storage)
- **Bibliotecas via CDN**: `@supabase/supabase-js`, `xlsx` (SheetJS, exportação Excel), `jspdf` (exportação PDF)
- **Deploy**: GitHub Pages

### Banco de dados
Schema 100% relacional (sem JSONB de estado, diferente do projeto Fluxo) — ver `supabase/schema.sql`. Tabelas centrais:
- `licitacoes` + `licitacao_itens` — editais disputados e seus itens (status Ganhou/Declinou/Desclassificado/Fracassado/Revogado)
- `atas` + `ata_itens` + `ata_consumos` — atas/empenhos ganhos, itens com saldo, e o histórico de compras (substitui as colunas fixas "1ª a 15ª compra" da planilha antiga por uma tabela de movimentos sem limite)
- `orgaos`, `concorrentes`, `parceiros`, `produtos` — cadastros de apoio (lookups)
- `certidoes`, `documentos`, `agenda_eventos` — regularidade fiscal, repositório de arquivos e prazos
- `app_profiles` — perfil/role do usuário (`administrador`, `comercial`, `financeiro`, `consulta`), criado automaticamente por trigger no cadastro

RLS: qualquer autenticado lê tudo (é uma equipe única); apenas `consulta` não pode inserir/editar; apenas `administrador` pode excluir.

Saldo, % consumido e alertas de vencimento (90/60/30/15/7 dias) **nunca são armazenados** — são sempre calculados em `helpers.js` (`calcSaldoAtaItem`, `alertLevel`) a partir da data de hoje.

### Arquivos principais
- `index.html` — shell único: tela de login + layout (sidebar recolhível + header fixo) + container de página
- `config.js` — credenciais Supabase (preencher manualmente, não comitar com chaves reais de produção)
- `main.js` → `app.js` — bootstrap: autenticação, sidebar, dropdown de notificações, router por módulo, despacho global de `data-action`
- `state.js` — estado mínimo (sessão, perfil, lookups cacheados de órgãos/concorrentes/parceiros/produtos/perfis) com padrão observer simples
- `supabase-client.js` / `supabase-service.js` — cliente Supabase e todas as queries (CRUD genérico + queries com join específicas)
- `ui.js` — modal, toast, loading, confirmação
- `helpers.js` — formatação, cálculo de saldo e de alertas de vencimento
- `charts.js` — gráficos em canvas nativo (barra e rosca), sem biblioteca externa
- `constants.js` — ícones SVG inline, menu, enums de status/modalidade/perfil
- `modules/_crud.js` — fábrica genérica de CRUD (lista + busca + modal) usada pelos cadastros simples (Órgãos, Concorrentes, Parceiros, Produtos, Certidões, Agenda)
- `modules/*.js` — um arquivo por página do menu, cada um exportando `render(container)` e `actions` (mapa `'modulo.acao': fn`)

### Roteamento e ações
Não há framework de UI. `app.js` mantém `MODULES = { dashboard, licitacoes, atas, ... }` e:
- `navigateTo(pageId)` chama `MODULES[pageId].render(container)`, que reconstrói o HTML da página via `innerHTML`.
- Todo clique com `data-action="x.y"` em qualquer lugar do documento (incluindo dentro de modais) é capturado por um único listener delegado em `app.js`, que primeiro trata ações globais (`nav.go`, `ui.*`, `auth.*`, `modal.*`) e, se não reconhecer, procura `x.y` no mapa combinado `actions` de todos os módulos (`collectActions()`).
- Inputs/selects dentro de tabelas editáveis (itens de licitação/ata) usam listeners locais (`input`/`change`) registrados pelo próprio módulo após renderizar a tabela — o despacho global só cobre `click`.

### Lookups e cache
`state.js#refreshLookups()` busca de uma vez `orgaos`, `concorrentes`, `parceiros`, `produtos`, `app_profiles` e guarda em `state.lookups`, usado para popular `<select>` nos formulários sem nova query. É chamado no bootstrap e sempre que um desses cadastros é alterado (`afterChange` nos módulos baseados em `_crud.js`).

## Adicionar uma nova página

1. Criar `modules/novapagina.js` exportando `render(container)` e `actions` (pode usar `buildCrudModule` de `_crud.js` se for um cadastro simples).
2. Importar e registrar em `MODULES` em `app.js`.
3. Adicionar entrada em `PAGE_META` em `constants.js` (id, label, ícone — adicionar o ícone em `ICONS` se for novo).
4. Se a página tiver tabela própria, criar a tabela e as policies RLS em `supabase/schema.sql` seguindo o padrão de `select`/`insert`/`update` para `authenticated` exceto `role = 'consulta'`, e `delete` restrito a `administrador`.

## Deploy (GitHub Pages)

1. Criar repositório (ex.: `controlehumana/GestLicit`, mesmo padrão do HumWMS).
2. `git init && git add . && git commit -m "..." && git remote add origin <url> && git push -u origin main`.
3. Em **Settings → Pages**, branch `main`, pasta raiz `/`.
4. **Importante**: `config.js` ficará público no repositório — a `anon key` do Supabase é destinada a ser pública (a segurança real vem do RLS), mas confirme que o RLS está ativo em todas as tabelas antes de publicar.

## Pendências conhecidas (próximos passos sugeridos)

- Vincular automaticamente `licitacao_itens.produto_descricao` ao cadastro de `produtos` (hoje é texto livre com sugestão via `<datalist>`, sem FK).
- Ao gerar uma Ata a partir de uma Licitação ganha, pré-popular os itens da ata a partir dos itens da licitação com status "Ganhou" (hoje a vinculação `licitacao_id` existe, mas os itens da ata são lançados manualmente).
- Relatório de Resultado Mensal em PDF é texto simples (sem tabela formatada); considerar adicionar `jspdf-autotable` se for necessário um layout mais profissional para impressão/compartilhamento externo.
