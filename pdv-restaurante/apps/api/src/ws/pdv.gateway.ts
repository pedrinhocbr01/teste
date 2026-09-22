import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * Realtime da Fase 1 (Socket.IO).
 * Salas: mesa:{id} · pedido:{id} · cozinha · bar · caixa · garcom:{id}
 * Eventos: pedido.enviado · item.status · item.adicionado · mesa.status
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class PdvGateway {
  @WebSocketServer()
  server!: Server;

  @SubscribeMessage('join')
  handleJoin(
    @MessageBody() data: { rooms?: string[] },
    @ConnectedSocket() client: Socket,
  ) {
    const rooms = Array.isArray(data?.rooms) ? data.rooms.slice(0, 20) : [];
    const joined: string[] = [];
    for (const r of rooms) {
      if (typeof r === 'string' && /^[a-z0-9:_-]{1,40}$/i.test(r)) {
        client.join(r);
        joined.push(r);
      }
    }
    return { joined };
  }

  emitToRooms(rooms: string[], event: string, payload: any) {
    if (!this.server) return;
    for (const r of rooms) this.server.to(r).emit(event, payload);
  }

  emitAll(event: string, payload: any) {
    this.server?.emit(event, payload);
  }
}
