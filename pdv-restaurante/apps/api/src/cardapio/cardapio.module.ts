import { Module } from '@nestjs/common';
import { CardapioService } from './cardapio.service';
import { CardapioController } from './cardapio.controller';

@Module({
  providers: [CardapioService],
  controllers: [CardapioController],
})
export class CardapioModule {}
