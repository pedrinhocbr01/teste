// E2E: sobe a API real (PGlite) + agente virtual, envia pedido e confere
// que os tickets saíram (jobs IMPRESSA + arquivos) — incluindo CANCELAMENTO.
// Uso: npm run test:e2e
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(DIR, '..', '..', 'api');
const PORT = 3458;
const BASE = `http://127.0.0.1:${PORT}`;
const TICKETS = join(DIR, 'tmp-tickets');
let falhas = 0;
const procs = [];

function check(label, ok, extra = '') {
  console.log(` ${ok ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) falhas++;
}
async function api(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function espera(fn, timeoutMs, label) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}
function killAll() {
  for (const p of procs) {
    try { p.kill('SIGTERM'); } catch { /* noop */ }
    setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* noop */ } }, 2000);
  }
}
process.on('exit', killAll);

try {
  // garante API compilada
  if (!existsSync(join(API_DIR, 'dist', 'main.js'))) {
    console.log('[e2e] compilando API...');
    const b = spawnSync('npm', ['run', 'build'], { cwd: API_DIR, stdio: 'pipe' });
    if (b.status !== 0) throw new Error('falha ao compilar a API:\n' + b.stderr.toString().slice(-2000));
  }
  rmSync(TICKETS, { recursive: true, force: true });

  console.log('[e2e] subindo API...');
  const apiProc = spawn('node', ['dist/main.js'], {
    cwd: API_DIR, env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'e2e' }, stdio: 'pipe',
  });
  procs.push(apiProc);
  await espera(async () => (await fetch(BASE + '/health').then((r) => r.ok).catch(() => false)) || null, 30000, 'API subir');
  check('API subiu', true);

  const login = await api('/auth/pin', { method: 'POST', body: { email: 'diego@casadofogo.com', pin: '5555' } });
  const token = login.data.access_token;
  check('login agente (gerente)', !!token);

  // cenário: mesa 1 → bruschetta + caipirinha → enviar
  const pedido = await api('/pedidos', { method: 'POST', token, body: { mesaId: 1 } });
  const pid = pedido.data.id;
  const i1 = await api(`/pedidos/${pid}/itens`, { method: 'POST', token, body: { produtoId: 1, quantidade: 1, observacao: 'sem manjericão' } });
  const i2 = await api(`/pedidos/${pid}/itens`, { method: 'POST', token, body: { produtoId: 6, quantidade: 1 } });
  const envio = await api(`/pedidos/${pid}/enviar`, { method: 'POST', token, body: { tipo: 'ENTRADA', itemIds: [i1.data.id, i2.data.id] } });
  check('envio gerou 2 jobs', envio.data.jobs?.length === 2);

  console.log('[e2e] subindo agente (virtual)...');
  const agent = spawn('node', ['dist/index.js'], {
    cwd: join(DIR, '..'),
    env: {
      ...process.env, API_URL: BASE, AGENT_EMAIL: 'diego@casadofogo.com', AGENT_PIN: '5555',
      POLL_MS: '400', MODO: 'virtual', TICKETS_DIR: TICKETS,
    },
    stdio: 'pipe',
  });
  procs.push(agent);
  let agentLog = '';
  agent.stdout.on('data', (d) => (agentLog += d.toString()));
  agent.stderr.on('data', (d) => (agentLog += d.toString()));

  await espera(async () => {
    const f = await api('/impressao-log?status=TODOS', { token });
    const jobs = f.data.filter((j) => j.remessa_id === envio.data.remessa.id && j.tipo === 'PRODUCAO');
    return jobs.length === 2 && jobs.every((j) => j.status === 'IMPRESSA') ? jobs : null;
  }, 25000, 'agente imprimir PRODUCAO');
  check('agente imprimiu os 2 jobs (IMPRESSA)', true);

  const files = readdirSync(TICKETS);
  check('2 arquivos de ticket gerados', files.length === 2, files.join(', '));
  const all = files.map((f) => readFileSync(join(TICKETS, f), 'utf8')).join('\n');
  check('ticket cozinha tem bruschetta + obs', /Bruschetta/.test(all) && /manjericao/.test(all));
  check('ticket bar tem caipirinha', /Caipirinha/.test(all));
  check('tickets citam MESA 1', /MESA 1/.test(all));

  // agente devolveu o texto renderizado p/ conferência?
  const det = await api(`/impressao-log/${envio.data.jobs[0].id}`, { token });
  check('job guarda conteudo renderizado', /MESA 1/.test(det.data.conteudo || ''));

  // cancelamento → ticket CANCELAMENTO impresso
  await api(`/pedidos/${pid}/itens/${i2.data.id}/cancelar`, { method: 'POST', token, body: { motivo: 'E2E sem limão' } });
  await espera(async () => {
    const f = await api('/impressao-log?status=TODOS&tipo=CANCELAMENTO', { token });
    return f.data.length === 1 && f.data[0].status === 'IMPRESSA' ? f.data[0] : null;
  }, 25000, 'agente imprimir CANCELAMENTO');
  check('ticket CANCELAMENTO impresso', true);
  const files2 = readdirSync(TICKETS);
  const canc = files2.map((f) => readFileSync(join(TICKETS, f), 'utf8')).join('\n');
  check('ticket avulso traz CANCELAMENTO + motivo', /CANCELAMENTO/.test(canc) && /limao/.test(canc));

  console.log(falhas === 0 ? '\n✅ E2E PRINT-AGENT OK' : `\n❌ ${falhas} falha(s)\n${agentLog.slice(-2000)}`);
} catch (e) {
  falhas++;
  console.error('\n❌ E2E QUEBROU:', e.message);
} finally {
  killAll();
  await new Promise((r) => setTimeout(r, 800));
  rmSync(TICKETS, { recursive: true, force: true });
  process.exit(falhas === 0 ? 0 : 1);
}
