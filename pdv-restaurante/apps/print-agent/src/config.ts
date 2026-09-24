export interface AgentConfig {
  apiUrl: string;
  email: string;
  pin: string;
  pollMs: number;
  modo: 'virtual' | 'real';
  ticketsDir: string;
  estacaoIds: number[] | null;
  beep: boolean;
  maxTentativas: number;
}

export function loadConfig(env = process.env): AgentConfig {
  const modo = (env.MODO || 'virtual').toLowerCase();
  if (modo !== 'virtual' && modo !== 'real') {
    throw new Error(`MODO inválido: ${env.MODO} (use virtual ou real)`);
  }
  const estacaoIds = (env.ESTACAO_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  return {
    apiUrl: (env.API_URL || 'http://localhost:3001').replace(/\/$/, ''),
    email: env.AGENT_EMAIL || 'diego@casadofogo.com',
    pin: env.AGENT_PIN || '5555',
    pollMs: Math.max(300, Number(env.POLL_MS || 3000)),
    modo: modo as 'virtual' | 'real',
    ticketsDir: env.TICKETS_DIR || './tickets',
    estacaoIds: estacaoIds.length ? estacaoIds : null,
    beep: (env.BEEP || 'true').toLowerCase() !== 'false',
    maxTentativas: Number(env.MAX_TENTATIVAS || 50),
  };
}
