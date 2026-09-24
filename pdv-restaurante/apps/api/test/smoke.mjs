// Teste de fumaça da API (E2E local com PGlite).
// Sobe dist/main.js numa porta aleatória, exercita o fluxo do garçom e derruba.
// Uso: npm run smoke   (faz build antes)
import { spawn } from 'node:child_process';

const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
let falhas = 0;

function check(label, ok, extra = '') {
  console.log(` ${ok ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) falhas++;
}

async function api(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

async function esperaHealth(proc, tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) return true;
    } catch { /* subindo... */ }
    await new Promise((r) => setTimeout(r, 500));
    if (proc.exitCode !== null) throw new Error(`API saiu com código ${proc.exitCode}`);
  }
  return false;
}

console.log('[smoke] subindo API (PGlite em memória)...');
const proc = spawn('node', ['dist/main.js'], {
  env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'smoke-test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
proc.stdout.on('data', (d) => (serverLog += d.toString()));
proc.stderr.on('data', (d) => (serverLog += d.toString()));

try {
  const ok = await esperaHealth(proc);
  check('API subiu (/health)', ok);
  if (!ok) throw new Error('health falhou:\n' + serverLog.slice(-2000));

  // 1. login PIN (seed: Ana/garçom 1111)
  const login = await api('/auth/pin', { method: 'POST', body: { email: 'ana@casadofogo.com', pin: '1111' } });
  check('login PIN garçom', login.status === 201 && !!login.data.access_token, `status=${login.status}`);
  const token = login.data.access_token;

  const negado = await api('/mesas/mapa');
  check('rota protegida sem token → 401', negado.status === 401, `status=${negado.status}`);

  // 2. mapa de mesas + cardápio
  const mapa = await api('/mesas/mapa', { token });
  check('mapa de mesas (12 mesas)', mapa.status === 200 && mapa.data.length === 12, `n=${mapa.data?.length}`);
  const mesaLivre = mapa.data.find((m) => m.status === 'LIVRE' && !m.pedido_id);
  check('existe mesa livre p/ teste', !!mesaLivre, mesaLivre && `mesa ${mesaLivre.numero}`);

  const produtos = await api('/produtos', { token });
  check('cardápio lista produtos', produtos.status === 200 && produtos.data.length >= 8);
  const bruschetta = produtos.data.find((p) => p.nome.includes('Bruschetta'));

  // 3. abrir pedido → trava de 1 pedido/mesa
  const pedido = await api('/pedidos', { method: 'POST', token, body: { mesaId: mesaLivre.mesa_id, observacao: 'smoke test' } });
  check('abrir pedido na mesa livre', pedido.status === 201 && pedido.data.id, `status=${pedido.status}`);
  const duplo = await api('/pedidos', { method: 'POST', token, body: { mesaId: mesaLivre.mesa_id } });
  check('2º pedido na mesma mesa → 409', duplo.status === 409, `status=${duplo.status}`);
  const pid = pedido.data.id;

  // 4. lançar itens em rascunho
  const item1 = await api(`/pedidos/${pid}/itens`, {
    method: 'POST', token,
    body: { produtoId: bruschetta.id, quantidade: 1, observacao: 'sem manjericão' },
  });
  check('lançar item (snapshot de preço)', item1.status === 201 && Number(item1.data.preco_unitario) === 26, JSON.stringify(item1.data));
  const item2 = await api(`/pedidos/${pid}/itens`, {
    method: 'POST', token,
    body: { produtoId: produtos.data.find((p) => p.nome.includes('Caipirinha')).id, quantidade: 2 },
  });
  check('lançar 2º item', item2.status === 201);

  // 5. enviar remessa → baixa de estoque + jobs por estação
  const saldoAntes = await api('/estoque/saldos', { token });
  const tomateAntes = Number(saldoAntes.data.find((s) => s.nome === 'Tomate italiano').saldo);
  const envio = await api(`/pedidos/${pid}/enviar`, {
    method: 'POST', token,
    body: { tipo: 'ENTRADA', itemIds: [item1.data.id, item2.data.id] },
  });
  check('enviar remessa ENTRADA', envio.status === 201 && envio.data.remessa?.id, `status=${envio.status}`);
  check('1 job por estação (cozinha+bar)', envio.data.jobs?.length === 2, `jobs=${envio.data.jobs?.length}`);
  const saldoDepois = await api('/estoque/saldos', { token });
  const tomateDepois = Number(saldoDepois.data.find((s) => s.nome === 'Tomate italiano').saldo);
  check(`baixa automática (tomate ${tomateAntes} → ${tomateDepois})`, tomateDepois < tomateAntes);

  const fila = await api('/impressao-log?status=PENDENTE', { token });
  check('fila de impressão tem jobs', fila.data.length >= 2);

  // 6. KDS avança + garçom não edita item enviado
  const loginCoz = await api('/auth/pin', { method: 'POST', body: { email: 'roberto@casadofogo.com', pin: '4444' } });
  const tokCoz = loginCoz.data.access_token;
  const adv = await api(`/pedidos/${pid}/itens/${item1.data.id}/status`, {
    method: 'PATCH', token: tokCoz, body: { status: 'EM_PREPARO' },
  });
  check('cozinha avança p/ EM_PREPARO', adv.status === 200, `status=${adv.status}`);
  const edit = await api(`/pedidos/${pid}/itens/${item1.data.id}`, {
    method: 'PATCH', token, body: { quantidade: 5 },
  });
  check('editar item enviado → 400', edit.status === 400, `status=${edit.status}`);

  // ---- FASE 2: KDS por estação ----
  const kdsCoz = await api('/kds/fila?estacao=COZINHA', { token: tokCoz });
  check('KDS cozinha lista bruschetta EM_PREPARO',
    kdsCoz.data.items?.some((i) => i.produto.includes('Bruschetta') && i.status === 'EM_PREPARO'),
    `itens=${kdsCoz.data.items?.length}`);
  const kdsBar = await api('/kds/fila?estacao=BAR', { token: tokCoz });
  check('KDS bar lista caipirinha ENVIADO',
    kdsBar.data.items?.some((i) => i.produto.includes('Caipirinha') && i.status === 'ENVIADO'));

  // ---- FASE 2: cancelar item enviado → ticket CANCELAMENTO ----
  const canc = await api(`/pedidos/${pid}/itens/${item1.data.id}/cancelar`, {
    method: 'POST', token, body: { motivo: 'Sem tomate hoje' },
  });
  check('cancelar item enviado (estorno)', canc.data?.acao === 'cancelado_com_estorno', JSON.stringify(canc.data));
  const cancJobs = await api('/impressao-log?status=PENDENTE&tipo=CANCELAMENTO', { token });
  check('ticket CANCELAMENTO na fila',
    cancJobs.data.length === 1 && /bruschetta/i.test(cancJobs.data[0].conteudo || ''),
    cancJobs.data[0]?.conteudo);
  const kdsCanc = await api('/kds/fila?estacao=COZINHA', { token: tokCoz });
  check('KDS mostra cancelados recentes',
    kdsCanc.data.cancelados?.some((i) => i.produto.includes('Bruschetta')));

  // ---- FASE 2: reimpressão manual ----
  const remId = envio.data.remessa.id;
  const estCoz = envio.data.jobs.find((j) => j.estacao_tipo === 'COZINHA').estacao_id;
  const re1 = await api(`/impressao-log/remessa/${remId}/reimprimir`, {
    method: 'POST', token, body: { estacaoId: estCoz },
  });
  check('reimprimir reaproveita pendente', re1.data.jobs?.[0]?.reusado === true);
  const ackGarcom = await api(`/impressao-log/${re1.data.jobs[0].id}`, { method: 'PATCH', token, body: { status: 'IMPRESSA' } });
  check('garçom dar baixa em impressão → 403', ackGarcom.status === 403, `status=${ackGarcom.status}`);
  await api(`/impressao-log/${re1.data.jobs[0].id}`, { method: 'PATCH', token: tokCoz, body: { status: 'IMPRESSA' } });
  const re2 = await api(`/impressao-log/remessa/${remId}/reimprimir`, {
    method: 'POST', token, body: { estacaoId: estCoz },
  });
  check('reimprimir cria novo job após impresso',
    re2.data.jobs?.[0]?.reusado === false && re2.data.jobs[0].id !== re1.data.jobs[0].id);

  // ---- AUDITORIA: claim atômico do print-agent ----
  const claimGarcom = await api('/impressao-log/claim', { method: 'POST', token, body: {} });
  check('garçom claim → 403', claimGarcom.status === 403, `status=${claimGarcom.status}`);
  const claimed = [];
  for (let i = 0; i < 6; i++) {
    const c = await api('/impressao-log/claim', { method: 'POST', token: tokCoz, body: {} });
    if (!c.data.job) break;
    claimed.push(c.data.job.id);
  }
  check('claim drena a fila sem repetir (3 jobs)', claimed.length === 3 && new Set(claimed).size === 3, `ids=${claimed}`);
  const claimVazio = await api('/impressao-log/claim', { method: 'POST', token: tokCoz, body: {} });
  check('claim sem jobs → null', claimVazio.data.job === null && claimVazio.data.esgotados === 0);
  const ackOk = await api(`/impressao-log/${claimed[0]}`, { method: 'PATCH', token: tokCoz, body: { status: 'IMPRESSA' } });
  check('ack de job claimed → 200', ackOk.status === 200, `status=${ackOk.status}`);
  const ackDup = await api(`/impressao-log/${claimed[0]}`, { method: 'PATCH', token: tokCoz, body: { status: 'FALHA' } });
  check('re-ack de job impresso → 409', ackDup.status === 409, `status=${ackDup.status}`);

  // 7. RBAC: garçom não cria produto
  const forb = await api('/produtos', { method: 'POST', token, body: { nome: 'X', categoriaId: 1, preco: 1 } });
  check('garçom criar produto → 403', forb.status === 403, `status=${forb.status}`);

  // 8. alertas de estoque + detalhe do pedido
  const alertas = await api('/estoque/alertas', { token });
  check('alertas de estoque respondem', alertas.status === 200 && Array.isArray(alertas.data));
  const det = await api(`/pedidos/${pid}`, { token });
  check('detalhe soma total', det.status === 200 && Number(det.data.total) > 0, `total=${det.data?.total}`);

  // ---- FASE 3: caixa ----
  const loginCaixa = await api('/auth/pin', { method: 'POST', body: { email: 'carla@casadofogo.com', pin: '3333' } });
  const tokCaixa = loginCaixa.data.access_token;
  const loginGer = await api('/auth/pin', { method: 'POST', body: { email: 'diego@casadofogo.com', pin: '5555' } });
  const tokGer = loginGer.data.access_token;
  const abrir = await api('/caixas/abrir', { method: 'POST', token: tokGer, body: { valorInicial: 200 } });
  check('abrir caixa (fundo 200)', abrir.status === 201 && abrir.data.id, `status=${abrir.status}`);
  const cxId = abrir.data.id;
  const abrir2 = await api('/caixas/abrir', { method: 'POST', token: tokGer, body: {} });
  check('2º caixa mesmo operador → 409', abrir2.status === 409, `status=${abrir2.status}`);

  // ---- FASE 3: imprimir conta + pagamentos parciais ----
  const conta = await api(`/pedidos/${pid}/imprimir-conta`, { method: 'POST', token });
  check('imprimir conta cria conta única', conta.data.contas?.length === 1, `status=${conta.status}`);
  const contaId = conta.data.contas[0].id;
  const mapa2 = await api('/mesas/mapa', { token });
  check('mesa foi para AGUARDANDO_CONTA',
    mapa2.data.find((m) => m.mesa_id === mesaLivre.mesa_id)?.status === 'AGUARDANDO_CONTA');
  const semCaixa = await api(`/contas/${contaId}/pagamentos`, { method: 'POST', token, body: { forma: 'PIX', valor: 10 } });
  check('pagto sem caixaId (2 abertos) → 400', semCaixa.status === 400, `status=${semCaixa.status}`);
  const pg1 = await api(`/contas/${contaId}/pagamentos`, { method: 'POST', token, body: { forma: 'PIX', valor: 30, caixaId: cxId } });
  check('pagamento parcial PIX 30', pg1.data.resumo?.saldo > 0 && pg1.data.status === 'ABERTA', `saldo=${pg1.data.resumo?.saldo}`);
  const pgEx = await api(`/contas/${contaId}/pagamentos`, { method: 'POST', token, body: { forma: 'PIX', valor: 20, caixaId: cxId } });
  check('pagamento acima do saldo → 400', pgEx.status === 400, `status=${pgEx.status}`);
  const resto = pg1.data.resumo.saldo;
  const pg2 = await api(`/contas/${contaId}/pagamentos`, { method: 'POST', token, body: { forma: 'DINHEIRO', valor: resto, caixaId: cxId } });
  check('quitar fecha a conta sozinha', pg2.data.status === 'FECHADA' && pg2.data.resumo?.saldo === 0);
  const recibo = await api(`/contas/${contaId}/recibo`, { token });
  check('recibo traz mesa + total', /MESA 1/.test(recibo.data.texto || '') && /TOTAL/.test(recibo.data.texto || ''));

  // ---- FASE 3: fechar pedido libera a mesa ----
  const fechaCedo = await api(`/pedidos/${pid}/fechar`, { method: 'POST', token: tokCaixa });
  check('fechar c/ item em produção → 400', fechaCedo.status === 400, `status=${fechaCedo.status}`);
  for (const st of ['EM_PREPARO', 'PRONTO', 'ENTREGUE']) {
    await api(`/pedidos/${pid}/itens/${item2.data.id}/status`, { method: 'PATCH', token: tokCoz, body: { status: st } });
  }
  const fecha = await api(`/pedidos/${pid}/fechar`, { method: 'POST', token: tokCaixa });
  check('fechar pedido quitado', fecha.data?.ok === true, JSON.stringify(fecha.data));
  const mapa3 = await api('/mesas/mapa', { token });
  check('mesa liberada (LIVRE)', mapa3.data.find((m) => m.mesa_id === mesaLivre.mesa_id)?.status === 'LIVRE');

  // ---- FASE 3: divisão igualitária + estorno ----
  const pedB = await api('/pedidos', { method: 'POST', token, body: { mesaId: 2 } });
  const pidB = pedB.data.id;
  const b1 = await api(`/pedidos/${pidB}/itens`, { method: 'POST', token, body: { produtoId: 1, quantidade: 1 } });
  const b2 = await api(`/pedidos/${pidB}/itens`, { method: 'POST', token, body: { produtoId: 6, quantidade: 1 } });
  await api(`/pedidos/${pidB}/enviar`, { method: 'POST', token, body: { tipo: 'LIVRE', itemIds: [b1.data.id, b2.data.id] } });
  const div = await api(`/pedidos/${pidB}/dividir-igual`, { method: 'POST', token, body: { partes: 2 } });
  const soma = div.data.reduce((s, c) => s + Math.round(Number(c.valor_rateio) * 100), 0);
  check('dividir igual: 2 contas somando 50,49', div.data.length === 2 && soma === 5049, `soma=${soma / 100}`);
  const pgA = await api(`/contas/${div.data[0].id}/pagamentos`, { method: 'POST', token, body: { forma: 'PIX', valor: Number(div.data[0].valor_rateio), caixaId: cxId } });
  check('parte 1 paga e fecha', pgA.data.status === 'FECHADA');
  const estorno = await api(`/pagamentos/${pgA.data.pagamentos.find((p) => p.status === 'APROVADO').id}/cancelar`, { method: 'POST', token: tokCaixa, body: { motivo: 'smoke: teste de estorno' } });
  check('estorno reabre a conta', estorno.data.status === 'ABERTA' && estorno.data.resumo?.saldo > 0);
  await api(`/contas/${div.data[0].id}/pagamentos`, { method: 'POST', token, body: { forma: 'PIX', valor: Number(div.data[0].valor_rateio), caixaId: cxId } });
  await api(`/contas/${div.data[1].id}/pagamentos`, { method: 'POST', token, body: { forma: 'CARTAO_CREDITO', valor: Number(div.data[1].valor_rateio), caixaId: cxId } });
  for (const itemId of [b1.data.id, b2.data.id]) {
    for (const st of ['EM_PREPARO', 'PRONTO', 'ENTREGUE']) {
      await api(`/pedidos/${pidB}/itens/${itemId}/status`, { method: 'PATCH', token: tokCoz, body: { status: st } });
    }
  }
  const fechaB = await api(`/pedidos/${pidB}/fechar`, { method: 'POST', token: tokCaixa });
  check('pedido dividido fecha após quitar tudo', fechaB.data?.ok === true);

  // ---- AUDITORIA: estorno em caixa fechado ----
  const pedC = await api('/pedidos', { method: 'POST', token, body: { mesaId: 4 } });
  const pidC = pedC.data.id;
  const c1 = await api(`/pedidos/${pidC}/itens`, { method: 'POST', token, body: { produtoId: 8, quantidade: 1 } });
  await api(`/pedidos/${pidC}/enviar`, { method: 'POST', token, body: { tipo: 'LIVRE', itemIds: [c1.data.id] } });
  for (const st of ['EM_PREPARO', 'PRONTO', 'ENTREGUE']) {
    await api(`/pedidos/${pidC}/itens/${c1.data.id}/status`, { method: 'PATCH', token: tokCoz, body: { status: st } });
  }
  const contaC = await api(`/pedidos/${pidC}/imprimir-conta`, { method: 'POST', token });
  const contaCId = contaC.data.contas[0].id;
  const pgC = await api(`/contas/${contaCId}/pagamentos`, { method: 'POST', token, body: { forma: 'PIX', valor: 2, caixaId: 1 } });
  check('pagamento parcial no caixa 1 (seed)', pgC.data.resumo?.saldo > 0, `saldo=${pgC.data.resumo?.saldo}`);
  const detCx1 = await api('/caixas/1', { token: tokCaixa });
  check('resumo traz esperado em dinheiro', detCx1.data.resumo?.valor_esperado_dinheiro > 0, `esp_din=${detCx1.data.resumo?.valor_esperado_dinheiro}`);
  const fechaCx1 = await api('/caixas/1/fechar', { method: 'POST', token: tokCaixa, body: { valorContado: detCx1.data.resumo.valor_esperado } });
  check('caixa 1 fecha exato', fechaCx1.data.conferencia?.ok === true);
  const pgCId = pgC.data.pagamentos.find((p) => p.status === 'APROVADO').id;
  const estFechado = await api(`/pagamentos/${pgCId}/cancelar`, { method: 'POST', token: tokCaixa, body: {} });
  check('estorno em caixa fechado → 400', estFechado.status === 400, `status=${estFechado.status}`);

  // ---- AUDITORIA: pedido sem cobertura + tetos + mesa ----
  const pgFechada = await api(`/contas/${contaId}/pagamentos`, { method: 'POST', token, body: { forma: 'PIX', valor: 1, caixaId: cxId } });
  check('pagamento em conta fechada → 400', pgFechada.status === 400, `status=${pgFechada.status}`);
  const pedD = await api('/pedidos', { method: 'POST', token, body: { mesaId: 6 } });
  const pidD = pedD.data.id;
  const d1 = await api(`/pedidos/${pidD}/itens`, { method: 'POST', token, body: { produtoId: 8, quantidade: 1 } });
  await api(`/pedidos/${pidD}/enviar`, { method: 'POST', token, body: { tipo: 'LIVRE', itemIds: [d1.data.id] } });
  for (const st of ['EM_PREPARO', 'PRONTO', 'ENTREGUE']) {
    await api(`/pedidos/${pidD}/itens/${d1.data.id}/status`, { method: 'PATCH', token: tokCoz, body: { status: st } });
  }
  const contaD = await api(`/pedidos/${pidD}/imprimir-conta`, { method: 'POST', token });
  await api(`/contas/${contaD.data.contas[0].id}`, { method: 'DELETE', token });
  const fechaD = await api(`/pedidos/${pidD}/fechar`, { method: 'POST', token: tokCaixa });
  check('fechar pedido sem cobertura → 400', fechaD.status === 400, `status=${fechaD.status}`);
  const div99 = await api(`/pedidos/${pidD}/dividir-igual`, { method: 'POST', token, body: { partes: 99 } });
  check('dividir em 99 partes → 400', div99.status === 400, `status=${div99.status}`);
  const pct500 = await api(`/contas/${contaCId}`, { method: 'PATCH', token, body: { servicoPct: 500 } });
  check('serviço 500% → 400', pct500.status === 400, `status=${pct500.status}`);
  const descAlto = await api(`/contas/${contaCId}`, { method: 'PATCH', token, body: { descontoValor: 999 } });
  check('desconto acima do pago → 400', descAlto.status === 400, `status=${descAlto.status}`);
  const mesaForce = await api('/mesas/4', { method: 'PATCH', token, body: { status: 'LIVRE' } });
  check('forçar LIVRE em mesa ocupada → 400', mesaForce.status === 400, `status=${mesaForce.status}`);
  const reservaOk = await api('/mesas/7', { method: 'PATCH', token, body: { status: 'RESERVADA' } });
  check('reservar mesa livre → 200', reservaOk.status === 200, `status=${reservaOk.status}`);

  // ---- FASE 3: sangria + fechamento do caixa ----
  const sang = await api(`/caixas/${cxId}/movimentos`, { method: 'POST', token: tokCaixa, body: { tipo: 'SANGRIA', valor: 50, motivo: 'smoke: sangria de teste' } });
  check('sangria registrada', sang.data.movimentos?.some((m) => m.tipo === 'SANGRIA' && Number(m.valor) === 50));
  const detCx = await api(`/caixas/${cxId}`, { token: tokGer });
  const esperado = detCx.data.resumo.valor_esperado;
  const fechaCx = await api(`/caixas/${cxId}/fechar`, { method: 'POST', token: tokGer, body: { valorContado: esperado } });
  check('fechamento bate exato', fechaCx.data.conferencia?.ok === true && fechaCx.data.conferencia?.diferenca === 0, JSON.stringify(fechaCx.data.conferencia));

  // ---- AUDITORIA: trava de força bruta (por último) ----
  for (let i = 0; i < 5; i++) {
    await api('/auth/pin', { method: 'POST', body: { email: 'bruno@casadofogo.com', pin: '0000' } });
  }
  const bloqueado = await api('/auth/pin', { method: 'POST', body: { email: 'bruno@casadofogo.com', pin: '2222' } });
  check('6ª tentativa (certa) bloqueada → 429', bloqueado.status === 429, `status=${bloqueado.status}`);

  console.log(falhas === 0 ? '\n✅ SMOKE OK — Fase 1 funcionando' : `\n❌ ${falhas} falha(s)`);
} catch (e) {
  falhas++;
  console.error('\n❌ SMOKE QUEBROU:', e.message);
  console.error(serverLog.slice(-3000));
} finally {
  proc.kill('SIGTERM');
  setTimeout(() => proc.kill('SIGKILL'), 3000);
  await new Promise((r) => setTimeout(r, 800));
  process.exit(falhas === 0 ? 0 : 1);
}
