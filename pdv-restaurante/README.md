# 🍽️ PDV Restaurante — Arquitetura & Banco de Dados

Sistema web de **PDV + gestão para restaurante à la carte**, em 3 módulos:
**Estoque c/ Ficha Técnica**, **Atendimento (Garçom)** e **Caixa & Mesas**.

> Este repositório contém a fundação do projeto: arquitetura proposta,
> schema PostgreSQL completo (validado com testes), seed realista e ambiente
> docker para desenvolvimento.

---

## 1. Stack recomendada (e por quê)

| Camada        | Escolha                                     | Por quê para esse domínio |
|---------------|---------------------------------------------|---------------------------|
| **Banco**     | **PostgreSQL 15+**                          | Regras de negócio (baixa de estoque, rateio, status de mesa) vão p/ triggers/views; é o coração do sistema. NUMERIC para dinheiro/gramas sem erro de ponto flutuante. |
| **Backend**   | **NestJS (Node + TypeScript) + Prisma**     | Módulos (estoque/atendimento/caixa) casam com `@Module` do Nest; DI e guards p/ RBAC (garçom ≠ caixa ≠ cozinha). Prisma gera tipos p/ todo o stack. Alternativas válidas: Laravel+Eloquent (se o time for PHP) ou Rails (ótimo p/ 1 dev full-cycle). |
| **REST + WS** | API REST + **Socket.IO** (gateway do Nest)  | Mapa de mesas, comanda da cozinha e "pronto ⇒ toca som/avisa garçom" são tempo real. WS é melhor que polling em 4G de restaurante. |
| **Frontend**  | **Next.js (App Router) + Tailwind + shadcn/ui** | **Um app, três caras**: painel de gestão (desktop), tela de caixa (desktop, atalhos de teclado) e **PWA do garçom** (mobile-first, instalável, botões grandes, funciona com tela bloqueada via service worker + fila offline). |
| **Impressão** | **Print Agent local (Node/Electron)**       | Navegador não fala ESC/POS. Um mini-serviço roda no PC do caixa (mesma LAN), consome a fila `impressao_log` e imprime na porta 9100 da térmica (Epson TM, Elgin, Bematech). Se a internet cair, a cozinha continua imprimindo — e a fila reassume quando religar. |
| **Infra dev/prod** | **Docker Compose** (api + web + postgres + print-agent) num mini-PC no restaurante; backups p/ S3 | Restaurante tem internet ruim: o sistema crítico roda **na LAN**; a nuvem é só backup/relatórios/multi-unidade. Redis é opcional (cache de pub/sub p/ múltiplas instâncias). |
| **Autenticação** | JWT curto + **PIN numérico** p/ operações rápidas | Garçom troca de estação a cada turno; PIN de 4–6 dígitos por função é o padrão de PDV. |

**Não** recomendo Firebase/Supabase-only ou app 100% client-side (estilo PouchDB):
PDV precisa de **transações ACID** (baixa de estoque + conta + caixa no mesmo commit),
constraints e triggers — isso só um relacional de verdade entrega bem.

---

## 2. Componentes (visão de sistema)

```
 ┌─────────────────────────── LAN do restaurante ────────────────────────────┐
 │                                                                            │
 │  📱 PWA Garçom (Next.js)     🖥️ Caixa/Gestão (Next.js)   📺 Comanda       │
 │        │  REST + WS                │  REST + WS            Cozinha/Bar    │
 │        ▼                           ▼        ▲   (tela kds + print agent)  │
 │  ┌───────────────────────────────────────────────┐                        │
 │  │  API NestJS  ──► PostgreSQL (schema.sql)      │                        │
 │  │   • pedidos/contas/caixa  • WS rooms: mesa,   │                        │
 │  │   • estoque + ficha       cozinha, caixa      │                        │
 │  └───────────────▲───────────────────────────────┘                        │
 │                  │ fila impressao_log (tabela no próprio banco)          │
 │           🖨️ Print Agent (Node) ──► Epson/Elgin ESC/POS :9100            │
 └──────────────────┼────────────────────────────────────────────────────────┘
                    │ HTTPS (opcional)
              Nuvem: backup, relatórios, multi-filia, Pix (gateway)
```

---

## 3. Modelo de dados (o coração)

Schema completo e comentado em [`db/schema.sql`](db/schema.sql), dados de exemplo em [`db/seed.sql`](db/seed.sql).

