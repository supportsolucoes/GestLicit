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
4. **Desative o autocadastro público** em **Authentication → Sign In / Providers → Email** (toggle "Allow new users to sign up" desligado). O app não tem mais tela de "Criar conta" (removida por decisão de segurança em 2026-06-24 — era possível qualquer pessoa criar uma conta sozinha) — mas a API de signup do Supabase continua existindo por trás, então é esse toggle no dashboard, e não o código do app, que efetivamente bloqueia cadastro não autorizado.
5. Crie o **primeiro** usuário (o administrador inicial) em **Authentication → Users → Add user** (e-mail + senha). Ele nasce com perfil `usuario` (trigger `handle_new_user`).
6. No SQL Editor, promova esse usuário a administrador:
   ```sql
   update public.app_profiles set role = 'administrador' where email = 'email-do-primeiro-usuario';
   ```
7. Publique a Edge Function `admin-create-user` (`supabase functions deploy admin-create-user`, código em `supabase/functions/admin-create-user/index.ts`). A partir daí, **todo o cadastro de novos usuários é feito de dentro do app**, pela página **Usuários** (admin-only) — não é mais necessário voltar ao painel do Supabase. O administrador que cria o usuário já escolhe ali o perfil (Administrador/Usuário) e, se for Usuário, quais páginas ele acessa.

## Arquitetura

### Stack
- **Frontend puro**: HTML + CSS + ES Modules nativos (sem bundler, sem framework)
- **Backend**: Supabase (Auth + Postgres relacional + Storage)
- **Bibliotecas via CDN**: `@supabase/supabase-js`, `xlsx` (SheetJS, exportação Excel), `jspdf` (exportação PDF)
- **Deploy**: GitHub Pages

### Banco de dados
Schema 100% relacional (sem JSONB de estado, diferente do projeto Fluxo) — ver `supabase/schema.sql`. Tabelas centrais:
- `licitacoes` + `licitacao_itens` — editais disputados e seus itens (status Ganhou/Declinou/Desclassificado/Fracassado/Revogado). `licitacoes` guarda o cabeçalho completo do edital (datas/prazos, pregoeiro, registro de preço, modo de disputa etc.). `licitacao_itens` guarda, por item: dados do edital (produto vinculado, qtd, marca/fabricante, modelo/versão, valor de referência — pode ficar vazio = sigiloso) e a precificação (`custo_unitario`, `margem_percentual`, `valor_minimo` calculado a partir desses dois, `valor_inicial` digitado livremente). Os campos de resultado (`status`, `empresa_vencedora_id`, `parceiro_id`, `motivo_perda`, `valor_final`) continuam na mesma tabela mas **não têm UI no modal de cadastro/precificação** — ficam para o próximo bloco (Sessão Pública/Resultado).
- `atas` + `ata_itens` — atas de registro de preço ganhas. `ata_itens.produto_id` é obrigatório (mesma regra dos outros módulos). O saldo por item **não vem mais de `ata_consumos`** (tabela legada, ainda existe no banco mas não é mais lida pela UI) — vem da soma de `empenho_itens.quantidade_empenhada` de todos os Empenhos vinculados àquela Ata (`calcSaldoAtaItemPorEmpenho` em `helpers.js`). Ver Bloco 4.
- `contratos` + `contrato_itens` — contratos formais firmados após licitação ganha. `contratos.licitacao_id` é **obrigatório** (`not null`, diferente de `atas.licitacao_id` que é opcional) — todo contrato precisa referenciar a licitação que o originou. `contratos.valor_contrato` é o valor oficial assinado (campo obrigatório digitado pelo usuário) — distinto da soma dos itens (`Σ valor_unitario × quantidade_total`, nunca armazenada, só exibida como conferência dentro da seção de itens). A listagem usa `valor_contrato` e só cai para a soma calculada se ainda não tiver sido informado. `contrato_itens.produto_id` é obrigatório (mesma regra de `licitacao_itens`, sem opção de texto livre).
- `empenhos` + `empenho_itens` + `empenho_entregas` — compromissos orçamentários (etapa que vem **depois** de Ata e/ou Contrato — ver Bloco 4). Vínculo opcional com `ata_id` e/ou `contrato_id`; pode ser "direto" (sem nenhum dos dois). `empenho_itens.produto_id` é obrigatório. `empenho_entregas` (Bloco 7) registra entregas físicas parciais por item — saldo (`quantidade_empenhada − entregue`) nunca é armazenado, sempre calculado (`calcSaldoEmpenhoItem`).
- `orgaos`, `concorrentes`, `parceiros`, `produtos` — cadastros de apoio (lookups). `concorrentes.cnpj` é opcional, usado só para o atalho "Analisar" na Análise de Concorrente (ver Bloco 5) — não guarda nada da análise em si.
- `certidoes`, `documentos`, `agenda_eventos` — regularidade fiscal, repositório de arquivos e prazos. `agenda_eventos` tem `referencia_tipo`/`referencia_id` genéricos — usado por `licitacoes.js` para vincular lembretes a uma licitação específica (`referencia_tipo = 'licitacao'`).
- `tags` + `licitacao_tags` — rótulos livres (nome + cor) atribuíveis a licitações via N:N. Tags do sistema (Precificado, Cadastrado no portal, Ganha, Recurso, Perdida, Suspenso, Cancelada) são seedadas pela migration; o usuário pode criar outras pela UI.
- `app_profiles` — perfil/role do usuário. Só 2 perfis desde o Bloco 11: `administrador` (acesso total) e `usuario` (acesso restrito a `paginas_permitidas`, array de ids de página liberadas pelo administrador). Criado automaticamente por trigger no cadastro (`handle_new_user`, nasce como `usuario` sem páginas).
- `app_settings` — chave/valor de configurações de sistema (hoje só `portal_transparencia_api_key`), editável em Configurações em vez de `config.js`. Select liberado para qualquer autenticado (a Análise de Concorrente precisa ler em qualquer papel), insert/update restrito a `administrador`. Cacheada em `state.lookups.settings` (mapa chave→valor), atualizada por `refreshLookups()`.
- `demo_seed_log` — rastreia os registros criados pelo gerador de "Dados de demonstração" (Configurações), para permitir apagar tudo de uma vez. Só `administrador` lê/escreve.

