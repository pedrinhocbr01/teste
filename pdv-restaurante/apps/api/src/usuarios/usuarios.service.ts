import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DbService } from '../common/db/db.service';
import { CriarUsuarioDto, AtualizarUsuarioDto } from './dto';

@Injectable()
export class UsuariosService {
  constructor(private readonly db: DbService) {}

  list() {
    return this.db.query(
      `SELECT id, nome, email, papel, ativo, criado_em
       FROM usuario ORDER BY ativo DESC, nome`,
    );
  }

  async create(dto: CriarUsuarioDto) {
    if (dto.email) {
      const dup = await this.db.queryOne(
        `SELECT id FROM usuario WHERE lower(email) = lower($1)`,
        [dto.email],
      );
      if (dup) throw new BadRequestException('E-mail já cadastrado');
    }
    const hash = bcrypt.hashSync(dto.pin, 10);
    try {
      const rows = await this.db.query(
        `INSERT INTO usuario (nome, email, pin_hash, papel)
         VALUES ($1, $2, $3, $4)
         RETURNING id, nome, email, papel, ativo, criado_em`,
        [dto.nome, dto.email ?? null, hash, dto.papel],
      );
      return rows[0];
    } catch (e: any) {
      if (e?.code === '23505') throw new BadRequestException('E-mail já cadastrado');
      throw e;
    }
  }

  async update(id: number, dto: AtualizarUsuarioDto, currentUserId?: number) {
    if (currentUserId === id) {
      if (dto.ativo === false) {
        throw new BadRequestException('Você não pode desativar seu próprio usuário');
      }
      if (dto.papel !== undefined) {
        throw new BadRequestException('Você não pode trocar seu próprio papel — peça a outro gerente');
      }
    }
    if (dto.email !== undefined && dto.email !== null) {
      const dup = await this.db.queryOne(
        `SELECT id FROM usuario WHERE lower(email) = lower($1) AND id <> $2`,
        [dto.email, id],
      );
      if (dup) throw new BadRequestException('E-mail já cadastrado');
    }
    const rebaixando =
      dto.ativo === false || (dto.papel !== undefined && dto.papel !== 'GERENTE' && dto.papel !== 'ADMIN');
    if (rebaixando) {
      const alvo = await this.db.queryOne<any>(`SELECT papel, ativo FROM usuario WHERE id = $1`, [id]);
      if (alvo?.ativo && (alvo.papel === 'GERENTE' || alvo.papel === 'ADMIN')) {
        const outros = await this.db.queryOne<any>(
          `SELECT COUNT(*)::int AS n FROM usuario
           WHERE ativo AND papel IN ('GERENTE','ADMIN') AND id <> $1`,
          [id],
        );
        if (Number(outros?.n) === 0) {
          throw new BadRequestException(
            'Último gerente/admin ativo — promova outra pessoa antes de rebaixar/desativar',
          );
        }
      }
    }
    const sets: string[] = [];
    const params: any[] = [];
    const push = (col: string, v: any) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (dto.nome !== undefined) push('nome', dto.nome);
    if (dto.email !== undefined) push('email', dto.email);
    if (dto.papel !== undefined) push('papel', dto.papel);
    if (dto.ativo !== undefined) push('ativo', dto.ativo);
    if (sets.length === 0) throw new BadRequestException('Nada para atualizar');
    params.push(id);
    let rows: any[];
    try {
      rows = await this.db.query(
        `UPDATE usuario SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING id, nome, email, papel, ativo, criado_em`,
        params,
      );
    } catch (e: any) {
      if (e?.code === '23505') throw new BadRequestException('E-mail já cadastrado');
      throw e;
    }
    if (!rows[0]) throw new NotFoundException('Usuário não encontrado');
    return rows[0];
  }

  async resetPin(id: number, pinNovo: string) {
    const hash = bcrypt.hashSync(pinNovo, 10);
    const n = await this.db.execute(
      `UPDATE usuario SET pin_hash = $1 WHERE id = $2`,
      [hash, id],
    );
    if (!n) throw new NotFoundException('Usuário não encontrado');
    return { ok: true };
  }
}
