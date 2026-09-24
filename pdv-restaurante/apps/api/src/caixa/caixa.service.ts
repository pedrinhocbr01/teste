import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService, num } from '../common/db/db.service';
import { toCents, toReais, br } from '../common/money';
import { PdvGateway } from '../ws/pdv.gateway';
import { AbrirCaixaDto, FecharCaixaDto, MovimentoCaixaDto } from './dto';

@Injectable()
export class CaixaService {
  constructor(
    private readonly db: DbService,
    private readonly ws: PdvGateway,
  ) {}

  listar(status?: string) {
    if (status && !['ABERTO', 'FECHADO'].includes(status.toUpperCase())) {
      throw new BadRequestException('status deve ser ABERTO ou FECHADO');
    }
    const where = status ? `WHERE cx.status = $1::tipo_status_caixa` : '';
    return this.db.query(
      `SELECT cx.*, u.nome AS operador_nome FROM caixa cx
       JOIN usuario u ON u.id = cx.operador_id
       ${where} ORDER BY cx.id DESC LIMIT 50`,
      status ? [status.toUpperCase()] : [],
    );
  }

  async meuAberto(userId: number) {
    return this.db.queryOne(
      `SELECT cx.*, u.nome AS operador_nome FROM caixa cx
       JOIN usuario u ON u.id = cx.operador_id
       WHERE cx.operador_id = $1 AND cx.status = 'ABERTO'`,
      [userId],
    );
  }

  async detalhar(id: number) {
    const cx = await this.db.queryOne<any>(
      `SELECT cx.*, u.nome AS operador_nome FROM caixa cx
       JOIN usuario u ON u.id = cx.operador_id WHERE cx.id = $1`,
      [id],
    );
    if (!cx) throw new NotFoundException('Caixa não encontrado');
    const resumo = await this.db.queryOne<any>(
      `SELECT * FROM vw_caixa_resumo WHERE caixa_id = $1`,
      [id],
    );
    const movimentos = await this.db.query(
      `SELECT k.*, u.nome AS usuario_nome FROM caixa_movimento k
       LEFT JOIN usuario u ON u.id = k.usuario_id
       WHERE k.caixa_id = $1 ORDER BY k.id`,
      [id],
    );
    const pagamentos = await this.db.query(
      `SELECT pg.*, c.descricao AS conta_descricao FROM pagamento pg
       JOIN conta c ON c.id = pg.conta_id
       WHERE pg.caixa_id = $1 AND pg.status = 'APROVADO' ORDER BY pg.id`,
      [id],
    );
    return {
      ...cx,
      valor_inicial: num(cx.valor_inicial),
      valor_contado: cx.valor_contado == null ? null : num(cx.valor_contado),
      diferenca: cx.diferenca == null ? null : num(cx.diferenca),
      resumo: resumo && {
        ...resumo,
        valor_inicial: num(resumo.valor_inicial),
        dinheiro: num(resumo.dinheiro),
        pix: num(resumo.pix),
        cartao_credito: num(resumo.cartao_credito),
        cartao_debito: num(resumo.cartao_debito),
        vales: num(resumo.vales),
        outros: num(resumo.outros),
        total_vendido: num(resumo.total_vendido),
        suprimentos: num(resumo.suprimentos),
        sangrias: num(resumo.sangrias),
        valor_esperado: num(resumo.valor_esperado),
        valor_esperado_dinheiro: num(resumo.valor_esperado_dinheiro),
        valor_contado: resumo.valor_contado == null ? null : num(resumo.valor_contado),
        diferenca: resumo.diferenca == null ? null : num(resumo.diferenca),
      },
      movimentos: movimentos.map((m: any) => ({ ...m, valor: num(m.valor) })),
      pagamentos: pagamentos.map((p: any) => ({
        ...p,
        valor: num(p.valor),
        valor_troco: num(p.valor_troco),
      })),
    };
  }

  async abrir(dto: AbrirCaixaDto, user: { id: number; nome: string }) {
    const ja = await this.meuAberto(user.id);
    if (ja) {
      throw new ConflictException(`Você já tem o caixa #${ja.id} aberto — feche antes de abrir outro`);
    }
    let cx: any;
    try {
      const rows = await this.db.query<any>(
        `INSERT INTO caixa (operador_id, valor_inicial, observacao)
         VALUES ($1,$2,$3) RETURNING *`,
        [user.id, dto.valorInicial ?? 0, dto.observacao ?? null],
      );
      cx = rows[0];
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException('Você já tem um caixa aberto — feche antes de abrir outro');
      }
      throw e;
    }
    this.ws.emitToRooms(['caixa'], 'caixa.aberto', {
      caixaId: cx.id,
      operador: user.nome,
      valorInicial: num(cx.valor_inicial),
    });
    return this.detalhar(cx.id);
  }

  async lancarMovimento(id: number, dto: MovimentoCaixaDto, userId: number) {
    const cx = await this.db.queryOne<any>(`SELECT * FROM caixa WHERE id = $1`, [id]);
    if (!cx) throw new NotFoundException('Caixa não encontrado');
    if (cx.status !== 'ABERTO') throw new BadRequestException('Caixa fechado — não aceita movimentos');
    const rows = await this.db.query(
      `INSERT INTO caixa_movimento (caixa_id, tipo, valor, motivo, usuario_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, dto.tipo, dto.valor, dto.motivo, userId],
    );
    const det = await this.detalhar(id);
    this.ws.emitToRooms(['caixa'], 'caixa.movimento', {
      caixaId: id,
      movimento: rows[0],
      valorEsperado: det.resumo?.valor_esperado,
    });
    return det;
  }

  async fechar(id: number, dto: FecharCaixaDto, user: { id: number; papel: string }) {
    const cx = await this.db.queryOne<any>(`SELECT * FROM caixa WHERE id = $1`, [id]);
    if (!cx) throw new NotFoundException('Caixa não encontrado');
    if (cx.status !== 'ABERTO') throw new BadRequestException('Caixa já está fechado');
    if (Number(cx.operador_id) !== user.id && user.papel === 'CAIXA') {
      throw new ForbiddenException('Caixa de outro operador — só gerente fecha');
    }
    const r = await this.db.queryOne<any>(`SELECT * FROM vw_caixa_resumo WHERE caixa_id = $1`, [id]);
    const esperadoCents = toCents(r?.valor_esperado);
    const contadoCents = toCents(dto.valorContado);
    const diferenca = toReais(contadoCents - esperadoCents);
    await this.db.execute(
      `UPDATE caixa SET status = 'FECHADO', fechado_em = now(), valor_contado = $1,
              diferenca = $2,
              observacao = CASE WHEN $3 = '' THEN observacao
                                ELSE COALESCE(observacao,'') || $3 END
       WHERE id = $4`,
      [toReais(contadoCents), diferenca, dto.observacao ? ` | Fechamento: ${dto.observacao}` : '', id],
    );
    const det = await this.detalhar(id);
    this.ws.emitToRooms(['caixa'], 'caixa.fechado', {
      caixaId: id,
      valorEsperado: toReais(esperadoCents),
      valorContado: toReais(contadoCents),
      diferenca,
    });
    return {
      ...det,
      conferencia: {
        esperado: toReais(esperadoCents),
        contado: toReais(contadoCents),
        diferenca,
        ok: diferenca === 0,
        mensagem:
          diferenca === 0
            ? 'Caixa bateu exato ✔'
            : diferenca > 0
              ? `Sobra de R$ ${br(diferenca)}`
              : `Falta de R$ ${br(Math.abs(diferenca))}`,
      },
    };
  }
}
