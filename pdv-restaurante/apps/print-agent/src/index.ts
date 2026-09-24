import { loadConfig } from './config';
import { ApiClient } from './api';
import { PrintAgent } from './agent';

async function main() {
  const cfg = loadConfig();
  const api = new ApiClient(cfg.apiUrl, cfg.email, cfg.pin);
  const agent = new PrintAgent(cfg, api);

  const shutdown = async (sig: string) => {
    console.log(`[print-agent] ${sig} — encerrando...`);
    await agent.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  agent.start();
}

main().catch((e) => {
  console.error('[print-agent] fatal:', e?.message || e);
  process.exit(1);
});
