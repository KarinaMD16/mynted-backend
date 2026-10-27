import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import 'multer';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { PriceDisplayService } from '../pricing/price-display.service';
import { CosmeticsService } from '../cosmetics/cosmetics.service';
import { FALLBACK_USER_DISPLAY } from '../cosmetics/user-display-summary';
import { Seller } from '../sellers/entities/seller.entity';
import {
  otherParticipantId,
  toMessageResponse,
  toParticipantSummary,
  toProductContext,
} from './conversation-views';
import { CreateTextMessageDto } from './dto/create-text-message.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import {
  MessageHistoryResponseDto,
  MessageResponseDto,
} from './dto/message-response.dto';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import {
  imageMessagePayload,
  NewMessagePayload,
  textMessagePayload,
} from './message-payload';

/**
 * Resultados de las escrituras. Además de lo que responde el endpoint traen
 * quién es el destinatario y qué ids cambiaron, para que el gateway del
 * Bloque 4 pueda emitir eventos tras persistir sin volver a consultar. El
 * service no conoce al gateway: quien lo llame decide si emite.
 */
export interface MessageCreatedResult {
  message: MessageResponseDto;
  conversationId: number;
  senderId: string;
  recipientId: string;
}

export interface MessagesReadResult {
  conversationId: number;
  readerId: string;
  // Autor de los mensajes marcados (a quien avisar del "visto").
  senderId: string;
  markedCount: number;
  messageIds: number[];
  readAt: Date | null;
  // No leídos del lector en esta conversación después de marcar (0 salvo que
  // haya llegado un mensaje entre el UPDATE y el conteo).
  unreadCount: number;
}

