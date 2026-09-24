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
  const fechaCx1 = await api('/caixas/1/fechar', { method: 'POST', token: tokCaixa, body: { valorContado: detCx1.data.resumo.valor_esperado_dinheiro } });
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
  const esperado = detCx.data.resumo.valor_esperado_dinheiro;
  const fechaCx = await api(`/caixas/${cxId}/fechar`, { method: 'POST', token: tokGer, body: { valorContado: esperado } });
  check('fechamento bate exato', fechaCx.data.conferencia?.ok === true && fechaCx.data.conferencia?.diferenca === 0, JSON.stringify(fechaCx.data.conferencia));

  // ---- FASE 4: recebimento de compra ----
  const arrozAntes = await api('/insumos/2', { token: tokGer });
  const saldoArroz = Number(arrozAntes.data.saldo);
  const custoArroz = Number(arrozAntes.data.custo_unitario);
  const rec = await api('/estoque/recebimento', { method: 'POST', token: tokGer,
    body: { fornecedorId: 4, documento: 'NF-e 9999', itens: [{ insumoId: 2, quantidade: 2, custoTotal: 70 }] } });
  const linha = rec.data.linhas?.[0] || {};
  check('recebimento converte saco→kg (2 sacos = 10 kg)',
    rec.status === 201 && linha.quantidade_estoque === 10 && linha.unidade_compra === 'saco', `status=${rec.status}`);
  const custoEsperado = Math.round(((saldoArroz * custoArroz + 70) / (saldoArroz + 10)) * 10000) / 10000;
  check('custo médio ponderado', linha.custo_medio_novo === custoEsperado, `custo=${linha.custo_medio_novo} esp=${custoEsperado}`);
  check('recebimento soma no saldo', linha.saldo_novo === Math.round((saldoArroz + 10) * 1000) / 1000, `saldo=${linha.saldo_novo}`);
  const recSemCusto = await api('/estoque/recebimento', { method: 'POST', token: tokGer,
    body: { itens: [{ insumoId: 1, quantidade: 1.5 }] } });
  const lsc = recSemCusto.data.linhas?.[0] || {};
  check('recebimento sem custo mantém médio (kg direto)',
    lsc.quantidade_estoque === 1.5 && lsc.custo_linha === null && lsc.custo_medio_novo === lsc.custo_medio_anterior);
  const rec403 = await api('/estoque/recebimento', { method: 'POST', token, body: { itens: [{ insumoId: 1, quantidade: 1 }] } });
  check('garçom não recebe compra → 403', rec403.status === 403, `status=${rec403.status}`);
  const recForn = await api('/estoque/recebimento', { method: 'POST', token: tokGer,
    body: { fornecedorId: 999, itens: [{ insumoId: 1, quantidade: 1 }] } });
  check('fornecedor inválido → 400', recForn.status === 400, `status=${recForn.status}`);

  // ---- FASE 4: inventário ----
  const inv = await api('/estoque/inventarios', { method: 'POST', token: tokGer, body: { descricao: 'Smoke' } });
  check('abrir inventário', inv.status === 201 && inv.data.status === 'ABERTO', `status=${inv.status}`);
  const invId = inv.data.id;
  const inv2 = await api('/estoque/inventarios', { method: 'POST', token: tokGer, body: {} });
  check('2º inventário aberto → 409', inv2.status === 409, `status=${inv2.status}`);
  const arrozAgora = Number((await api('/insumos/2', { token: tokGer })).data.saldo);
  const cont1 = await api(`/estoque/inventarios/${invId}/contagens`, { method: 'POST', token: tokGer,
    body: { insumoId: 2, quantidade: Math.round((arrozAgora - 0.5) * 1000) / 1000 } });
  check('contagem calcula diferença (-0,5)', cont1.data.itens?.[0]?.diferenca === -0.5, JSON.stringify(cont1.data.resumo));
  const cont2 = await api(`/estoque/inventarios/${invId}/contagens`, { method: 'POST', token: tokGer,
    body: { insumoId: 2, quantidade: arrozAgora - 1 } });
  check('recontagem sobrescreve (upsert)', cont2.data.itens?.length === 1 && cont2.data.itens[0].diferenca === -1);
  const feijaoSaldo = Number((await api('/insumos/3', { token: tokGer })).data.saldo);
  await api(`/estoque/inventarios/${invId}/contagens`, { method: 'POST', token: tokGer,
    body: { insumoId: 3, quantidade: feijaoSaldo } });
  const delCont = await api(`/estoque/inventarios/${invId}/contagens/3`, { method: 'DELETE', token: tokGer });
  const invDet = await api(`/estoque/inventarios/${invId}`, { token: tokGer });
  check('remover contagem', delCont.status === 200 && invDet.data.itens?.length === 1, `n=${invDet.data.itens?.length}`);
  const fechaInv = await api(`/estoque/inventarios/${invId}/fechar`, { method: 'POST', token: tokGer });
  check('fechar gera 1 ajuste (falta)', fechaInv.data.ajustes_gerados === 1 && fechaInv.data.status === 'FECHADO', JSON.stringify(fechaInv.data.resumo));
  const arrozFim = Number((await api('/insumos/2', { token: tokGer })).data.saldo);
  check('saldo após ajuste de falta', arrozFim === Math.round((arrozAgora - 1) * 1000) / 1000, `saldo=${arrozFim}`);
  const fechaInv2 = await api(`/estoque/inventarios/${invId}/fechar`, { method: 'POST', token: tokGer });
  check('fechar 2x → 400', fechaInv2.status === 400, `status=${fechaInv2.status}`);
  const contFech = await api(`/estoque/inventarios/${invId}/contagens`, { method: 'POST', token: tokGer,
    body: { insumoId: 2, quantidade: 1 } });
  check('contagem em inventário fechado → 400', contFech.status === 400, `status=${contFech.status}`);
  const invB = await api('/estoque/inventarios', { method: 'POST', token: tokGer, body: { descricao: 'Smoke B' } });
  await api(`/estoque/inventarios/${invB.data.id}/cancelar`, { method: 'POST', token: tokGer });
  const invBCanc = await api(`/estoque/inventarios/${invB.data.id}`, { token: tokGer });
  check('cancelar inventário', invBCanc.data.status === 'CANCELADO');

  // ---- FASE 4: CMV, perdas, custo do prato ----
  const cmv = await api('/estoque/cmv', { token: tokGer });
  check('CMV responde com totais', cmv.status === 200 && typeof cmv.data.cmv_total === 'number' && Array.isArray(cmv.data.por_produto),
    `cmv=${cmv.data.cmv_total} receita=${cmv.data.receita_total}`);
  const cmvRuim = await api('/estoque/cmv?de=2024-13-99', { token: tokGer });
  check('CMV período inválido → 400', cmvRuim.status === 400, `status=${cmvRuim.status}`);
  const perda = await api('/estoque/movimentos', { method: 'POST', token: tokGer,
    body: { insumoId: 8, tipo: 'PERDA', quantidade: 1, motivo: 'smoke' } });
  const perdas = await api('/estoque/perdas', { token: tokGer });
  const tomate = (perdas.data.por_insumo || []).find((x) => x.insumo_id === 8);
  check('perda entra no relatório', perda.status === 201 && tomate?.qtd_perda === 1 && tomate?.valor_perda === 7,
    `perda_total=${perdas.data.perda_total}`);
  const custo = await api('/produtos/2/custo', { token: tokGer });
  const pic = (custo.data.ingredientes || []).find((x) => x.insumo_id === 1);
  check('custo do prato detalha ingredientes',
    custo.status === 200 && custo.data.ingredientes?.length === 6 && pic?.qtd_bruta === 0.568 && custo.data.margem_pct > 0,
    `porcao=${custo.data.custo_porcao} margem=${custo.data.margem_pct}%`);
  const m30 = await api('/produtos?margemAbaixoDe=30', { token: tokGer });
  const m100 = await api('/produtos?margemAbaixoDe=100', { token: tokGer });
  check('filtro margemAbaixoDe', m30.status === 200 && m30.data.every((p) => Number(p.margem_pct) < 30) && m100.data.length >= m30.data.length,
    `n30=${m30.data.length} n100=${m100.data.length}`);

  // ---- FIXES: garçom/mesa/caixa ----
  const stRuim = await api('/pedidos?status=LIXO', { token });
  check('filtro status inválido → 400', stRuim.status === 400, `status=${stRuim.status}`);
  const mesaRuim = await api('/pedidos?mesaId=abc', { token });
  check('filtro mesaId inválido → 400', mesaRuim.status === 400, `status=${mesaRuim.status}`);

  const cxF = await api('/caixas/abrir', { method: 'POST', token: tokGer, body: { valorInicial: 100 } });
  const cxFId = cxF.data.id;
  const mapaF = await api('/mesas/mapa', { token });
  const livresF = mapaF.data.filter((m) => m.status === 'LIVRE');

  // pedido A: item lançado DEPOIS da conta entra no 2º "pedir conta"
  const pedA = await api('/pedidos', { method: 'POST', token, body: { mesaId: livresF[0].mesa_id } });
  const pidA = pedA.data.id;
  const a1 = await api(`/pedidos/${pidA}/itens`, { method: 'POST', token, body: { produtoId: 7, quantidade: 2 } });
  await api(`/pedidos/${pidA}/enviar`, { method: 'POST', token, body: { tipo: 'LIVRE', itemIds: [a1.data.id] } });
  const contaA1 = await api(`/pedidos/${pidA}/imprimir-conta`, { method: 'POST', token });
  const contaAId = contaA1.data.contas[0].id;
  const totA1 = contaA1.data.contas[0].total;
  const a2 = await api(`/pedidos/${pidA}/itens`, { method: 'POST', token, body: { produtoId: 8, quantidade: 1 } });
  await api(`/pedidos/${pidA}/enviar`, { method: 'POST', token, body: { tipo: 'LIVRE', itemIds: [a2.data.id] } });
  const contaA2 = await api(`/pedidos/${pidA}/imprimir-conta`, { method: 'POST', token });
  check('2º pedir-conta aloca item novo na conta única',
    contaA2.data.contas.length === 1 && contaA2.data.contas[0].total > totA1, `total=${contaA2.data.contas[0]?.total}`);
  for (const it of [a1.data.id, a2.data.id]) {
    await api(`/pedidos/${pidA}/itens/${it}/status`, { method: 'PATCH', token: tokCoz, body: { status: 'ENTREGUE' } });
  }
  const detA = await api(`/contas/${contaAId}`, { token });
  const pgFA = await api(`/contas/${contaAId}/pagamentos`, { method: 'POST', token: tokCaixa, body: { forma: 'PIX', valor: detA.data.resumo.saldo, caixaId: cxFId } });
  check('conta quitada no PIX', pgFA.data.status === 'FECHADA');
  const fechaA = await api(`/pedidos/${pidA}/fechar`, { method: 'POST', token: tokCaixa, body: {} });
  check('pedido fecha com item pós-conta coberto', fechaA.data?.ok === true, JSON.stringify(fechaA.data).slice(0, 120));

  // pedido B: divisão igual + item novo → conta nova só com as sobras
  const pedFB = await api('/pedidos', { method: 'POST', token, body: { mesaId: livresF[1].mesa_id } });
  const pidFB = pedFB.data.id;
  const fb1 = await api(`/pedidos/${pidFB}/itens`, { method: 'POST', token, body: { produtoId: 7, quantidade: 2 } });
  await api(`/pedidos/${pidFB}/enviar`, { method: 'POST', token, body: { tipo: 'LIVRE', itemIds: [fb1.data.id] } });
  await api(`/pedidos/${pidFB}/dividir-igual`, { method: 'POST', token, body: { partes: 2 } });
  const fb2 = await api(`/pedidos/${pidFB}/itens`, { method: 'POST', token, body: { produtoId: 8, quantidade: 1 } });
  await api(`/pedidos/${pidFB}/enviar`, { method: 'POST', token, body: { tipo: 'LIVRE', itemIds: [fb2.data.id] } });
  const contaB = await api(`/pedidos/${pidFB}/imprimir-conta`, { method: 'POST', token });
  const contasB = await api(`/pedidos/${pidFB}/contas`, { token });
  const novaB = contasB.data.find((c) => c.status === 'ABERTA' && c.valor_rateio == null);
  check('item pós-divisão ganha conta própria', contaB.data.contas.length === 3 && novaB?.total > 0, `contas=${contaB.data.contas.length}`);
  for (const it of [fb1.data.id, fb2.data.id]) {
    await api(`/pedidos/${pidFB}/itens/${it}/status`, { method: 'PATCH', token: tokCoz, body: { status: 'ENTREGUE' } });
  }
  for (const c of contasB.data.filter((c) => c.status === 'ABERTA')) {
    await api(`/contas/${c.id}/pagamentos`, { method: 'POST', token: tokCaixa, body: { forma: 'DINHEIRO', valor: c.saldo, caixaId: cxFId } });
  }
  const fechaFB = await api(`/pedidos/${pidFB}/fechar`, { method: 'POST', token: tokCaixa, body: {} });
  check('pedido dividido fecha após pagar as 3 contas', fechaFB.data?.ok === true);

  // pedido C: conta avulsa vazia + alocar-pendentes + tirar os 10%
  const pedC2 = await api('/pedidos', { method: 'POST', token, body: { mesaId: livresF[2].mesa_id } });
  const pidC2 = pedC2.data.id;
  const c2 = await api(`/pedidos/${pidC2}/itens`, { method: 'POST', token, body: { produtoId: 7, quantidade: 1 } });
  await api(`/pedidos/${pidC2}/enviar`, { method: 'POST', token, body: { tipo: 'LIVRE', itemIds: [c2.data.id] } });
  const novaC = await api(`/pedidos/${pidC2}/contas`, { method: 'POST', token, body: { descricao: 'Avulsa' } });
  const alocC = await api(`/contas/${novaC.data.id}/alocar-pendentes`, { method: 'POST', token });
  check('alocar-pendentes enche a conta avulsa', alocC.data.resumo?.total > 0 && alocC.data.itens?.length === 1);
  const semServ = await api(`/contas/${novaC.data.id}`, { method: 'PATCH', token, body: { incluirServico: false } });
  check('tirar os 10% recalcula', semServ.data.resumo?.servico_valor === 0, `total=${semServ.data.resumo?.total}`);
  await api(`/pedidos/${pidC2}/itens/${c2.data.id}/status`, { method: 'PATCH', token: tokCoz, body: { status: 'ENTREGUE' } });
  await api(`/contas/${novaC.data.id}/pagamentos`, { method: 'POST', token: tokCaixa, body: { forma: 'DINHEIRO', valor: semServ.data.resumo.saldo, caixaId: cxFId } });
  const fechaC2 = await api(`/pedidos/${pidC2}/fechar`, { method: 'POST', token: tokCaixa, body: {} });
  check('pedido C fecha', fechaC2.data?.ok === true);

  // caixa: sangria limitada à gaveta; fechamento confere a gaveta
  const sangAlta = await api(`/caixas/${cxFId}/movimentos`, { method: 'POST', token: tokCaixa, body: { tipo: 'SANGRIA', valor: 99999, motivo: 'teste' } });
  check('sangria acima da gaveta → 400', sangAlta.status === 400, `status=${sangAlta.status}`);
  const detF = await api(`/caixas/${cxFId}`, { token: tokGer });
  check('gaveta exclui o PIX', detF.data.resumo.valor_esperado_dinheiro < detF.data.resumo.valor_esperado,
    `gav=${detF.data.resumo.valor_esperado_dinheiro} tot=${detF.data.resumo.valor_esperado}`);
  const fechaF = await api(`/caixas/${cxFId}/fechar`, { method: 'POST', token: tokGer, body: { valorContado: detF.data.resumo.valor_esperado_dinheiro } });
  check('fechamento confere a gaveta exata',
    fechaF.data.conferencia?.ok === true && fechaF.data.conferencia?.esperado === detF.data.resumo.valor_esperado_dinheiro,
    JSON.stringify(fechaF.data.conferencia));

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
