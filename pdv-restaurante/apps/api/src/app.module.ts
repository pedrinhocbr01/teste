import { Module } from '@nestjs/common';
import { DbModule } from './common/db/db.module';
import { AuthModule } from './auth/auth.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { CardapioModule } from './cardapio/cardapio.module';
import { EstoqueModule } from './estoque/estoque.module';
import { MesasModule } from './mesas/mesas.module';
import { AtendimentoModule } from './atendimento/atendimento.module';
import { ContasModule } from './contas/contas.module';
import { CaixaModule } from './caixa/caixa.module';
import { WsModule } from './ws/ws.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    DbModule,
    WsModule,
    AuthModule,
    UsuariosModule,
    CardapioModule,
    EstoqueModule,
    MesasModule,
    AtendimentoModule,
    ContasModule,
    CaixaModule,
    HealthModule,
  ],
})
export class AppModule {}