RLS: qualquer autenticado lê tudo (é uma equipe única); apenas `administrador` pode excluir. Insert/update ficaram liberados para qualquer autenticado desde o Bloco 11 (não existe mais perfil `consulta` — as policies que checavam `role <> 'consulta'` continuam no banco mas hoje são sempre verdadeiras, já que nenhum perfil se chama mais assim). O controle de quem vê o quê é feito **na UI** (menu e `navigateTo`, via `canAccessPage()` em `state.js`), não no RLS — decisão deliberada do usuário para não ter que reescrever policy por tabela.

Saldo, % consumido e alertas de vencimento (90/60/30/15/7 dias) **nunca são armazenados** — são sempre calculados em `helpers.js` (`calcSaldoAtaItemPorEmpenho`, `alertLevel`) a partir da data de hoje. `calcSaldoAtaItem` (baseado em `ata_consumos`) ainda existe no arquivo mas não é mais chamada por nenhum módulo — é código legado, não removido por segurança, mas não deve ser reutilizada para novas features (usar `calcSaldoAtaItemPorEmpenho`).

### Arquivos principais
- `index.html` — shell único: tela de login + layout (sidebar recolhível + header fixo) + container de página
- `config.js` — credenciais Supabase (preencher manualmente, não comitar com chaves reais de produção)
- `main.js` → `app.js` — bootstrap: autenticação, sidebar, dropdown de notificações, router por módulo, despacho global de `data-action`
- `state.js` — estado mínimo (sessão, perfil, lookups cacheados de órgãos/concorrentes/parceiros/produtos/perfis) com padrão observer simples
- `supabase-client.js` / `supabase-service.js` — cliente Supabase e todas as queries (CRUD genérico + queries com join específicas)
- `ui.js` — modal, toast, loading, confirmação
- `helpers.js` — formatação, cálculo de saldo e de alertas de vencimento
- `charts.js` — gráficos em canvas nativo (barra e rosca), sem biblioteca externa
- `external-apis.js` — chamadas a APIs públicas externas (BrasilAPI, PNCP, Portal da Transparência) usadas pela Análise de Concorrente. Nada disso passa pelo Supabase nem é persistido — é sempre consulta ao vivo direto do navegador (todas as 3 APIs têm CORS liberado, testado na prática).
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
4. **Importante**: `config.js` ficará público no repositório — a `anon key` do Supabase é destinada a ser pública (a segurança real vem do RLS), mas confirme que o RLS está ativo em todas as tabelas antes de publicar. Desde o Bloco 6, `config.js` não guarda mais segredos de integração (a chave do Portal da Transparência foi movida para a tabela `app_settings`, editável em Configurações) — só credenciais do Supabase, que já são públicas por design.

## Fluxo do ciclo licitatório (construído por blocos)

