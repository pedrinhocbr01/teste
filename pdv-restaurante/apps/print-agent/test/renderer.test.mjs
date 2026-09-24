// Unit: layout da comanda + bytes ESC/POS (roda sobre dist/ compilado)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTicketText, toEscPos, stripAccents, wrap, formatQtd, colsForPaper,
} from '../dist/renderer.js';

const jobProducao = {
  id: 7, tipo: 'PRODUCAO', remessa_id: 4, remessa_tipo: 'ENTRADA',
  mesa_numero: 3, garcom_nome: 'Ana Souza', restaurante_nome: 'Casa do Fogo',
  enviado_em: '2026-09-22T12:05:00.000Z', estacao_nome: 'Cozinha',
  itens: [
    { quantidade: '1.000', produto: 'Bruschetta Caprese', observacao: 'sem manjericão', ponto_carne: null },
    { quantidade: 2, produto: 'Caipirinha Tradicional', observacao: 'pouco açúcar', ponto_carne: null },
  ],
};

describe('renderer', () => {
  it('comanda de produção traz mesa, itens e observações', () => {
    const t = buildTicketText(jobProducao, 48);
    assert.match(t, /MESA 3/);
    assert.match(t, /ENTRADA/);
    assert.match(t, /1x Bruschetta Caprese/);
    assert.match(t, /> sem manjericao/);
    assert.match(t, /2x Caipirinha/);
    assert.match(t, /Ana Souza/);
  });

  it('remove acentos (térmica sai limpa)', () => {
    assert.equal(stripAccents('manjericão açúcar à la'), 'manjericao acucar a la');
    const t = buildTicketText(jobProducao, 48);
    assert.ok(/^[\x00-\x7F\n]*$/.test(t), 'ticket deve ser ASCII puro');
  });

  it('ticket de cancelamento destaca CANCELAMENTO + motivo', () => {
    const t = buildTicketText({
      ...jobProducao, tipo: 'CANCELAMENTO',
      conteudo: 'CANCELADO: 1.000x Long Neck 355 ml — Cliente desistiu', itens: [],
    }, 48);
    assert.match(t, /CANCELAMENTO/);
    assert.match(t, /Long Neck/);
    assert.match(t, /Cliente/);
    assert.match(t, /desistiu/); // sem acento (térmica)
    assert.ok(/^[\x00-\x7F\n]*$/.test(t), 'cancelamento também deve ser ASCII puro');
  });

  it('respeita a largura do papel (58mm=32 col)', () => {
    const t = buildTicketText(jobProducao, 32);
    for (const line of t.split('\n')) assert.ok(line.length <= 32, `estourou: ${line}`);
    assert.equal(colsForPaper(58), 32);
    assert.equal(colsForPaper(80), 48);
    assert.equal(colsForPaper(null), 48);
  });

  it('wrap quebra em palavra', () => {
    assert.deepEqual(wrap('ab cd ef', 4), ['ab', 'cd', 'ef']);
  });

  it('formatQtd mostra inteiro sem casas', () => {
    assert.equal(formatQtd('1.000'), '1');
    assert.equal(formatQtd('0.500'), '0.5');
  });

  it('ESC/POS começa com INIT e termina com corte', () => {
    const buf = toEscPos('MESA 3\n1x X', { beep: false });
    assert.equal(buf[0], 0x1b);
    assert.equal(buf[1], 0x40);
    const cut = Buffer.from([0x1d, 0x56, 0x00]);
    assert.ok(buf.subarray(-3).equals(cut), 'termina com GS V 0');
  });

  it('ESC/POS com beep inclui BEL', () => {
    const buf = toEscPos('oi', { beep: true });
    assert.ok(buf.includes(0x07));
  });
});
