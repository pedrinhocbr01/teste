import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

interface WsUser {
  id: number;
  papel: string;
  nome: string;
}

const SALA_CAIXA = ['CAIXA', 'GERENTE', 'ADMIN'];

/**
 * Realtime da Fase 1 (Socket.IO).
 * Salas: mesa:{id} · pedido:{id} · cozinha · bar · caixa · garcom:{id}
 * Eventos: pedido.enviado · item.status · item.adicionado · mesa.status ...
 *
 * Segurança (auditoria): exige JWT válido no handshake (auth.token) — sem
 * ele a conexão é recusada. A sala `caixa` trafega valores de pagamento e
 * é restrita a CAIXA/GERENTE/ADMIN; as demais salas operacionais são
 * liberadas p/ qualquer usuário autenticado.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class PdvGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService) {}

  afterInit(server: Server) {
    server.use(async (socket, next) => {
      const token = (socket.handshake.auth as any)?.token;
      if (!token) return next(new Error('WS exige autenticação (auth.token)'));
      try {
        const payload = await this.jwt.verifyAsync(token);
        (socket.data as any).user = {
          id: Number(payload.sub),
          papel: String(payload.papel),
          nome: String(payload.nome),
        } as WsUser;
        next();
      } catch {
        next(new Error('WS: token inválido ou expirado'));
      }
    });
  }

  @SubscribeMessage('join')
  handleJoin(
    @MessageBody() data: { rooms?: string[] },
    @ConnectedSocket() client: Socket,
  ) {
    const user = (client.data as any)?.user as WsUser | undefined;
    if (!user) return { joined: [], erro: 'não autenticado' };
    const rooms = Array.isArray(data?.rooms) ? data.rooms.slice(0, 20) : [];
    const joined: string[] = [];
    const negadas: string[] = [];
    for (const r of rooms) {
      if (typeof r === 'string' && /^[a-z0-9:_-]{1,40}$/i.test(r)) {
        if (r.toLowerCase() === 'caixa' && !SALA_CAIXA.includes(user.papel)) {
          negadas.push(r);
          continue;
        }
        client.join(r);
        joined.push(r);
      }
    }
    return negadas.length ? { joined, negadas } : { joined };
  }

  /** Sai de salas (a demo do garçom troca de mesa sem reconectar). */
  @SubscribeMessage('leave')
  handleLeave(
    @MessageBody() data: { rooms?: string[] },
    @ConnectedSocket() client: Socket,
  ) {
    const rooms = Array.isArray(data?.rooms) ? data.rooms.slice(0, 20) : [];
    const left: string[] = [];
    for (const r of rooms) {
      if (typeof r === 'string' && /^[a-z0-9:_-]{1,40}$/i.test(r)) {
        client.leave(r);
        left.push(r);
      }
    }
    return { left };
  }

  emitToRooms(rooms: string[], event: string, payload: any) {
    if (!this.server) return;
    for (const r of rooms) this.server.to(r).emit(event, payload);
  }

  emitAll(event: string, payload: any) {
    this.server?.emit(event, payload);
  }
}
