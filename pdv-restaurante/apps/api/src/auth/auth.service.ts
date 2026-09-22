import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DbService } from '../common/db/db.service';
import { LoginPinDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
  ) {}

  async loginPin(dto: LoginPinDto) {
    if (!dto.email && !dto.usuarioId) {
      throw new BadRequestException('Informe email ou usuarioId + pin');
    }
    const row = dto.usuarioId
      ? await this.db.queryOne<any>(`SELECT * FROM usuario WHERE id = $1`, [
          dto.usuarioId,
        ])
      : await this.db.queryOne<any>(
          `SELECT * FROM usuario WHERE lower(email) = lower($1)`,
          [dto.email],
        );
    if (!row || !row.ativo) {
      throw new UnauthorizedException('Usuário não encontrado ou inativo');
    }
    if (!row.pin_hash || row.pin_hash.startsWith('TROCAR')) {
      throw new UnauthorizedException(
        'PIN ainda não configurado — peça ao gerente para resetar seu PIN',
      );
    }
    const ok = await bcrypt.compare(dto.pin, row.pin_hash);
    if (!ok) throw new UnauthorizedException('PIN incorreto');
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