A tela de Licitação está sendo construída em blocos sucessivos. Bloco 1 — **Recebimento/Cadastro + Itens do edital + Precificação** — implementado num modal único (sem abas):
- Cabeçalho expandido com todos os dados do edital (registro de preço, valor total estimado, modo de disputa, abertura, sessão pública, prazos, pregoeiro/contato, endereços).
- Tabela de itens vincula `produto_id` ao cadastro de Produtos (select) — **obrigatório**, sem opção de texto livre/"Outro" (removida a pedido do usuário em 2026-06-24: todo item de licitação deve referenciar um produto já cadastrado). `salvar()` bloqueia o save com toast se algum item não tiver produto selecionado. Ao escolher um produto, `custo_unitario` e `marca_fabricante` são pré-preenchidos a partir do cadastro, e `produto_descricao` é sempre espelhado do nome do produto (não é mais um campo de texto editável separado).
- Precificação: `margem_percentual` definida por item gera `valor_minimo` automaticamente (`custo_unitario × (1 + margem/100)`), recalculado a cada mudança de custo ou margem. `valor_inicial` é digitado livremente (estratégia de abertura de lance).
- `valor_referencia` (valor estimado do edital) é opcional — vazio significa "Sigiloso".

Bloco 2 — **Visão geral em cards, Agenda vinculada, Pós-Disputa e Tags** — implementado:
- A listagem de Licitações (`renderCards`/`cardHtml` em `modules/licitacoes.js`) trocou de tabela para **cards**: tags atribuídas, badges de status agregados por item, fatos-chave (modo de disputa, valor total estimado, abertura, registro de preço, UF), tira de "Tarefas e compromissos" (lembretes vinculados via `agenda_eventos`) e um expand "Ver itens do edital" (somente leitura).
- **Tags**: botão "+ Atribuir tag" abre modal com checkboxes das tags existentes (`state.lookups.tags`) + criação de tag nova inline (nome + cor). Persistido via `licitacao_tags` (N:N). Filtro por tag na barra de busca da listagem.
- **Agenda vinculada**: botão "+ Criar lembrete" no card abre um formulário mínimo que cria um `agenda_eventos` com `referencia_tipo='licitacao'` e `referencia_id=<licitacao.id>`. Sem marcos automáticos por enquanto (decisão do usuário) — é sempre uma criação manual.
- **Pós-Disputa / Resultado**: botão "Resultado" no card abre um **modal separado** (não mistura com o modal de cadastro+precificação) listando os itens com: Meu Lance Final (`valor_final`), Valor Arrematado (`valor_arrematado`, novo campo — quanto o item fechou, nosso ou do concorrente), Resultado (reaproveita `STATUS_LICITACAO`), e — habilitados só quando o resultado é uma perda (`Declinou`/`Desclassificado`/`Fracassado`/`Revogado`, ver `STATUS_PERDA` no módulo) — Concorrente Vencedor (`empresa_vencedora_id`) e Motivo da perda (`motivo_perda`). Totais "Valor Total Participado" (Σ valor_final×qtd) e "Valor Total Arrematado" (Σ valor_arrematado×qtd) calculados ao vivo.
- Validado visualmente com um harness isolado (mock de `state.js`/`supabase-service.js`, sem tocar o Supabase real) — screenshots do card, expand de itens, modal de tags, modal de lembrete e modal de resultado revisados antes de entregar.

Bloco 3 — **Contratos** — implementado como módulo novo e independente (`modules/contratos.js`, menu próprio "Contratos" entre Licitações e Atas e Empenhos, refletindo o fluxo do processo):
- Modal único (header + itens), no mesmo padrão do bloco 1, com seções: Dados do contrato (Nº, Licitação relacionada *obrigatória*, Órgão, Data do Contrato, Data de Assinatura, Situação), Vigência e viabilidade (início/fim, `Viável`/`Inviável`/`Em análise`, upload de arquivo no bucket `documentos` em `Contrato/`), Prazos e contato (entrega/pagamento com checkbox "Úteis", telefone, email), Observações, e Itens do contrato.
- Botão **"Carregar itens da licitação"**: busca os itens da licitação vinculada (`Service.listLicitacaoItens`) e pré-popula os itens do contrato (produto, marca/fabricante, modelo/versão, quantidade, valor unitário = `valor_final` se já tiver resultado registrado, senão `valor_inicial`), ignorando duplicados por `produto_id`. Isso é o mecanismo concreto de "amarração" entre Licitação → Pós-Disputa → Contrato.
- Itens exigem produto cadastrado (mesma regra do bloco 1), sem controle de saldo/consumo (decisão do usuário — diferente de Ata).
- `app.js#refreshNotifications()` agora também alerta vencimento de Contratos vigentes, junto com Atas e Certidões.
- Validado com harness isolado análogo ao do bloco 2 (lista, edição, e carregamento de itens da licitação testados com dados fictícios).

