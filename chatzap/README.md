## Chatzap – App de mensagens local com sync opcional

Stack: React + TypeScript + Vite + Tailwind CSS + PouchDB (local) + CouchDB (remoto opcional)

### Rodando local

1. Instale deps:
   ```bash
   npm install
   ```
2. (Opcional) Suba o CouchDB via Docker:
   ```bash
   docker compose up -d
   cp .env.example .env
   # ajuste VITE_COUCHDB_URL se necessário
   ```
3. Rode o app:
   ```bash
   npm run dev
   ```

O app funciona 100% offline. Se `VITE_COUCHDB_URL` estiver definido, a sincronização live é habilitada.

### Estrutura

- `src/lib/db.ts`: modelos, índices, seed, e sync
- `docker-compose.yml`: CouchDB com DB `chatzap`
- `.env.example`: URL de sync

### Build

```bash
npm run build
```