```mermaid
erDiagram
  FORNECEDOR ||--o{ INSUMO : fornece
  UNIDADE_MEDIDA ||--o{ INSUMO : "mede"
  INSUMO ||--o{ ESTOQUE_MOVIMENTO : "saldos são sempre movimentos"
  ESTACAO ||--o{ CATEGORIA : "roteia impressão"
  ESTACAO ||--|| IMPRESSORA
  CATEGORIA ||--o{ PRODUTO
  PRODUTO ||--o| FICHA_TECNICA : "1 por prato"
  FICHA_TECNICA ||--|{ FICHA_TECNICA_ITEM
  INSUMO ||--o{ FICHA_TECNICA_ITEM : "usa"
  PRODUTO ||--o{ FICHA_TECNICA_ITEM : "compõe"
  AREA ||--o{ MESA
  MESA ||--o{ PEDIDO
  PEDIDO ||--o{ REMESSA : "onda: entrada/prato/sobremesa"
  REMESSA ||--o{ PEDIDO_ITEM
  PRODUTO ||--o{ PEDIDO_ITEM
  PEDIDO_ITEM ||--o{ ESTOQUE_MOVIMENTO : "baixa/estorno automático"
  REMESSA ||--o{ IMPRESSAO_LOG
  PEDIDO ||--o{ CONTA : "1 conta por ponta da mesa"
  CONTA ||--o{ CONTA_ITEM : "divisão POR ITEM"
  PEDIDO_ITEM ||--o{ CONTA_ITEM
  CONTA ||--o{ PAGAMENTO
  CAIXA ||--o{ PAGAMENTO
  CAIXA ||--o{ CAIXA_MOVIMENTO : "sangria/suprimento"
  USUARIO ||--o{ PEDIDO : "garçom"
```

### Como cada requisito vira tabela

**Módulo 1 — Estoque + Ficha Técnica**
- `insumo` (ingredientes: picanha em kg, limão em un, cachaça em l) com
  `estoque_minimo`, `estoque_maximo`, custo e **unidade de compra ≠ unidade de
  estoque** (`fator_compra`: 1 caixa de long neck = 12 un).
- `ficha_tecnica` + `ficha_tecnica_item`: quantidade **líquida** por porção +
  `perca_pct` (limpeza/osso) + `rendimento` (a receita de pudim rende 10 fatias).
- **Baixa automática**: trigger `tg_item_baixa_estoque` — quando o item do pedido
  vira `ENVIADO` (configurável `ENVIO|PRONTO|ENTREGA`), insere `SAIDA_VENDA`
  com `qtd_bruta = líquido/(1−perca) × unidades ÷ rendimento`. Cancelou o item?
  Estorno automático (`AJUSTE_POSITIVO` com motivo "item #N cancelado").
- `produto.insumo_vinculado_id` resolve bebidas fechadas (long neck não tem
  receita — é o próprio insumo; venda dá baixa 1:1).
- Saldo = soma dos `estoque_movimento` (`vw_saldo_insumo`); alerta é a view
  `vw_alerta_estoque` com **dias de cobertura** e sugestão de compra.

**Módulo 2 — Atendimento (Garçom)**
- `mesa` com `status (LIVRE|OCUPADA|AGUARDANDO_CONTA|RESERVADA)` + `pos_x/pos_y`
  para o **mapa visual**; trigger libera a mesa quando o pedido fecha, e um
  índice único garante **1 pedido aberto por mesa**.
- `remessa` = a separação **por tempo** (1ª remessa: entradas; 2ª: pratos;
  3ª: sobremesas). O garçom monta itens em `RASCUNHO`, escolhe a onda e aperta
  *Enviar*.
- `pedido_item.observacao` (ponto da carne, sem cebola) e `ponto_carne`
  estruturado, impressos na comanda e na tela da cozinha.
- **Impressão certa**: `categoria → estacao → impressora`; `produto` pode
  sobrescrever a estação. Trigger `tg_item_fila_impressao` cria **1 job por
  (remessa, estação)** — uma remessa com caipirinha + bruschetta gera 1 job no
  bar e 1 na cozinha. Falhou a impressora? `tentativas++`, job fica `FALHA` e
  o print agent re-tenta.

