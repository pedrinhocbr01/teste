// ============================================================================
// Teste de fumaça do schema: roda schema.sql + seed.sql num PostgreSQL real
// (PGlite/WASM, sem precisar de servidor instalado) e exercita os 3 módulos:
//   1. Envio do pedido  -> baixa automática pela ficha técnica + impressão
//   2. Cancelamento      -> estorno no estoque
//   3. Conta dividida    -> taxa de serviço, rateio por item, fechamento
//   4. Caixa             -> sangria, formas de pagamento, valor esperado
//   5. Alertas de estoque, mapa de mesas, guarda do rateio
//
// Uso:  npm i -D @electric-sql/pglite && node db/teste-schema.mjs
// ============================================================================
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DB = dirname(fileURLToPath(import.meta.url));
const db = new PGlite();
let falhas = 0;

const exec = (f) => db.exec(readFileSync(join(DB, f), 'utf8'));
const q = (sql) => db.query(sql).then(r => r.rows);

function check(label, ok) {
  console.log(` ${ok ? '✔' : '✘'} ${label}`);
  if (!ok) falhas++;
}
async function espera(label, sql, esperado) {
  const rows = await q(sql);
  const achado = Number(rows[0]?.v ?? rows[0]?.[Object.keys(rows[0] ?? {})[0]]);
  check(`${label} (esperado ${esperado}, obtido ${achado})`, Math.abs(achado - esperado) < 0.0015);
}

console.log('\n[1] Aplicando schema.sql ...');   await exec('schema.sql');
console.log('[2] Aplicando seed.sql ...');       await exec('seed.sql');

console.log('\n== MÓDULO ATENDIMENTO: enviar pedido para produção ==');
// O app faria: POST /pedidos/1/enviar { tipo: 'ENTRADA', itens: [1,2] } ...
await q(`INSERT INTO remessa (pedido_id, tipo, enviado_por) VALUES (1, 'ENTRADA', 1)`);
await q(`UPDATE pedido_item SET remessa_id = 1, status = 'ENVIADO', atualizado_por = 1
         WHERE id IN (1, 2)`);
await q(`INSERT INTO remessa (pedido_id, tipo, enviado_por) VALUES (1, 'PRINCIPAL', 1)`);
await q(`UPDATE pedido_item SET remessa_id = 2, status = 'ENVIADO', atualizado_por = 1
         WHERE id IN (3, 4, 5)`);

check('mesa 3 virou OCUPADA (trigger de pedido)',
  (await q(`SELECT status AS v FROM mesa WHERE numero = 3`))[0].v === 'OCUPADA');
check('itens saíram de RASCUNHO para ENVIADO',
  (await q(`SELECT COUNT(*)::int AS v FROM pedido_item WHERE status='ENVIADO'`))[0].v === 5);

console.log('\n== MÓDULO ESTOQUE: baixa automática via ficha técnica ==');
// Picanha: 0,500 kg líquido / (1 - 12%) = 0,568 kg bruto
await espera('saldo picanha após venda (5,500 - 0,568)',
  `SELECT ROUND(saldo, 3) AS v FROM vw_saldo_insumo WHERE nome = 'Picanha matura'`, 4.932);
// Tomate (bruschetta): 0,100 / (1 - 12%) = 0,114
await espera('saldo tomate (6,000 - 0,114)',
  `SELECT ROUND(saldo, 3) AS v FROM vw_saldo_insumo WHERE nome = 'Tomate italiano'`, 5.886);
// Long neck sem ficha: baixa 1:1 do insumo vinculado (2 un)
await espera('saldo long neck (48 - 2)',
  `SELECT ROUND(saldo, 3) AS v FROM vw_saldo_insumo WHERE nome = 'Cerveja long neck 355ml'`, 46);

console.log('\n== Impressão: 1 job POR ESTAÇÃO (mesma remessa cozinha+bar) ==');
const jobs = await q(`
  SELECT e.tipo AS estacao, COUNT(*)::int AS n
  FROM impressao_log l JOIN estacao e ON e.id = l.estacao_id
  WHERE l.status = 'PENDENTE' GROUP BY e.tipo ORDER BY e.tipo`);
check(`fila tem ${jobs.map(j => `${j.estacao}:${j.n}`).join(' ')}`,
  jobs.length === 2 && jobs.find(j => j.estacao === 'BAR').n === 2
              && jobs.find(j => j.estacao === 'COZINHA').n === 2);

console.log('\n== Cancelamento: estorno automático do item long neck ==');
await q(`UPDATE pedido_item SET status = 'CANCELADO', motivo_cancelamento = 'Cliente desistiu',
         atualizado_por = 1 WHERE id = 5`);
await espera('long neck voltou ao estoque (46 + 2)',
  `SELECT ROUND(saldo, 3) AS v FROM vw_saldo_insumo WHERE nome = 'Cerveja long neck 355ml'`, 48);
check('movimento de estorno registrado com motivo',
  (await q(`SELECT COUNT(*)::int AS v FROM estoque_movimento
            WHERE tipo='AJUSTE_POSITIVO' AND origem='CANCELAMENTO_ITEM'`))[0].v === 1);

