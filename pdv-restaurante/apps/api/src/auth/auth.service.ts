import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DbService } from '../common/db/db.service';
import { LoginPinDto } from './dto';

const MAX_TENTATIVAS = 5; // erros seguidos até bloquear
const BLOQUEIO_MS = 5 * 60 * 1000; // 5 min (PIN tem só 4–6 dígitos: força bruta é trivial sem trava)

@Injectable()
export class AuthService {
  /** Trava de força bruta por usuário, em memória (PDV roda instância única;
   *  multi-instância exigiria contagem compartilhada, ex. Redis). */
  private readonly tentativas = new Map<string, { erros: number; bloqueadoAte: number }>();
  private dummyHash = '';

  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
  ) {}

  private chaveTentativa(dto: LoginPinDto): string {
    return dto.usuarioId ? `id:${dto.usuarioId}` : `email:${String(dto.email).toLowerCase()}`;
  }

  private verificarBloqueio(chave: string) {
    const t = this.tentativas.get(chave);
    if (t && t.bloqueadoAte > Date.now()) {
      const s = Math.ceil((t.bloqueadoAte - Date.now()) / 1000);
      throw new HttpException(
        `Muitas tentativas erradas — aguarde ${s}s e tente de novo`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private registrarFalha(chave: string) {
    if (this.tentativas.size > 10000) {
      const agora = Date.now();
      for (const [k, v] of this.tentativas) {
        if (v.bloqueadoAte < agora && v.erros === 0) this.tentativas.delete(k);
      }
    }
    const t = this.tentativas.get(chave) ?? { erros: 0, bloqueadoAte: 0 };
    t.erros += 1;
    if (t.erros >= MAX_TENTATIVAS) {
      t.bloqueadoAte = Date.now() + BLOQUEIO_MS;
      t.erros = 0;
    }
    this.tentativas.set(chave, t);
  }

  async loginPin(dto: LoginPinDto) {
    if (!dto.email && !dto.usuarioId) {
      throw new BadRequestException('Informe email ou usuarioId + pin');
    }
    const chave = this.chaveTentativa(dto);
    this.verificarBloqueio(chave);
    const row = dto.usuarioId
      ? await this.db.queryOne<any>(`SELECT * FROM usuario WHERE id = $1`, [
          dto.usuarioId,
        ])
      : await this.db.queryOne<any>(
          `SELECT * FROM usuario WHERE lower(email) = lower($1)`,
          [dto.email],
        );
    if (!row || !row.ativo) {
      // compare falso: usuário inexistente "demora" igual (não revela enumeração)
      if (!this.dummyHash) this.dummyHash = bcrypt.hashSync('pdv-dummy', 10);
      await bcrypt.compare(dto.pin, this.dummyHash);
      this.registrarFalha(chave);
      throw new UnauthorizedException('Usuário não encontrado ou inativo');
    }
    if (!row.pin_hash || row.pin_hash.startsWith('TROCAR')) {
      this.registrarFalha(chave);
      throw new UnauthorizedException(
        'PIN ainda não configurado — peça ao gerente para resetar seu PIN',
      );
    }
    const ok = await bcrypt.compare(dto.pin, row.pin_hash);
    if (!ok) {
      this.registrarFalha(chave);
      throw new UnauthorizedException('PIN incorreto');
    }
    this.tentativas.delete(chave);
    const access_token = await this.jwt.signAsync({
      sub: row.id,
      papel: row.papel,
      nome: row.nome,
    });
    return {
      access_token,
      usuario: { id: row.id, nome: row.nome, papel: row.papel },
    };
  }

  async me(userId: number) {
    const row = await this.db.queryOne<any>(
      `SELECT id, nome, email, papel, ativo, criado_em FROM usuario WHERE id = $1`,
      [userId],
    );
    if (!row) throw new UnauthorizedException('Usuário não existe mais');
    return row;
  }

  async trocarPin(userId: number, pinAtual: string, pinNovo: string) {
    const row = await this.db.queryOne<any>(
      `SELECT pin_hash FROM usuario WHERE id = $1`,
      [userId],
    );
    if (!row?.pin_hash || !(await bcrypt.compare(pinAtual, row.pin_hash))) {
      throw new UnauthorizedException('PIN atual incorreto');
    }
    const hash = bcrypt.hashSync(pinNovo, 10);
    await this.db.execute(`UPDATE usuario SET pin_hash = $1 WHERE id = $2`, [
      hash,
      userId,
    ]);
    return { ok: true };
  }
}
