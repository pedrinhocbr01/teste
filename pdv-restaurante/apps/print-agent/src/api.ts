/** Cliente HTTP mínimo da API (login PIN + fila de impressão). */

export interface FilaJob {
  id: number;
  remessa_id: number;
  estacao_id: number;
  tipo: string;
  status: string;
  tentativas: number;
  criado_em: string;
  estacao_nome: string;
  mesa_numero: number;
}

export interface EstacaoInfo {
  id: number;
  nome: string;
  tipo: string;
  impressora?: string | null;
  ip?: string | null;
  porta?: number | null;
  papel_mm?: number | null;
}

export class ApiClient {
  private token = '';

  constructor(
    private readonly baseUrl: string,
    private readonly email: string,
    private readonly pin: string,
  ) {}

  async getToken(): Promise<string> {
    if (!this.token) await this.login();
    return this.token;
  }

  async login(): Promise<void> {
    const r = await fetch(`${this.baseUrl}/auth/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, pin: this.pin }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`login falhou (${r.status}): ${t.slice(0, 200)}`);
    }
    const data = (await r.json()) as any;
    this.token = data.access_token;
  }

  private async req(path: string, init: RequestInit = {}, retry = true): Promise<any> {
    if (!this.token) await this.login();
    const r = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...(init.headers || {}),
      },
    });
    if (r.status === 401 && retry) {
      await this.login();
      return this.req(path, init, false);
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`${init.method || 'GET'} ${path} → ${r.status}: ${t.slice(0, 300)}`);
    }
    return r.json();
  }

  fila(status: 'PENDENTE' | 'FALHA' | 'TODOS'): Promise<FilaJob[]> {
    return this.req(`/impressao-log?status=${status}`);
  }

  claim(estacaoIds: number[] | null, maxTentativas: number): Promise<{ job: any | null; esgotados: number }> {
    return this.req('/impressao-log/claim', {
      method: 'POST',
      body: JSON.stringify({
        ...(estacaoIds ? { estacaoIds } : {}),
        maxTentativas,
      }),
    });
  }

  job(id: number): Promise<any> {
    return this.req(`/impressao-log/${id}`);
  }

  ack(id: number, status: 'IMPRESSA' | 'FALHA', conteudo?: string): Promise<any> {
    return this.req(`/impressao-log/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(conteudo !== undefined ? { status, conteudo } : { status }),
    });
  }

  estacoes(): Promise<EstacaoInfo[]> {
    return this.req('/estacoes');
  }
}