Bloco 4 — **Empenhos + migração do saldo da Ata** — implementado. Motivação: o usuário propôs o fluxo de execução financeira `Ata → Empenhos → Pedidos → Entregas → Faturamento → Recebimentos`; este bloco cobre só a etapa de Empenho (as demais ficam para depois). Mudanças:
- Módulo novo `modules/empenhos.js`, menu "Empenhos" posicionado **depois** de Contratos e Atas (`Licitações → Contratos → Atas → Empenhos`), já que todo empenho pode vir de uma Ata OU de um Contrato (vínculo opcional, não exclusivo) ou ser direto.
- Botão **"Carregar itens do vínculo"**: lê os itens da Ata ou do Contrato selecionado (qualquer um dos dois, o que estiver preenchido) e pré-popula os itens do empenho — mesmo mecanismo de amarração do bloco 3, generalizado para os dois tipos de origem.
- **Refatoração de `modules/atas.js`** (mudança de comportamento, não só adição):
  - Página e botões renomeados de "Atas e Empenhos" para "Atas" — `constants.js#PAGE_META` também atualizado. O campo "Tipo" (ATA/EMPENHO) foi **removido do formulário** (não é mais oferecido para escolha); registros antigos com `tipo='EMPENHO'` continuam no banco e aparecem normalmente, só não é mais possível criar novos assim — `salvarHeader` preserva o `tipo` existente ao editar e usa `'ATA'` como padrão ao criar.
  - O painel "Lançamentos" (consumo manual, `ata_consumos`) foi **substituído** por "Empenhos vinculados": uma lista somente-leitura dos `empenho_itens` cujo empenho aponta para aquela Ata, com um link "Ir para Empenhos" (`nav.go`/`data-page="empenhos"`) — não dá mais para lançar consumo direto na tela da Ata; isso agora se faz cadastrando um Empenho.
  - Item da Ata (`abrirFormularioItem`) deixou de aceitar produto em texto livre com `<datalist>` — agora é um `<select>` obrigatório, igual aos outros módulos (necessário para o `produto_id` casar com `empenho_itens.produto_id` no cálculo de saldo).
  - Stat card novo "% Empenhado" na visão de detalhe da Ata, e o texto de saldo por item mudou de "Consumido X de Y" para "Empenhado X de Y" — alinhado com a referência visual que o usuário trouxe (`visão gerencial da ata.png`).
- Validado com harness isolado (cenário: 1 Ata com 1 item de 500 unidades, 1 Empenho vinculado consumindo 200 → confirma 40% empenhado tanto no stat card quanto na barra de progresso do item).

Bloco 5 — **Análise de Concorrente** — implementado em `modules/concorrentes.js` (módulo deixou de usar só `buildCrudModule` puro; agora envolve o CRUD existente com uma seção de busca por CNPJ acima da tabela). Inspirado na ferramenta equivalente do Licitei, mas com escopo verificado na prática (não assumido) antes de implementar:
- **Dados da empresa, sócios, atividades, regime tributário**: `External.fetchEmpresaCnpj` → BrasilAPI (`brasilapi.com.br/api/cnpj/v1/{cnpj}`), grátis, sem chave, CORS liberado. Testado em produção real com o CNPJ da própria Humana.
- **Contratos/Empenhos ganhos + Estatísticas**: `External.fetchContratosPncp` → API de busca do PNCP (`pncp.gov.br/api/search/?q={cnpj}&tipos_documento=contrato`), grátis, sem chave, CORS liberado — **confirmado ser a mesma fonte que o Licitei usa** (testei com o CNPJ da Humana e bateu exatamente: mesmo primeiro resultado "Empenho nº 7028" e mesmo total "139"). Pagina em blocos de 50 (`maxPaginas=6` por padrão, cobre até 300 resultados). Estatísticas (valor total, por modalidade, por UF) e os 2 gráficos (rosca + barra, reaproveitando `charts.js`) são calculados ao vivo a partir desses mesmos resultados — nada é armazenado.
- **Certidões (CEIS/CNEP)**: `External.fetchCertidoesPortalTransparencia` → API do Portal da Transparência, exige uma chave gratuita (cadastro em `api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email`) salva em **Configurações → Integrações** (não em `config.js` — ver Bloco 6). Sem a chave, a seção mostra uma mensagem explicando como ativar, em vez de dar erro.
- **UX de carregamento**: ao clicar "Analisar", o botão mostra spinner inline + texto "Consultando..." e a área de resultado mostra um spinner grande centralizado com a mensagem "Consultando Receita Federal, PNCP e Portal da Transparência..." (`renderLoadingInline`/`.loading-inline`/`.spinner-sm` em `styles.css`) — evita a impressão de tela travada enquanto as 3 chamadas (que levam alguns segundos) resolvem.
- **Link "Ver no PNCP"**: cada linha da tabela de contratos/empenhos tem um link pro documento completo no portal oficial. Testado na prática: o padrão de URL é `https://pncp.gov.br/app` + `item_url` (campo já vem na resposta da busca) — **sem** o `/app` dá 404, confirmado com curl antes de usar.
- **Fora do escopo, deliberadamente** (verificado e descartado, não é só falta de tempo): "Itens Ganhos" em granularidade nacional (testei `tipos_documento=item` no PNCP, retornou 0 — exigiria abrir processo por processo, inviável ao vivo); TCU-Inidôneos e CNJ-CNIA (sem API pública, só formulário — não fazer scraping); licitanet.com.br (site comercial de terceiros, sem API pública documentada — não fazer scraping).
- **Nada é persistido** (decisão explícita do usuário) — toda consulta é refeita do zero a cada análise. Só `concorrentes.cnpj` (opcional, no cadastro) é salvo, para o atalho "Analisar" na linha do concorrente.
- `modules/_crud.js` ganhou um hook genérico `config.extraRowActions(record)` (opcional, retrocompatível) para permitir esse botão "Analisar" por linha sem duplicar a fábrica de CRUD.
- Exportação para Excel reaproveita o padrão já usado em `relatorios.js` (`window.XLSX.utils.aoa_to_sheet` + `writeFile`).
- Validado com harness isolado chamando as APIs **reais** (não mockadas, já que são públicas e gratuitas) — resultado bateu com a referência visual ponto a ponto.

