import { Module } from '@nestjs/common';
import { EstoqueService } from './estoque.service';
import { EstoqueController } from './estoque.controller';

@Module({
  providers: [EstoqueService],
  controllers: [EstoqueController],
})
export class EstoqueModule {}