console.log('\n== Alerta de estoque mínimo ==');
const alertas = await q(`SELECT nome, nivel FROM vw_alerta_estoque
                          WHERE nivel <> 'OK' ORDER BY nivel, nome`);
console.table(alertas);
check('picanha entrou em alerta (4,932 <= mínimo 5,000)',
  alertas.some(a => a.nome === 'Picanha matura' && a.nivel === 'ABAIXO_DO_MINIMO'));

console.log('\n== MÓDULO CAIXA: conta única na mesa 3, serviço 10% e PIX ==');
// "imprimir conta": cria a conta e mapeia os itens enviados (não cancelados)
await q(`UPDATE mesa SET status = 'AGUARDANDO_CONTA' WHERE numero = 3`);
await q(`INSERT INTO conta (id, pedido_id, descricao, incluir_servico, servico_pct)
         VALUES (1, 1, 'Conta — Mesa 3', TRUE, 10.00)`);
await q(`INSERT INTO conta_item (conta_id, pedido_item_id, quantidade)
         SELECT 1, pi.id, pi.quantidade FROM pedido_item pi
         WHERE pi.pedido_id = 1 AND pi.status <> 'CANCELADO' AND pi.status <> 'RASCUNHO'`);

// subtotal: 26,00 + 39,80 + 129,90 + 54,90 = 250,60 | serviço 25,06 | total 275,66
await espera('subtotal da conta 1',
  `SELECT subtotal_itens AS v FROM vw_conta_resumo WHERE conta_id = 1`, 250.60);
await espera('serviço 10% calculado',
  `SELECT servico_valor AS v FROM vw_conta_resumo WHERE conta_id = 1`, 25.06);
await espera('total da conta 1',
  `SELECT total AS v FROM vw_conta_resumo WHERE conta_id = 1`, 275.66);

// paga: PIX 225,66 + dinheiro 50,00 (sem troco)
await q(`INSERT INTO pagamento (conta_id, caixa_id, forma, valor, referencia, status)
         VALUES (1, 1, 'PIX', 225.66, 'E201...', 'APROVADO'),
                (1, 1, 'DINHEIRO', 50.00, NULL, 'APROVADO')`);
const resumoConta1 = (await q(
  `SELECT (saldo = 0) AS quitada FROM vw_conta_resumo WHERE conta_id = 1`))[0];
check('conta quitada (saldo zero)', resumoConta1.quitada);

await db.exec(`UPDATE conta SET status = 'FECHADA', fechada_em = now() WHERE id = 1;
               UPDATE pedido SET status = 'FECHADO', fechado_em = now() WHERE id = 1;`);
check('mesa liberada ao fechar o pedido (trigger)',
  (await q(`SELECT status AS v FROM mesa WHERE numero = 3`))[0].v === 'LIVRE');

console.log('\n== Divisão de conta já existente na mesa 5 (por item + igualitária) ==');
const contas5 = await q(`SELECT descricao, total, pago, saldo FROM vw_conta_resumo WHERE pedido_id = 2`);
console.table(contas5);
check('2 contas na mesa 5', contas5.length === 2);
check('rateio igualitário usa valor fixo (19,58)', contas5.some(c => Number(c.total) === 19.58));

console.log('\n== Guarda de integridade: alocar 99 de um item de 1 unidade ==');
let bloqueado = false;
try {
  await q(`INSERT INTO conta_item (conta_id, pedido_item_id, quantidade) VALUES (2, 6, 99)`);
} catch { bloqueado = true; }
check('trigger impede rateio acima do que foi pedido', bloqueado);

console.log('\n== Fechamento de caixa ==');
// esperado = 200 (fundo) + 56,50 dinheiro + 225,66 pix − 150 (sangria) = 332,16
await espera('valor em espécie esperado no caixa',
  `SELECT valor_esperado AS v FROM vw_caixa_resumo WHERE caixa_id = 1`, 332.16);
await q(`UPDATE caixa c SET status = 'FECHADO', fechado_em = now(),
         valor_contado = v.valor_esperado, diferenca = 0
         FROM vw_caixa_resumo v WHERE c.id = v.caixa_id AND c.id = 1`);
check('fechamento registrado com diferença zero',
  (await q(`SELECT (valor_contado = 332.16 AND diferenca = 0) AS ok FROM caixa WHERE id = 1`))[0].ok);

console.log('\n== Mapa de mesas (tempo de ocupação) e custo/margem ==');
console.table(await q(`SELECT numero, area, status, garcom, ocupacao_min FROM vw_mapa_mesas WHERE status <> 'LIVRE'`));
console.table(await q(`SELECT nome, preco, custo_por_porcao, margem_pct FROM vw_custo_produto
                        WHERE nome IN ('Picanha na Chapa','Pudim de Leite da Vovó','Caipirinha Tradicional')`));

console.log('\n== Gorjeta acumulada por garçom (mês) ==');
console.table(await q(`SELECT nome, mes, gorjeta_total FROM vw_gorjeta_garcom`));

console.log(falhas === 0
  ? '\n✅ TODOS OS TESTES PASSARAM — schema consistente com os 3 módulos'
  : `\n❌ ${falhas} teste(s) falharam`);
process.exit(falhas === 0 ? 0 : 1);
