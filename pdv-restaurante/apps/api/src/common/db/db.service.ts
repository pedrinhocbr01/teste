import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { Pool, types } from 'pg';
import * as bcrypt from 'bcryptjs';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

// pg retorna bigint (int8) como string por padrão — convertemos para Number
// (ids e contagens de restaurante nunca estouram o MAX_SAFE_INTEGER).
types.setTypeParser(20, (v: string) => parseInt(v, 10));
// numeric vem como string — mantemos string no driver e convertemos nos mappers.

type QueryFn = (sql: string, params?: any[]) => Promise<any[]>;

/**
 * Camada de banco da Fase 1.
 *
 * - Produção/docker (DATABASE_URL definido): pool `pg` no PostgreSQL real.
 * - Dev (sem DATABASE_URL): Postgres embutido (PGlite, mesma engine do
 *   `npm test`), carregando db/schema.sql + db/seed.sql — triggers, views e
 *   regras de negócio idênticos aos de produção.
 *
 * Todo SQL usa placeholders $1 (suportados pelos dois drivers).
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private pool?: Pool;
  private pglite?: any;
  private usePglite = false;

  get driver(): 'pg' | 'pglite' {
    return this.usePglite ? 'pglite' : 'pg';
  }

  async onModuleInit() {
    const url = (process.env.DATABASE_URL || '').trim();
    if (url) {
      this.pool = new Pool({ connectionString: url });
      await this.pool.query('SELECT 1');
      this.logger.log('[db] conectado ao PostgreSQL (pg pool)');
    } else {
      // import dinâmico: evita problema de require CJS/ESM no boot
      const { PGlite } = await import('@electric-sql/pglite');
      const dataDir = (process.env.PGLITE_DIR || '').trim();
      this.pglite = dataDir ? new PGlite(dataDir) : new PGlite();
      await this.pglite.waitReady;
      this.usePglite = true;
      await this.ensureDevSchema(dataDir !== '');
      this.logger.log(
        `[db] PGlite embutido pronto (${dataDir ? `disco: ${dataDir}` : 'memória'})`,
      );
    }
    await this.fixSeedPins();
  }

  async onModuleDestroy() {
    if (this.pool) await this.pool.end().catch(() => undefined);
    if (this.pglite) await this.pglite.close().catch(() => undefined);
  }

  /** Localiza db/schema.sql e db/seed.sql a partir de vários pontos de partida. */
  private resolveDbFile(name: string): string {
    const envVar = name === 'schema.sql' ? process.env.SCHEMA_PATH : process.env.SEED_PATH;
    const candidates = [
      envVar,
      // src/common/db -> raiz pdv-restaurante (dev ts-node e dist compilado)
      join(__dirname, '..', '..', '..', '..', '..', 'db', name),
      join(process.cwd(), 'db', name),
      join(process.cwd(), '..', '..', 'db', name),
      join(dirname(process.execPath), 'db', name),
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    throw new Error(
      `[db] não achei db/${name}. Rode a API a partir de pdv-restaurante/apps/api ` +
        `ou defina SCHEMA_PATH/SEED_PATH. Tentados: ${candidates.join(' | ')}`,
    );
  }

  private async ensureDevSchema(persistente: boolean) {
    if (persistente) {
      const r = await this.pglite.query(
        `SELECT to_regclass('public.usuario') AS t`,
      );
      if (r.rows?.[0]?.t) {
        this.logger.log('[db] PGlite persistente já tem schema — pulando seed');
        return;
      }
    }
    const schema = readFileSync(this.resolveDbFile('schema.sql'), 'utf8');
    const seed = readFileSync(this.resolveDbFile('seed.sql'), 'utf8');
    await this.pglite.exec(schema);
    await this.pglite.exec(seed);
    this.logger.log('[db] schema.sql + seed.sql aplicados no PGlite');
  }

  /**
   * O seed traz pin_hash placeholder ('TROCAR-POR-BCRYPT-pinNNNN').
   * Na primeira subida (qualquer driver) convertemos para bcrypt de verdade:
   * Ana 1111, Bruno 2222, Carla 3333, Roberto 4444, Diego 5555.
   */
  private async fixSeedPins() {
    const rows = await this.query<{ id: number; pin_hash: string }>(
      `SELECT id, pin_hash FROM usuario WHERE pin_hash LIKE 'TROCAR%'`,
    );
    if (rows.length === 0) return;
    const pins: Record<number, string> = { 1: '1111', 2: '2222', 3: '3333', 4: '4444', 5: '5555' };
    for (const r of rows) {
      const pin = pins[Number(r.id)] || '1234';
      const hash = bcrypt.hashSync(pin, 10);
      await this.query(`UPDATE usuario SET pin_hash = $1 WHERE id = $2`, [hash, r.id]);
    }
    this.logger.log(`[db] ${rows.length} PIN(s) do seed convertidos para bcrypt`);
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.usePglite) {
      const res = await this.pool!.query(sql, params);
      return res.rows as T[];
    }
    const res = await this.pglite.query(sql, params);
    return (res.rows ?? []) as T[];
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /** Para INSERT/UPDATE/DELETE — retorna linhas afetadas. */
  async execute(sql: string, params: any[] = []): Promise<number> {
    if (!this.usePglite) {
      const res = await this.pool!.query(sql, params);
      return res.rowCount ?? 0;
    }
    const res = await this.pglite.query(sql, params);
    return Number(res.affectedRows ?? res.rowCount ?? 0);
  }

  /**
   * Fila de transações do PGlite: ele usa UMA conexão compartilhada, então
   * dois BEGINs concorrentes misturariam os statements na mesma transação.
   * O mutex serializa as transações (no pg real cada uma tem sua conexão).
   */
  private txQueue: Promise<unknown> = Promise.resolve();
  /** Transação "corrente" (p/ transaction() aninhada entrar na tx de fora). */
  private txStore = new AsyncLocalStorage<{ q: QueryFn }>();

  async transaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
    const nested = this.txStore.getStore();
    // aninhada: participa da transação de fora (atômica de verdade, sem deadlock no mutex)
    if (nested) return fn(nested.q);
    if (!this.usePglite) {
      const client = await this.pool!.connect();
      try {
        await client.query('BEGIN');
        const q: QueryFn = async (sql, params = []) =>
          (await client.query(sql, params)).rows;
        const result = await this.txStore.run({ q }, () => fn(q));
        await client.query('COMMIT');
        return result;
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* noop */
        }
        throw e;
      } finally {
        client.release();
      }
    }
    const run = () => this.pgliteTx(fn);
    const mine = this.txQueue.then(run, run);
    // a fila nunca "quebra": erro de uma tx não trava as próximas
    this.txQueue = mine.catch(() => undefined);
    return mine;
  }

  private async pgliteTx<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
    const q: QueryFn = (sql, params = []) => this.query(sql, params);
    return this.txStore.run({ q }, async () => {
      await q('BEGIN');
      try {
        const result = await fn(q);
        await q('COMMIT');
        return result;
      } catch (e) {
        try {
          await q('ROLLBACK');
        } catch {
          /* noop */
        }
        throw e;
      }
    });
  }
}

/** Converte NUMERIC (string no pg) para number. */
export function num(v: any): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
