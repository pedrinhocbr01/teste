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
| 1 | API: cadastros (insumos, produtos, fichas, mesas) + auth PIN; PWA garçom: mesa → rascunho → remessas → envio (sem impressão ainda: fila no banco já cria o job) |
| 2 | Print agent ESC/POS + reimpressão de item cancelado; KDS da cozinha/pronto (WS) |
| 3 | Contas: impressão de conta, divisão por item/igualitária, 10%, pagamentos parciais; caixa: abertura, sangria/suprimento, fechamento com conferência |
| 4 | Estoque avançado: recebimento de compra c/ atualização de custo, inventário c/ diferença, custo-margem por prato, CMV e perda |
| 5 | Relatórios (PRD/gerencial), Pix com QR dinâmico (gateway), multi-filia, NF-e/CF-e se exigido pelo município |

## 7. Avisos de domínio (Brasil)

- **Fiscal**: restaurante geralmente usa **SAT/CF-e/Serie CUPOM** dependendo do município/estado — deixar `pagamento`/`item` prontos p/ um módulo fiscal futuro (o schema já guarda `referencia`, formas e snapshots de preço).
- **Troco**: dinheiro guarda `valor` recebido e `valor_troco`; o caixa confere o líquido.
- **Combo "serve 2"**: picanha com peso na ficha e preço fixo — custo sai por porção; se vender meia-porção, é outro produto com outra ficha (não dividir quantidade fracionária de prato).
- **Perda do dia**: registrar `PERDA` no estoque (kitchen waste) — sem isso o CMV mente.