**Módulo 3 — Caixa & Gestão de Mesas**
- `vw_mapa_mesas`: status + `ocupacao_min` (tempo de ocupação) em tempo real.
- **Divisão de conta**: `conta` = "ponta" da mesa. *Por item* → `conta_item`
  (com quantidade fracionável: ½ pizza em cada conta, guardado por trigger que
  proíbe alocar mais do que foi pedido). *Igualitária* → `conta.valor_rateio`.
- **10% do garçom**: `incluir_servico` + `servico_pct` (snapshot) por conta;
  `vw_gorjeta_garcom` fecha a folha do mês por garçom.
- **Caixa**: `caixa` (abertura c/ fundo) → `pagamento` por `forma`
  (PIX/Dinheiro/Crédito/Débito/Vale) e `caixa_movimento` (SANGRIA/SUPRIMENTO);
  `vw_caixa_resumo` mostra `valor_esperado` vs `valor_contado` → `diferenca`.

---

## 4. Estrutura de código proposta (monorepo)

```
pdv-restaurante/
├── db/                      # ✅ JÁ EXISTE: schema.sql, seed.sql, teste-schema.mjs
├── apps/
│   ├── api/                 # NestJS: módulos estoque, cardapio, atendimento,
│   │   │                    #   contas, caixa, relatorios + ws-gateway (Socket.IO)
│   │   └── src/modules/**
│   ├── web/                 # Next.js: /gestao, /caixa, /cozinha (KDS), /mesa (PWA garçom)
│   └── print-agent/         # Node: consome impressao_log, ESC/POS :9100, drawer, balança
└── packages/
    ├── db/                  # prisma schema + migrations (geradas do schema.sql p/ conveniência)
    └── shared/              # tipos zod, formatação (R$, g/kg/ml), máscaras
```

Regra de ouro: **a regra de negócio crítica fica no banco** (baixa de estoque,
integridade do rateio, status de mesa) — a API orquestra, o front só reflete.
Assim o print agent, o KDS e o app do garçom nunca "discordam" entre si.

## 5. Como rodar

```bash
docker compose up -d db          # Postgres 16 em localhost:5433
docker compose exec db psql -U pdv -d pdv < db/schema.sql
docker compose exec db psql -U pdv -d pdv < db/seed.sql

# ou valide o schema SEM instalar nada (Postgres WASM):
npm install
npm test                         # roda db/teste-schema.mjs (19 asserções)
```

## 6. Roadmap sugerido

| Fase | Entrega |
|------|---------|
| 0 | ✅ Schema + seed + regras no banco (este repositório) |
| 1 | ✅ **API pronta (esta branch)**: cadastros + auth PIN + atendimento (pedidos/remessas/envio) + WS + fila p/ print-agent · 🔲 PWA do garçom (Next.js) — demo provisória em `/demo.html` |
| 2 | ✅ **Pronto (esta branch)**: print-agent ESC/POS (:9100, modo virtual p/ dev) + ticket automático de cancelamento + reimpressão manual + KDS (`/kds.html`) em tempo real |
| 3 | ✅ **Pronto (esta branch)**: contas (pedir conta, divisão por item/igualitária, 10%, pagamentos parciais, estorno, recibo) + caixa (abertura, sangria/suprimento, fechamento com conferência) + tela `/caixa.html` |
| 4 | Estoque avançado: recebimento de compra c/ atualização de custo, inventário c/ diferença, custo-margem por prato, CMV e perda |
| 5 | Relatórios (PRD/gerencial), Pix com QR dinâmico (gateway), multi-filia, NF-e/CF-e se exigido pelo município |

## 7. Avisos de domínio (Brasil)

- **Fiscal**: restaurante geralmente usa **SAT/CF-e/Serie CUPOM** dependendo do município/estado — deixar `pagamento`/`item` prontos p/ um módulo fiscal futuro (o schema já guarda `referencia`, formas e snapshots de preço).
- **Troco**: dinheiro guarda `valor` recebido e `valor_troco`; o caixa confere o líquido.
- **Combo "serve 2"**: picanha com peso na ficha e preço fixo — custo sai por porção; se vender meia-porção, é outro produto com outra ficha (não dividir quantidade fracionária de prato).
- **Perda do dia**: registrar `PERDA` no estoque (kitchen waste) — sem isso o CMV mente.

---

## 8. Fase 1 — API NestJS (nesta branch)

