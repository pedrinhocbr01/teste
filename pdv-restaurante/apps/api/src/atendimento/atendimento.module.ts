import { Module } from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { PedidosController } from './pedidos.controller';
import { ImpressaoController } from './impressao.controller';

@Module({
  providers: [PedidosService],
  controllers: [PedidosController, ImpressaoController],
})
export class AtendimentoModule {}
