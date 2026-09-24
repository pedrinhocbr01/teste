import { Module } from '@nestjs/common';
import { CaixaService } from './caixa.service';
import { CaixaController } from './caixa.controller';

@Module({
  providers: [CaixaService],
  controllers: [CaixaController],
})
export class CaixaModule {}
