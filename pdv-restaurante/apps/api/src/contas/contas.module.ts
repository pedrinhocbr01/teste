import { Module } from '@nestjs/common';
import { ContasService } from './contas.service';
import { ContasController } from './contas.controller';

@Module({
  providers: [ContasService],
  controllers: [ContasController],
})
export class ContasModule {}
