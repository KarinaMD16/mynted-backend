import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../../auth/types/authenticated-request';
import { ConversationsService } from '../conversations.service';
import { Conversation } from '../entities/conversation.entity';

export interface ConversationParticipantRequest extends AuthenticatedRequest {
  conversation: Conversation;
}

/**
 * Debe usarse después de JwtAuthGuard
 * (@UseGuards(JwtAuthGuard, ConversationParticipantGuard)) ya que depende de
 * req.user. Lee :conversationId de los params de la ruta y solo deja pasar al
 * comprador o al vendedor de esa conversación (403 al resto, 404 si no
 * existe). La conversación queda en req.conversation para que el handler no
 * vuelva a consultarla.
 */
@Injectable()
export class ConversationParticipantGuard implements CanActivate {
  constructor(private readonly conversationsService: ConversationsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<ConversationParticipantRequest>();
    // Los guards corren antes que los pipes, así que ParseIntPipe en el
    // handler todavía no validó el param.
    const conversationId = Number(req.params.conversationId);
    if (!Number.isInteger(conversationId) || conversationId < 1) {
      throw new BadRequestException(
        'conversationId debe ser un entero positivo',
      );
    }

    req.conversation = await this.conversationsService.findForParticipant(
      conversationId,
      req.user.userId,
    );
    return true;
  }
}