// Todos los métodos reciben la conversación ya validada por
// ConversationParticipantGuard (req.conversation): no repiten el chequeo de
// participación ni miran el estado del producto, así que los hilos de un
// producto vendido u oculto siguen legibles y escribibles.
@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Seller)
    private readonly sellerRepository: Repository<Seller>,
    private readonly dataSource: DataSource,
    private readonly cloudinaryService: CloudinaryService,
    private readonly priceDisplay: PriceDisplayService,
    private readonly cosmeticsService: CosmeticsService,
  ) {}

  // Más recientes primero, paginado por cursor (id del último mensaje
  // recibido). El orden es (created_at, id) desc; el cursor se resuelve en
  // SQL para no perder los microsegundos de created_at al pasar por JS.
  async getHistory(
    conversation: Conversation,
    viewerId: string,
    query: GetMessagesQueryDto,
    displayCurrency: string,
  ): Promise<MessageHistoryResponseDto> {
    if (query.cursor !== undefined) {
      const cursorExists = await this.messageRepository.exists({
        where: { id: query.cursor, conversationId: conversation.id },
      });
      if (!cursorExists) {
        throw new BadRequestException(
          'cursor no corresponde a un mensaje de esta conversación',
        );
      }
    }

    const qb = this.messageRepository
      .createQueryBuilder('m')
      .where('m.conversationId = :conversationId', {
        conversationId: conversation.id,
      });
    if (query.cursor !== undefined) {
      qb.andWhere(
        '(m.created_at, m.id) < (SELECT cur.created_at, cur.id FROM message cur WHERE cur.id = :cursor)',
        { cursor: query.cursor },
      );
    }
    // Se pide uno de más para saber si hay otra página.
    const [messages, context] = await Promise.all([
      qb
        .orderBy('m.createdAt', 'DESC')
        .addOrderBy('m.id', 'DESC')
        .limit(query.limit + 1)
        .getMany(),
      this.getContext(conversation.id, viewerId, displayCurrency),
    ]);

    const hasMore = messages.length > query.limit;
    const page = hasMore ? messages.slice(0, query.limit) : messages;

    return {
      conversation: context,
      data: page.map(toMessageResponse),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // type 'text' lo fija textMessagePayload; del cliente solo llega content.
  sendText(
    conversation: Conversation,
    senderId: string,
    dto: CreateTextMessageDto,
  ): Promise<MessageCreatedResult> {
    return this.persist(conversation, senderId, textMessagePayload(dto));
  }

  // Sube primero y solo si Cloudinary responde crea el mensaje: si la subida
  // falla no queda ningún mensaje. imageUrl sale de la respuesta de
  // Cloudinary, nunca del request.
  async sendImage(
    conversation: Conversation,
    senderId: string,
    file: Express.Multer.File | undefined,
  ): Promise<MessageCreatedResult> {
    if (!file) {
      throw new BadRequestException(
        "Debes adjuntar una imagen en el campo 'image'",
      );
    }

    let upload: Awaited<ReturnType<CloudinaryService['uploadImage']>>;
    try {
      upload = await this.cloudinaryService.uploadImage(file);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException(
        'No se pudo subir la imagen. Intenta de nuevo',
      );
    }

    return this.persist(conversation, senderId, imageMessagePayload(upload));
  }

  // Marca como leídos los mensajes del otro participante. Idempotente: si no
  // hay pendientes devuelve markedCount 0.
  async markAsRead(
    conversation: Conversation,
    readerId: string,
  ): Promise<MessagesReadResult> {
    const result = await this.messageRepository
      .createQueryBuilder()
      .update(Message)
      .set({ readAt: () => 'now()' })
      .where('conversation_id = :conversationId', {
        conversationId: conversation.id,
      })
      .andWhere('sender_id <> :readerId', { readerId })
      .andWhere('read_at IS NULL')
      .returning('id, read_at')
      .execute();
    const rows = (result.raw ?? []) as { id: number; read_at: Date }[];

    // Si no se marcó nada es porque no había pendientes: no hace falta contar.
    const unreadCount =
      rows.length === 0
        ? 0
        : await this.messageRepository.count({
            where: {
              conversationId: conversation.id,
              senderId: Not(readerId),
              readAt: IsNull(),
            },
          });

    return {
      conversationId: conversation.id,
      readerId,
      senderId: otherParticipantId(conversation, readerId),
      markedCount: rows.length,
      messageIds: rows.map((row) => row.id),
      readAt: rows[0]?.read_at ?? null,
      unreadCount,
    };
  }

  // Inserta el mensaje y adelanta last_message_at en la misma transacción.
  // GREATEST evita que una transacción concurrente más vieja lo retroceda.
  private async persist(
    conversation: Conversation,
    senderId: string,
    payload: NewMessagePayload,
  ): Promise<MessageCreatedResult> {
    const message = await this.dataSource.transaction(async (manager) => {
      const messages = manager.getRepository(Message);
      const saved = await messages.save(
        messages.create({
          conversationId: conversation.id,
          senderId,
          ...payload,
        }),
      );
      await manager.update(
        Conversation,
        { id: conversation.id },
        { lastMessageAt: () => 'GREATEST(last_message_at, now())' },
      );
      return saved;
    });

    return {
      message: toMessageResponse(message),
      conversationId: conversation.id,
      senderId,
      recipientId: otherParticipantId(conversation, senderId),
    };
  }

  private async getContext(
    conversationId: number,
    viewerId: string,
    displayCurrency: string,
  ) {
    // withDeleted: un producto borrado lógicamente conserva sus conversaciones.
    const conversation = await this.conversationRepository.findOneOrFail({
      where: { id: conversationId },
      relations: { buyer: true, seller: true, product: true },
      withDeleted: true,
    });
    const other =
      conversation.buyerId === viewerId
        ? conversation.seller
        : conversation.buyer;
    const [otherSeller, rates, otherDisplay] = await Promise.all([
      this.sellerRepository.findOne({
        where: { userId: other.id },
        select: { sellerId: true, displayName: true, isVerified: true },
      }),
      this.priceDisplay.getDisplayRates(displayCurrency, [
        conversation.product.currency,
      ]),
      this.cosmeticsService.getEffectiveSummaryForUsers([other.id]),
    ]);

    return {
      id: conversation.id,
      product: {
        ...toProductContext(conversation.product),
        ...this.priceDisplay.toDisplay(
          conversation.product,
          displayCurrency,
          rates,
        ),
      },
      otherParticipant: toParticipantSummary(
        other,
        otherSeller,
        otherDisplay.get(other.id) ?? FALLBACK_USER_DISPLAY,
      ),
    };
  }
}