Código em `apps/api` (NestJS 10 + Socket.IO) e modelo Prisma em
`packages/db/schema.prisma` (tipos + conferência de drift; views/triggers
continuam no `schema.sql`).

### Como rodar (2 modos)

```bash
# A) Dev rápido — SEM docker/postgres (banco embutido PGlite em memória):
cd apps/api
npm install
npm run start:dev     # http://localhost:3001 — demo: /demo.html — health: /health

# B) Produção/docker — Postgres real:
cd pdv-restaurante
docker compose up -d --build   # db (5433) + api (3001) + adminer (8081)
# a API usa DATABASE_URL=postgres://pdv:pdv@db:5432/pdv
```

Variáveis (`apps/api/.env`, ver `.env.example`): `PORT`, `DATABASE_URL`
(vazio = PGlite), `JWT_SECRET`, `JWT_EXPIRES_IN`, `PGLITE_DIR` (persistir dev).

### Teste de fumaça E2E (19 checks)

```bash
cd apps/api
npm run smoke   # build + sobe a API + fluxo garçom completo + derruba
```

Cobre: login PIN, 401 sem token, mapa (12 mesas), abrir pedido, trava de
1 pedido/mesa (409), rascunho com snapshot de preço, envio com 1 job por
estação, baixa automática de estoque, KDS avançando item, 403 de RBAC,
alertas e total do pedido.

### Login / PINs do seed

`POST /auth/pin` com `{ "email": "...", "pin": "1111" }` (ou `usuarioId`).
Na primeira subida a API converte os `pin_hash` placeholder do seed para
bcrypt: **Ana 1111 · Bruno 2222 · Carla 3333 · Roberto 4444 · Diego 5555**.
Use `Authorization: Bearer <access_token>` nas demais rotas.

### Endpoints principais

| Área | Rotas |
|------|-------|
| Auth | `POST /auth/pin` · `GET /auth/me` · `POST /auth/pin/trocar` |
| Usuários (gerente) | `GET/POST /usuarios` · `PATCH /usuarios/:id` · `POST /usuarios/:id/reset-pin` |
| Cardápio | `GET /estacoes` · `GET/POST /categorias` · `GET /produtos?q=&categoriaId=` · `GET /produtos/:id` (ficha+custo) · `PUT /produtos/:id/ficha` |
| Estoque | `GET /estoque/saldos` · `GET /estoque/alertas` · `GET/POST /insumos` · `POST /estoque/movimentos` (ENTRADA/AJUSTE/PERDA/CONSUMO — saída de venda é automática) |
| Mesas | `GET /areas` · `GET /mesas/mapa` · `GET /mesas/:id` · `POST/PATCH /mesas` |
| **Atendimento** | `POST /pedidos {mesaId}` · `POST /pedidos/:id/itens` (rascunho) · `PATCH/DELETE item` · **`POST /pedidos/:id/enviar {tipo, itemIds}`** (baixa estoque + jobs) · `PATCH .../status` (KDS) · `POST .../cancelar` |
| Impressão (Fase 2) | `GET /impressao-log?status=PENDENTE` · `GET/PATCH /impressao-log/:id` |
| Realtime | Socket.IO: `join {rooms: ["mesa:3","cozinha","bar","caixa"]}` → eventos `pedido.enviado`, `item.adicionado`, `item.status`, `mesa.status` |

Papéis (RBAC): `GARCOM · CAIXA · COZINHEIRO · BAR · GERENTE · ADMIN`
(escritas de cadastro = gerente; KDS = cozinha/bar; salão = garçom/caixa).

### Fluxo do garçom (demo `/demo.html`)

1. Login com PIN → 2. clica mesa LIVRE → Abrir pedido →
3. lança itens (rascunho, com obs/ponto) → 4. marca itens + tipo da onda →
**Enviar** → jobs na fila + baixa no estoque + evento no WS.

---

## 11. Auditoria — melhorias e correções (nesta branch)

Revisão completa das Fases 1–3 (28 itens). Smoke: 62 checks ✔ · Schema ✔ ·
E2E print-agent ✔.

### Dinheiro (alta)
- `fecharPedido` bloqueia item entregue sem cobertura em conta válida
  (rateio por valor fechado assume o pedido — responsabilidade do operador).
