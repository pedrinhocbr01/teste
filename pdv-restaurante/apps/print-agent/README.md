# 🖨️ Print Agent — PDV Restaurante (Fase 2)

Serviço local (roda na LAN do restaurante) que consome a fila `impressao_log`
da API e imprime as comandas nas térmicas via **ESC/POS sobre TCP :9100**
(Epson TM, Elgin i9, Bematech MP — sem driver, sem dependência nativa).

## Como funciona

```
API ── fila impressao_log ──► agent ──TCP :9100──► térmica cozinha/bar
 ▲                                │
 └── PATCH IMPRESSA/FALHA ─────────┘   (+ WS acorda o agente na hora;
                                         polling de 3s é o fallback)
```

- **1 job por (remessa, estação)** + tickets avulsos de **CANCELAMENTO**
  (o agente imprime e a cozinha fica sabendo mesmo depois de impresso);
- **Retry**: jobs `FALHA` voltam para a fila até `MAX_TENTATIVAS`;
- **Reimpressão manual**: `POST /impressao-log/remessa/:id/reimprimir`
  (reaproveita pendente ou cria novo job);
- O agente **devolve o texto renderizado** no campo `conteudo` do job —
  a demo e o KDS mostram "como saiu no papel".

## Rodando

```bash
npm install
cp .env.example .env   # ajuste API_URL e o login do agente

# dev (sem impressora): salva tickets/*.txt + mostra no console
npm run start:dev

# produção (imprime de verdade nas IPs da tabela impressora)
MODO=real npm start
```

> Crie um usuário dedicado para o agente (`POST /usuarios`, papel `ADMIN`
> ou `GERENTE`, ex. `agente@seu-restaurante`) em vez de reusar o PIN do
> gerente. O agente faz login com e-mail + PIN e renova o JWT sozinho.

## Um agente por impressora (recomendado)

Cada estação tem seu PC + térmica. Rode um agente em cada um, filtrando:

```bash
# PC da cozinha (estação id 1)         # PC do bar (estação id 2)
ESTACAO_IDS=1 MODO=real npm start      ESTACAO_IDS=2 MODO=real npm start
```

Os IPs/portas vêm da API (`GET /estacoes` ← tabelas `estacao`/`impressora`).
Papéis suportados: 80mm (48 col), 76mm (42), 58mm (32).

## Testes

```bash
npm test        # unit: layout + bytes ESC/POS (8 checks)
npm run test:e2e  # sobe API real + agente virtual e imprime de ponta a ponta
```

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `login falhou (401)` | e-mail/PIN do agente errados ou usuário inativo |
| job preso em `FALHA` | impressora desligada/sem papel/fora da rede — confira IP na tabela `impressora` |
| `timeout imprimindo` | firewall bloqueando :9100 ou IP errado |
| `?` no lugar de letras | não deve acontecer (o renderer força ASCII) — abra uma issue |
| ticket cortado | `papel_mm` errado no cadastro da impressora |
