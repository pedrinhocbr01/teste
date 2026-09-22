# @pdv/db — modelo Prisma (Fase 1)

Este pacote espelha `db/schema.sql` em Prisma, para:

- **tipos** compartilhados (gerar `@prisma/client` e reusar enums no front);
- **conferir drift**: `prisma db pull` mostra se o banco desviou do schema;
- **base da Fase 2+**: migrar a API de SQL direto para Prisma onde fizer
  sentido (cadastros simples), mantendo SQL nas views/triggers.

## O que o Prisma NÃO gerencia aqui (de propósito)

- **views** (`vw_saldo_insumo`, `vw_mapa_mesas`, `vw_conta_resumo`, …) — a API
  as consome via SQL (`DbService`), igual ao `print-agent` vai consumir;
- **triggers/functions** (baixa de estoque, fila de impressão, status de mesa,
  trava de rateio) — fonte da verdade no `schema.sql`, testadas por `npm test`;
- **seed** — continua em `db/seed.sql` (aplicado pelo docker entrypoint e pelo
  modo dev PGlite da API).

## Uso

```bash
cd packages/db
npm install
# aponta para o Postgres real (docker):
DATABASE_URL=postgres://pdv:pdv@localhost:5433/pdv npx prisma generate
DATABASE_URL=postgres://pdv:pdv@localhost:5433/pdv npx prisma studio  # inspecionar
```