- Estorno bloqueado em caixa já fechado e em pedido fechado; registra quem
  estornou (`ESTORNO por <nome>`); escritas de conta exigem pedido aberto.
- Concorrência: pagamentos/divisões/conta/impressão sob `SELECT FOR UPDATE`
  no pedido + transações (aninhadas participam da de fora); unique parcial
  garante 1 caixa aberto por operador (409 na corrida).
- PGlite: mutex serializa transações (conexão única compartilhada).

### Segurança (alta)
- WS exige JWT no handshake; sala `caixa` restrita a CAIXA/GERENTE/ADMIN
  (telas e agente enviam o token).
- Login PIN: 5 erros = bloqueio 5 min (429); compare falso p/ usuário
  inexistente (anti-enumeração). CORS configurável via `CORS_ORIGIN`.

### Regras (média)
- Rateio: view deriva `servico_valor` do valor fechado → recibo mostra os
  10% e a gorjeta do garçom não zera (totais cobrados inalterados).
- Desconto/serviço/rateio nunca deixam o total abaixo do já pago; total
  nunca negativo; `fechar` rejeita saldo negativo.
- Cancelar item com pagamento → 400 (estornar antes); `cancelarPedido`
  cancela contas sem pagamento junto (nunca órfãs).
- Mesa: `OCUPADA`/`AGUARDANDO_CONTA` são do sistema; LIVRE/RESERVADA só sem
  pedido aberto; emite `mesa.status`.
- Impressão: claim atômico (`POST /impressao-log/claim`, status
  `EM_IMPRESSAO`, retomada após 5 min) — 2 agentes não duplicam; baixa
  restrita a COZINHA/BAR/GERENTE/ADMIN; re-ack → 409; job filtra item
  cancelado. Evento novo `conta.atualizada` no PATCH de conta.

### Robustez (baixa)
- Tetos: `servicoPct` ≤ 100 (DTO + CHECK), `partes` ≤ 50, `percaPct` 0–99,
  mínimos de insumo/movimento; filtros inválidos → 400 (não 500); catches
  23505/23503 faltantes; e-mail único + sem auto-bloqueio/último gerente;
  `valor_esperado_dinheiro` (gaveta) no resumo e na tela do caixa.

### Migração (banco existente)
Bancos criados antes desta mudança precisam (fora de transação p/ o enum):
`ALTER TYPE tipo_status_impressao ADD VALUE 'EM_IMPRESSAO';` + recriar
`ux_impressao_job`, `ux_caixa_aberto_operador`, `ux_usuario_email`, as views
`vw_conta_resumo`/`vw_caixa_resumo` e os CHECKs — ou reaplicar `schema.sql`
do zero (PGlite/dev já faz isso sozinho).

## 12. Fase 4 — Estoque avançado (nesta branch)

### Recebimento de compra (`POST /estoque/recebimento`, GERENTE/ADMIN)
- Nota atômica: vários insumos de uma vez, com `fornecedorId`,
  `documento` (NF-e) e observação opcional.
- Quantidade na **un. de compra** quando o insumo tem uma (saco/cx ×
  `fator_compra` → un. de estoque); sem un. de compra, entra direto.
- Item com `custoTotal` recalcula o **custo médio ponderado**
  `(saldo×custo + entrada×custo)/(saldo + entrada)` (saldo ≤ 0 assume o
  custo da entrada); item sem custo só soma saldo. Insumo repetido na
  nota → 400.

### Inventário (`/estoque/inventarios`, GERENTE/ADMIN)
- Um `ABERTO` por vez (2º → 409). Contagens na un. de estoque, com
  upsert por (inventário, insumo) e trava contra o mesmo insumo contado
  em dois inventários abertos.
- Detalhe mostra sistema × contado, diferença, valor ao custo médio e
  resumo (sobras/faltas/valor). Fechar exige ≥ 1 contagem e gera
  `AJUSTE_POSITIVO`/`AJUSTE_NEGATIVO` (origem `CONTAGEM`) por diferença
  não-zero; zerar não gera movimento. Cancelar descarta as contagens.
- Novas tabelas: `inventario` + `inventario_contagem` (bancos antigos:
  reaplicar o schema ou rodar o bloco "Inventário (Fase 4)" dele).

