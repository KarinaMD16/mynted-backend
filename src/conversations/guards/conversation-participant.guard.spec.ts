import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CosmeticsService } from '../../cosmetics/cosmetics.service';
import { Product } from '../../products/entities/product.entity';
import { ConversationsService } from '../conversations.service';
import { Conversation } from '../entities/conversation.entity';
import { ConversationParticipantGuard } from './conversation-participant.guard';

describe('ConversationParticipantGuard', () => {
  const conversation = {
    id: 15,
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    productId: 42,
  } as Conversation;
  const conversationRepository = { findOne: jest.fn() };
  // Servicio real con repositorio mockeado: así se prueba la regla de
  // participación que comparten el guard y el servicio.
  const guard = new ConversationParticipantGuard(
    new ConversationsService(
      conversationRepository as unknown as Repository<Conversation>,
      {} as Repository<Product>,
      {} as DataSource,
      {} as CosmeticsService,
    ),
  );

  const buildContext = (userId: string, conversationId: string) => {
    const request: Record<string, unknown> = {
      user: { userId },
      params: { conversationId },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['buyer-1', 'seller-1'])(
    'lets participant %s through and attaches the conversation',
    async (userId) => {
      conversationRepository.findOne.mockResolvedValue(conversation);
      const { context, request } = buildContext(userId, '15');

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.conversation).toBe(conversation);
      expect(conversationRepository.findOne).toHaveBeenCalledWith({
        where: { id: 15 },
      });
    },
  );

  it('rejects a non-participant with ForbiddenException', async () => {
    conversationRepository.findOne.mockResolvedValue(conversation);
    const { context, request } = buildContext('intruder-1', '15');

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(request.conversation).toBeUndefined();
  });

  it('throws NotFoundException when the conversation does not exist', async () => {
    conversationRepository.findOne.mockResolvedValue(null);

    await expect(
      guard.canActivate(buildContext('buyer-1', '999').context),
    ).rejects.toThrow(NotFoundException);
  });

  it.each(['abc', '0', '-3', '1.5', '2147483648'])(
    'rejects an invalid conversationId (%s) before querying',
    async (conversationId) => {
      await expect(
        guard.canActivate(buildContext('buyer-1', conversationId).context),
      ).rejects.toThrow(BadRequestException);
      expect(conversationRepository.findOne).not.toHaveBeenCalled();
    },
  );
});
