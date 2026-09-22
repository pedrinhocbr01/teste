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
    const rows = await this.db.query(
      `INSERT INTO usuario (nome, email, pin_hash, papel)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nome, email, papel, ativo, criado_em`,
      [dto.nome, dto.email ?? null, hash, dto.papel],
    );
    return rows[0];
  }

  async update(id: number, dto: AtualizarUsuarioDto) {
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
    const rows = await this.db.query(
      `UPDATE usuario SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, nome, email, papel, ativo, criado_em`,
      params,
    );
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
