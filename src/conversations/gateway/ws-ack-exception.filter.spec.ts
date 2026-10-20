import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { toWsErrorAck, WsAckExceptionFilter } from './ws-ack-exception.filter';

describe('WsAckExceptionFilter', () => {
  const buildHost = (ack?: jest.Mock) => {
    const client = { emit: jest.fn() };
    const host = {
      getArgByIndex: (index: number) => [client, {}, ack][index],
      switchToWs: () => ({
        getClient: () => client,
        getPattern: () => 'conversation:join',
      }),
    } as unknown as ArgumentsHost;
    return { host, client };
  };

  it('answers through the ack keeping the HTTP status', () => {
    const ack = jest.fn();
    const { host, client } = buildHost(ack);

    new WsAckExceptionFilter().catch(
      new ForbiddenException('No participas en esta conversación'),
      host,
    );

    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: { status: 403, message: 'No participas en esta conversación' },
    });
    expect(client.emit).not.toHaveBeenCalled();
  });

  it("emits 'exception' when the client did not send an ack", () => {
    const { host, client } = buildHost();

    new WsAckExceptionFilter().catch(new BadRequestException('x'), host);

    expect(client.emit).toHaveBeenCalledWith('exception', {
      status: 400,
      message: 'x',
      event: 'conversation:join',
    });
  });

  it('keeps the list of validation messages', () => {
    const error = new BadRequestException([
      'conversationId debe ser un entero positivo',
    ]);

    expect(toWsErrorAck(error)).toEqual({
      ok: false,
      error: {
        status: 400,
        message: ['conversationId debe ser un entero positivo'],
      },
    });
  });

  it('maps WsException to 400 and unknown errors to a generic 500', () => {
    expect(toWsErrorAck(new WsException('mal'))).toEqual({
      ok: false,
      error: { status: 400, message: 'mal' },
    });
    expect(toWsErrorAck(new Error('detalle interno'))).toEqual({
      ok: false,
      error: { status: 500, message: 'Error interno' },
    });
  });
});
