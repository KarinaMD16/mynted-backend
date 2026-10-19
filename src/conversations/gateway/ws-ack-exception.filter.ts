import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
  WsExceptionFilter,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

export interface WsErrorAck {
  ok: false;
  error: { status: number; message: string | string[] };
}

export function toWsErrorAck(exception: unknown): WsErrorAck {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    const message =
      typeof response === 'object' && response !== null && 'message' in response
        ? (response as { message: string | string[] }).message
        : exception.message;
    return { ok: false, error: { status: exception.getStatus(), message } };
  }
  if (exception instanceof WsException) {
    const error = exception.getError();
    return {
      ok: false,
      error: {
        status: 400,
        message: typeof error === 'string' ? error : exception.message,
      },
    };
  }
  return { ok: false, error: { status: 500, message: 'Error interno' } };
}

/**
 * El filtro por defecto de Nest solo emite 'exception' (y convierte las
 * HttpException en "Internal server error"), así que un cliente que usa
 * acknowledgements se quedaría esperando. Este responde el error por el ack
 * si lo hay (los handlers reciben [socket, data, ack]) y, si no, lo emite como
 * 'exception', conservando el status de Forbidden/NotFound/BadRequest.
 */
@Catch()
export class WsAckExceptionFilter implements WsExceptionFilter {
  private readonly logger = new Logger(WsAckExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const payload = toWsErrorAck(exception);
    if (payload.error.status >= 500) this.logger.error(exception);

    const ack = host.getArgByIndex<unknown>(2);
    if (typeof ack === 'function') {
      (ack as (response: WsErrorAck) => void)(payload);
      return;
    }
    host
      .switchToWs()
      .getClient<Socket>()
      .emit('exception', {
        ...payload.error,
        event: host.switchToWs().getPattern(),
      });
  }
}