Bloco 6 — **Configurações: chave de API editável + Dados de demonstração** — implementado em `modules/configuracoes.js`:
- **Integrações**: campo "Chave da API (Portal da Transparência)" salvo em `app_settings` (não mais em `config.js`). `external-apis.js#getPortalTransparenciaApiKey()` agora lê de `getState().lookups.settings.portal_transparencia_api_key` em vez de `window.GESTLICIT_CONFIG`. Isso também é uma melhoria de segurança incidental: antes a chave ficava num arquivo estático público (legível por qualquer um na internet); agora fica numa tabela só legível por usuário autenticado do sistema.
- **Dados de demonstração**: botão "Criar exemplo completo" gera, via as próprias funções de serviço já existentes (não SQL direto), uma licitação de ponta a ponta com o sufixo "(EXEMPLO)" no nome — órgão, produto, licitação com item precificado e já com resultado de Pós-Disputa preenchido (`status='Ganhou'`), tag "Exemplo", lembrete de agenda, contrato vinculado, ata vinculada, e empenho vinculado à ata (40% do saldo, replicando o cenário que já tinha sido usado para validar o Bloco 4). Cada registro de topo (não os itens, que cascateiam) é logado em `demo_seed_log`. Botão "Remover dados de demonstração" lê esse log e apaga cada registro pela função de delete já existente do módulo correspondente, na ordem `empenhos → atas → contratos → agenda_eventos → licitacoes → produtos → orgaos → tags` (ordem que respeita os `on delete restrict` de `produto_id`), depois limpa o log.
- Migração "ALTERAÇÕES v1.7" em `supabase/schema.sql` (`app_settings` + `demo_seed_log`). **Ainda não aplicada no banco real.**
- Validado com harness isolado (salvar chave, criar exemplo → confirma 8 registros logados, remover → confirma volta ao estado vazio).
- **Ajustes pós-entrega (mesmo dia)**: spinner de carregamento na Análise de Concorrente (`.loading-inline`/`.spinner-sm` em `styles.css`), link "Ver no PNCP" por linha (`https://pncp.gov.br/app` + `item_url`, testado com curl — sem `/app` dá 404) também na exportação Excel, e correção de um texto desatualizado em `renderCertidoes()` que ainda mandava colar a chave em `config.js`.

Bloco 7 — **Entregas do Empenho** — implementado em `modules/empenhos.js`. Próxima etapa do fluxo `Ata/Contrato → Empenho → Entregas → Faturamento → Recebimentos`, motivada por um caso real do usuário (empenhou 10, entregou 5, precisa saber o saldo restante pra próxima entrega):
- Nova tabela `empenho_entregas` (empenho_item_id, data_entrega, quantidade, numero_nota_fiscal, observacao) — mesmo padrão do extinto `ata_consumos`, mas escopado ao Empenho (não à Ata) e já com campo de Nota Fiscal pensando na próxima etapa (Faturamento).
- Saldo do item = `quantidade_empenhada − Σ quantidade entregue` (`calcSaldoEmpenhoItem` em `helpers.js`, nunca armazenado).
- Dentro do modal de editar Empenho, uma seção "Saldo e entregas" (só aparece para empenhos já salvos, com itens já persistidos) lista cada item com barra de progresso + expand "Entregas (N)" pra ver o histórico e lançar nova entrega — mesmo padrão visual que a Ata usava para consumos antes do Bloco 4.
- Listagem de Empenhos ganhou coluna "% Entregue" (agregado de todos os itens).
- Migração "ALTERAÇÕES v1.8" (inclui também o ajuste de RLS do Bloco 8, abaixo). **Ainda não aplicada no banco real.**

