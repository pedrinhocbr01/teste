import { Global, Module } from '@nestjs/common';
import { PdvGateway } from './pdv.gateway';

@Global()
@Module({
  providers: [PdvGateway],
  exports: [PdvGateway],
})
export class WsModule {}