### Custos
- `GET /produtos/:id/custo`: ingrediente a ingrediente (qtd líquida →
  bruta pela perca → custo), custo da receita/porção e margem — mesma
  fórmula da baixa e da `vw_custo_produto`.
- `GET /produtos?margemAbaixoDe=X`: só pratos com margem < X%.
- `GET /estoque/cmv?de=&ate=`: CMV das baixas (`SAIDA_VENDA` − estornos
  de cancelamento) × receita por prato; `GET /estoque/perdas`: perdas
  avaliadas (custo do movimento ou atual) + consumo interno separado.
  Período default = mês corrente até hoje.
- Tela `/estoque.html`: recebimento, saldos, inventário, CMV, perdas e
  custo do prato (linkada em demo/KDS/caixa). Smoke: 83 checks ✔.

## 13. Correções garçom/mesa/caixa (nesta branch)

Caçadas exercitando o fluxo real (abrir → lançar → enviar → pedir conta
→ pagar → fechar) e confirmadas antes/depois no preview:

### Conta (a principal)
- Item lançado **depois** de pedir a conta sumia: o 2º "pedir conta"
  ignorava as sobras e o `fechar` travava a mesa ("sem conta cobrindo").
  Agora o `imprimir-conta` aloca as sobras na conta única aberta, ou abre
  uma conta nova só com elas quando a divisão é múltipla/rateio.
- Novo `POST /contas/:id/alocar-pendentes` (botão "＋ alocar pendentes"
  no caixa) p/ encher conta avulsa/rateio manual; hint que mandava alocar
  "na demo do garçom" (onde não há alocação) corrigida.

### Caixa
- `fechar` comparava o contado na **gaveta** com o esperado **total**
  (PIX/cartão juntos) → "falta" fantasma em todo dia com PIX. Agora
  confere contra `valor_esperado_dinheiro` e mostra o total geral como
  referência (`conferencia.esperado_total`); UI deixa claro que o contado
  é a espécie da gaveta.
- Sangria limitada ao esperado em espécie (com lock); serviço (10%) e
  desconto editáveis na tela (gorjeta é facultativa); botão "Fechar
  conta" quando o saldo zera; refresh por WS não apaga mais digitação.

### Garçom/mesa
- `demo.html`: produtos não carregavam após o login (select vazio →
  impossível lançar item); botão "🧾 Pedir conta" no pedido; troca de
  mesa via WS `leave`/`join` sem reconectar o socket; guards de envio.
- `GET /pedidos?status=` e `?mesaId=` inválidos davam 500 → 400.

### Produção (invisível no preview)
- `DbService.query/execute` ignoravam a transação corrente no Postgres
  real (pool direto) — escritas via `this.db` dentro de `transaction()`
  fugiam da tx. Agora usam a conexão da tx (com `rawQuery` p/ o PGlite
  não entrar em recursão). Smoke: 96 checks ✔ (13 novos).

## 14. Fase 5 (parte 1) — Relatórios gerenciais (nesta branch)

Módulo `relatorios` (GERENTE/ADMIN), período `?de=&ate=` (default mês
corrente até hoje), tela `/relatorios.html` linkada nas demais:

- `GET /relatorios/vendas`: recebido (pagamentos aprovados) total, por
  forma e por dia; pedidos fechados, ticket médio, descontos e serviço.
- `GET /relatorios/produtos`: curva ABC sobre itens vendidos (pedidos
  fechados, sem cancelados) — qtd, receita, % acumulado, classe A/B/C,
  CMV das baixas e margem bruta. `&limite=` (1–200, padrão 50).
- `GET /relatorios/categorias`: qtd e receita por categoria.
- `GET /relatorios/garcons`: pedidos, receita dos itens, ticket médio e
  serviço gerado por garçom.
- `GET /relatorios/mesas`: giro — ocupações, tempo médio (abertura →
  fechamento) e receita por mesa.
- `GET /relatorios/caixas`: turnos iniciados no período — vendido,
  suprimentos, sangrias e diferença de fechamento por operador.

Convenção: dinheiro = pagamento aprovado (`pago_em`); itens/categorias/
garçons/mesas = pedidos FECHADOS (`fechado_em`). Smoke: 106 checks ✔
(10 novos, por delta p/ não depender de dados acumulados).

Restante da Fase 5 (futuro): Pix com QR dinâmico (PSP), multi-filial e
fiscal (NFC-e/CF-e conforme município/UF).
