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
  await api(`/impressao-log/${re1.data.jobs[0].id}`, { method: 'PATCH', token, body: { status: 'IMPRESSA' } });
  const re2 = await api(`/impressao-log/remessa/${remId}/reimprimir`, {
    method: 'POST', token, body: { estacaoId: estCoz },
  });
  check('reimprimir cria novo job após impresso',
    re2.data.jobs?.[0]?.reusado === false && re2.data.jobs[0].id !== re1.data.jobs[0].id);

  // 7. RBAC: garçom não cria produto
  const forb = await api('/produtos', { method: 'POST', token, body: { nome: 'X', categoriaId: 1, preco: 1 } });
  check('garçom criar produto → 403', forb.status === 403, `status=${forb.status}`);

  // 8. alertas de estoque + detalhe do pedido
  const alertas = await api('/estoque/alertas', { token });
  check('alertas de estoque respondem', alertas.status === 200 && Array.isArray(alertas.data));
  const det = await api(`/pedidos/${pid}`, { token });
  check('detalhe soma total', det.status === 200 && Number(det.data.total) > 0, `total=${det.data?.total}`);

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