Bloco 8 — **Separação Usuários / Configurações** — motivada pelo usuário: "nem todos terão acesso a criar usuário".
- `modules/usuarios.js` (novo): lista + edição de perfil/role dos usuários — **admin-only** (`adminOnly: true` em `PAGE_META`), igual era antes.
- `modules/configuracoes.js`: ficou só com Integrações (chave de API) e Dados de demonstração — **deixou de ser admin-only**, agora qualquer perfil exceto `consulta` acessa a página.
- Dentro de Configurações, os dois cartões têm regras de acesso diferentes (decisão deliberada, não foi pedido explicitamente mas é necessário pra não mostrar botão que vai falhar): **Integrações** (chave de API) é liberado pra qualquer um que não seja `consulta` (`canWrite()`) — RLS de `app_settings` relaxada de admin-only para isso. **Dados de demonstração** continua restrito a `isAdmin()`, porque "Remover" depende de excluir licitações/contratos/atas/empenhos/órgãos/produtos, e exclusão dessas tabelas é admin-only em todo o sistema — abrir a UI sem isso geraria erro de RLS silencioso.

Bloco 9 — **Agenda em calendário (Mês/Semana/Dia) + correção de notificação** — implementado em `modules/agenda.js`:
- A página ganhou um alternador "Lista / Mês / Semana / Dia" no cabeçalho (`.view-toggle`). **Lista** continua sendo o `buildCrudModule` original (reaproveitado via `crudMod.render(body)`), sem mudança nenhuma. **Mês/Semana/Dia** são uma grade de calendário nova, escrita à mão (sem framework, sem lib de calendário), com navegação `‹ ›`/"Hoje" e clique em dia (vai pro Dia daquela data) ou em evento (abre detalhe).
- **Eventos vêm de 4 fontes combinadas** (decisão do usuário, não só `agenda_eventos`): compromissos da própria Agenda (azul), + vencimento de Atas Vigentes (verde), + vencimento de Contratos Vigentes (laranja), + vencimento de Certidões (vermelho) — mesmas fontes que já alimentavam o sininho de notificações, agora também visíveis no calendário. Função `reloadEventos()` normaliza tudo num formato único `{id, tipo, titulo, data, cor, raw}`.
- Clicar num evento de **vencimento** (ata/contrato/certidão) abre um modal somente-informativo com botão "Ir para [módulo]" (`nav.go`) — não tenta abrir o modal de edição daquele módulo diretamente, porque os módulos baseados em `_crud.js` guardam um cache privado por closure que só é populado depois que a própria página renderizou pelo menos uma vez nesta sessão; abrir direto do calendário arriscava renderizar o formulário de edição vazio. Clicar num evento da própria **Agenda** abre um mini formulário de editar/excluir escrito direto em `agenda.js` (não reaproveita o modal do `_crud.js`, pelo mesmo motivo de isolamento de cache).
- **Sem grade de hora** no Semana/Dia (diferente do Google Calendar real): os eventos do sistema só têm data, não hora, então Semana/Dia mostram a lista de eventos do dia em vez de uma grade hora-a-hora — simplificação deliberada, mencionada ao usuário, não pedida explicitamente mas necessária dado o modelo de dados atual.
- **Bug real encontrado e corrigido nessa mesma leva** (usuário mandou screenshot): o sininho de notificações (`app.js#refreshNotifications`) nunca verificava `agenda_eventos` — só vencimentos de Atas/Contratos/Certidões. Um lembrete de Agenda com `lembrete=true` pra hoje não aparecia no sininho. Corrigido somando `agenda_eventos` (filtrado por `lembrete=true`) à mesma lista, reaproveitando `alertLevel()`.
- Novo helper `dateToISO(date)` em `helpers.js` (converte um `Date` arbitrário pra string `YYYY-MM-DD`, complementa o `todayISO()` que só serve pra hoje).
- Validado com harness isolado (Lista/Mês/Semana/Dia, navegação, clique em evento de vencimento e em evento próprio) — todas as visões renderizaram corretamente com dados mistos das 4 fontes.
- **Bug pós-entrega corrigido**: a visão Lista duplicava o cabeçalho "Agenda" (um do `renderShell()` novo, outro do `buildCrudModule` já existente, ambos renderizados ao mesmo tempo). Corrigido: o alternador Lista/Mês/Semana/Dia agora é uma barra fina separada (`.agenda-toolbar`) acima do conteúdo, e cada visão (Lista via `crudMod.render`, ou Mês/Semana/Dia com `<h1>` próprio) é responsável pelo seu único cabeçalho.

