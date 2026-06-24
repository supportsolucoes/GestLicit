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
- `licitacoes` + `licitacao_itens` — editais disputados e seus itens (status Ganhou/Declinou/Desclassificado/Fracassado/Revogado). `licitacoes` guarda o cabeçalho completo do edital (datas/prazos, pregoeiro, registro de preço, modo de disputa etc.). `licitacao_itens` guarda, por item: dados do edital (produto vinculado, qtd, marca/fabricante, modelo/versão, valor de referência — pode ficar vazio = sigiloso) e a precificação (`custo_unitario`, `margem_percentual`, `valor_minimo` calculado a partir desses dois, `valor_inicial` digitado livremente). Os campos de resultado (`status`, `empresa_vencedora_id`, `parceiro_id`, `motivo_perda`, `valor_final`) continuam na mesma tabela mas **não têm UI no modal de cadastro/precificação** — ficam para o próximo bloco (Sessão Pública/Resultado).
- `atas` + `ata_itens` — atas de registro de preço ganhas. `ata_itens.produto_id` é obrigatório (mesma regra dos outros módulos). O saldo por item **não vem mais de `ata_consumos`** (tabela legada, ainda existe no banco mas não é mais lida pela UI) — vem da soma de `empenho_itens.quantidade_empenhada` de todos os Empenhos vinculados àquela Ata (`calcSaldoAtaItemPorEmpenho` em `helpers.js`). Ver Bloco 4.
- `contratos` + `contrato_itens` — contratos formais firmados após licitação ganha. `contratos.licitacao_id` é **obrigatório** (`not null`, diferente de `atas.licitacao_id` que é opcional) — todo contrato precisa referenciar a licitação que o originou. `contratos.valor_contrato` é o valor oficial assinado (campo obrigatório digitado pelo usuário) — distinto da soma dos itens (`Σ valor_unitario × quantidade_total`, nunca armazenada, só exibida como conferência dentro da seção de itens). A listagem usa `valor_contrato` e só cai para a soma calculada se ainda não tiver sido informado. `contrato_itens.produto_id` é obrigatório (mesma regra de `licitacao_itens`, sem opção de texto livre).
- `empenhos` + `empenho_itens` — compromissos orçamentários (etapa que vem **depois** de Ata e/ou Contrato — ver Bloco 4). Vínculo opcional com `ata_id` e/ou `contrato_id`; pode ser "direto" (sem nenhum dos dois). `empenho_itens.produto_id` é obrigatório.
- `orgaos`, `concorrentes`, `parceiros`, `produtos` — cadastros de apoio (lookups). `concorrentes.cnpj` é opcional, usado só para o atalho "Analisar" na Análise de Concorrente (ver Bloco 5) — não guarda nada da análise em si.
- `certidoes`, `documentos`, `agenda_eventos` — regularidade fiscal, repositório de arquivos e prazos. `agenda_eventos` tem `referencia_tipo`/`referencia_id` genéricos — usado por `licitacoes.js` para vincular lembretes a uma licitação específica (`referencia_tipo = 'licitacao'`).
- `tags` + `licitacao_tags` — rótulos livres (nome + cor) atribuíveis a licitações via N:N. Tags do sistema (Precificado, Cadastrado no portal, Ganha, Recurso, Perdida, Suspenso, Cancelada) são seedadas pela migration; o usuário pode criar outras pela UI.
- `app_profiles` — perfil/role do usuário (`administrador`, `comercial`, `financeiro`, `consulta`), criado automaticamente por trigger no cadastro

RLS: qualquer autenticado lê tudo (é uma equipe única); apenas `consulta` não pode inserir/editar; apenas `administrador` pode excluir.

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
4. **Importante**: `config.js` ficará público no repositório — a `anon key` do Supabase é destinada a ser pública (a segurança real vem do RLS), mas confirme que o RLS está ativo em todas as tabelas antes de publicar.

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
- **Certidões (CEIS/CNEP)**: `External.fetchCertidoesPortalTransparencia` → API do Portal da Transparência, exige `config.js#portalTransparenciaApiKey` (chave gratuita, cadastro em `api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email` — usuário ainda não tinha cadastrado na hora da entrega). Sem a chave, a seção mostra uma mensagem explicando como ativar, em vez de dar erro.
- **Fora do escopo, deliberadamente** (verificado e descartado, não é só falta de tempo): "Itens Ganhos" em granularidade nacional (testei `tipos_documento=item` no PNCP, retornou 0 — exigiria abrir processo por processo, inviável ao vivo); TCU-Inidôneos e CNJ-CNIA (sem API pública, só formulário — não fazer scraping); licitanet.com.br (site comercial de terceiros, sem API pública documentada — não fazer scraping).
- **Nada é persistido** (decisão explícita do usuário) — toda consulta é refeita do zero a cada análise. Só `concorrentes.cnpj` (opcional, no cadastro) é salvo, para o atalho "Analisar" na linha do concorrente.
- `modules/_crud.js` ganhou um hook genérico `config.extraRowActions(record)` (opcional, retrocompatível) para permitir esse botão "Analisar" por linha sem duplicar a fábrica de CRUD.
- Exportação para Excel reaproveita o padrão já usado em `relatorios.js` (`window.XLSX.utils.aoa_to_sheet` + `writeFile`).
- Validado com harness isolado chamando as APIs **reais** (não mockadas, já que são públicas e gratuitas) — resultado bateu com a referência visual ponto a ponto.

## Pendências conhecidas (próximos passos sugeridos)

- Bloco de **Habilitação** e **Monitoramento** (vistos na referência visual do Licitei) ainda não têm equivalente no GestLicit.
- A listagem de "Fase de Lance / Sessão Pública / Homologada / Desistidas" (chips com contador, vistos na referência de tags do Licitei) foi conscientemente deixada de fora — só o sistema de tags livres (criar/atribuir/filtrar) foi implementado, sem essas visões fixas.
- Próxima camada do fluxo financeiro: **Pedidos → Entregas → Faturamento → Recebimentos**, ainda não implementada (Empenho, bloco 4, é só a primeira etapa depois de Ata/Contrato).
- Relatório de Resultado Mensal em PDF é texto simples (sem tabela formatada); considerar adicionar `jspdf-autotable` se for necessário um layout mais profissional para impressão/compartilhamento externo.
- "Itens Ganhos" em granularidade nacional (Análise de Concorrente) e Certidões TCU/CNJ não têm fonte de dados pública gratuita viável — ver Bloco 5 para o porquê, antes de tentar de novo.