Bloco 10 — **Remoção do autocadastro público** — usuário identificou um problema de segurança real: a tela de login tinha um link "Criar conta" que permitia qualquer pessoa se cadastrar (nascendo com perfil `consulta`, que já tem acesso de leitura a todos os dados via RLS). Removido:
- `index.html`: removido o campo de nome e o link "Criar conta"; adicionado texto explicando que novas contas são criadas por um administrador.
- `app.js`: removida toda a lógica de alternância signin/signup (`setAuthMode`, `authMode`, branch de signup em `handleLoginSubmit`, action `auth.toggleMode`).
- `supabase-service.js`: removida a função `signUp` (sem mais nenhum chamador).
- **A correção de verdade não é no código, é no painel do Supabase**: o app não tendo mais o botão não impede alguém de chamar a API de signup direto. O bloqueio real precisa ser feito em **Authentication → Sign In/Providers → Email → desativar "Allow new users to sign up"** no painel do Supabase — isso só o usuário pode fazer (é configuração da conta dele, não código).
- Novo fluxo de onboarding documentado em CLAUDE.md: administrador cria o usuário em **Authentication → Users → Add user** no Supabase, depois promove o perfil pela página **Usuários** do app.
- **Ajuste pós-entrega (mesmo dia)**: o link "Não tem conta? Peça a um administrador..." que tinha sobrado na tela de login foi removido (`index.html`) — ficou obsoleto assim que o Bloco 11 passou a permitir criar usuário de dentro do próprio app.

Bloco 11 — **Simplificação de perfis + cadastro de usuário pelo app + navegação cruzada** — motivado pelo usuário: "não é seguro fazer a conta pela tela de login" (ver Bloco 10) somado a "quero controlar a quais menus os usuários têm acesso". Maior mudança de modelo de permissão do projeto:
- **Perfis foram de 4 para 2**: `administrador` (acesso total, sem restrição de página) e `usuario` (só acessa as páginas marcadas em `app_profiles.paginas_permitidas`, um array de ids de `PAGE_META`). Migração "ALTERAÇÕES v1.9" em `supabase/schema.sql` — já aplicada em produção via MCP do Supabase (`apply_migration`), não só commitada no arquivo.
- **Cadastro de usuário saiu do painel do Supabase e foi para dentro do app**: página nova `modules/usuarios.js` (admin-only) tem formulário de "Novo usuário" (nome, e-mail, senha provisória, perfil, checklist de páginas liberadas) que chama a Edge Function `admin-create-user` (`supabase/functions/admin-create-user/index.ts`, deployada via MCP `deploy_edge_function`). A função roda com a `service_role` key (nunca exposta no cliente), confirma que quem está chamando é de fato um administrador, cria o login (`auth.admin.createUser`) e já grava o perfil/páginas em `app_profiles`. `supabase-service.js#adminCreateUser()` só invoca a function (`sb().functions.invoke(...)`) e propaga a mensagem de erro de dentro do corpo da resposta.
- **Enforcement é só de UI, não de RLS**: decisão deliberada do usuário (perguntada explicitamente) para não ter que reescrever policy em ~15 tabelas. `state.js#canAccessPage(page)` decide o que aparece no menu (`renderSidebar`) e bloqueia `navigateTo` em `app.js` para página não liberada (redireciona pro Dashboard). `canWrite()` virou sempre `true` (não existe mais perfil `consulta`, que era o único bloqueado para escrita).
- **Navegação cruzada entre Contrato/Ata/Empenho**, seguindo o fluxo do processo (pedido: "ter um botão para chamar os outros módulos... contratos ter um botão para atas do cliente que está sendo visto"):
  - `navigateTo(pageId, params)` em `app.js` agora aceita um 2º argumento opcional, repassado para `MODULES[pageId].render(container, params)`. A action `nav.go` lê `data-filter-key`/`data-filter-value`/`data-filter-label` (filtra a listagem por um campo, ex. `orgao_id`) ou `data-open-id` (abre direto o registro específico) do botão clicado e monta esse `params`. `navigateTo` sempre fecha qualquer modal aberto antes de trocar de página (`closeModal()`), já que esses botões vivem dentro de modais.
  - Dois tipos de vínculo, tratados de forma diferente: quando há **FK direta** (Empenho → Ata/Contrato, via `ata_id`/`contrato_id`), o botão usa `openId` e abre o registro específico direto (`abrirFormulario(openId)` em Contratos/Empenhos, ou a visão de detalhe em Atas). Quando o vínculo é só **mesmo órgão** (Contrato ↔ Ata, que não têm FK uma com a outra — ambas só referenciam `licitacao_id`/`orgao_id`), o botão usa `filter` e mostra a listagem inteira filtrada por `orgao_id`, com uma barra "Filtrando por: X — Limpar filtro" (`.filter-banner` em `styles.css`) acima da tabela.
  - Botões adicionados: no modal de Contrato, "Ver Atas do Órgão" e "Ver Empenhos deste Contrato"; na visão de detalhe da Ata, "Ver Contratos do Órgão" e "Ver Empenhos desta Ata" (e o link pré-existente "Ir para Empenhos", dentro do painel de empenhos vinculados por item, ganhou o mesmo filtro por `ata_id`); no modal de Empenho, "Ver Ata vinculada" e "Ver Contrato vinculado" (só aparecem se o respectivo vínculo estiver preenchido).
  - `.modal-nav-links` (linha de botões no topo do modal) e `.filter-banner` novos em `styles.css`.
- **Empenho ganhou upload de arquivo**, mesmo padrão do Contrato (bucket `documentos`, pasta `Empenho/`, coluna `empenhos.arquivo_url`, `Service.uploadEmpenhoArquivo`, botão "Ver arquivo atual" via `getSignedUrl`).
- **Análise de Concorrente ganhou botões "Nova consulta" e "Limpar"**: "Limpar" fica fixo ao lado de "Analisar" (limpa o campo de CNPJ e o resultado); "Nova consulta" aparece no topo do próprio resultado (ao lado do nome da empresa consultada), para não precisar rolar a tela toda de volta pra cima depois de uma consulta longa. Os dois chamam a mesma função `limparAnalise()`.
- **Correção de bug visual**: o ponto vermelho de notificação (`.notif-dot`) vazava para fora do sininho e aparecia em cima do nome do usuário — causa: `.notif-dot` é `position:absolute`, mas o botão `#btn-notifications` (pai direto) não tinha `position:relative`, então o navegador ancorava o ponto no ancestral mais próximo que tinha (`.topbar-actions`, que envolve sininho + chip do usuário). Corrigido com `#btn-notifications { position: relative; }`.
- **Agenda passou a abrir direto em visão "Mês"** (antes abria em "Lista") — `viewMode` default trocado de `'lista'` para `'mes'` em `modules/agenda.js`.
- Validado com harness isolado reproduzindo o fluxo completo Contrato → Atas do Órgão (filtrado) → detalhe da Ata → Empenhos da Ata (filtrado) → Empenho → Ata vinculada (abre direto), sem erros de console, com dados fictícios compartilhando o mesmo órgão/ata/contrato para exercitar o filtro de verdade.
- **Ajustes pós-entrega (mesmo dia)**:
  - **Redesign da Análise de Concorrente**: usuário reportou visual "muito misturado" (rótulo e valor com pouco contraste, seções sem separação clara). Trocado `.form-section-title`/`.form-grid.cols-3`/`.form-field` (pensados para formulário editável) por um padrão novo só para exibição somente-leitura: `.info-section` (bloco com borda inferior separando cada seção), `.info-section-title` (eyebrow azul, uppercase) e `.info-grid`/`.info-field` (rótulo cinza uppercase pequeno, valor em negrito maior) — tudo em `styles.css`. Cada seção (Dados da empresa, Endereço, Atividade econômica, Sócios, Certidões, Estatísticas) agora é um bloco visualmente isolado.
  - **Padronização de campos de dinheiro em R$ 0,00**: até aqui os inputs de valor mostravam o número crú ao editar (ex. "1234.5"), sem separador de milhar nem vírgula decimal brasileira. Novo helper `formatMoneyInputValue(value)` em `helpers.js` (usa o `formatNumber` já existente) formata o valor inicial de todo input de dinheiro como "1.234,50". Para os campos "principais" (Valor do Contrato, Valor Empenhado, Valor Total da Ata, Valor Total Estimado da Licitação, Preço de custo do Produto), também foi adicionado um prefixo visual "R$" fixo (`.input-currency-wrap` em `styles.css`, um `::before` posicionado sobre o input). Nos campos de valor unitário dentro das tabelas de itens (mais estreitos), só a formatação brasileira foi aplicada, sem o prefixo "R$", para não espremer a coluna. `modules/_crud.js` ganhou um novo `type: 'currency'` (usado por Produtos) que já aplica os dois. `parseNumber()` (já existente) continua lendo esse formato de volta sem mudança, pois já tratava `.`/`,` corretamente.

## Pendências conhecidas (próximos passos sugeridos)

- Bloco de **Habilitação** e **Monitoramento** (vistos na referência visual do Licitei) ainda não têm equivalente no GestLicit.
- A listagem de "Fase de Lance / Sessão Pública / Homologada / Desistidas" (chips com contador, vistos na referência de tags do Licitei) foi conscientemente deixada de fora — só o sistema de tags livres (criar/atribuir/filtrar) foi implementado, sem essas visões fixas.
- Próxima camada do fluxo financeiro: **Faturamento → Recebimentos**, ainda não implementada (Entregas, bloco 7, cobre só até a entrega física; falta vincular Nota Fiscal a um Faturamento e controlar Recebimento/pagamento).
- Relatório de Resultado Mensal em PDF é texto simples (sem tabela formatada); considerar adicionar `jspdf-autotable` se for necessário um layout mais profissional para impressão/compartilhamento externo.
- "Itens Ganhos" em granularidade nacional (Análise de Concorrente) e Certidões TCU/CNJ não têm fonte de dados pública gratuita viável — ver Bloco 5 para o porquê, antes de tentar de novo.
