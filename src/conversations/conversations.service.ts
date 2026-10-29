import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { CosmeticsService } from '../cosmetics/cosmetics.service';
import {
  FALLBACK_USER_DISPLAY,
  UserDisplaySummary,
} from '../cosmetics/user-display-summary';
import { Product, ProductStatus } from '../products/entities/product.entity';
import { toParticipantSummary, toProductSummary } from './conversation-views';
import { ConversationResponseDto } from './dto/conversation-response.dto';
import { GetInboxQueryDto } from './dto/get-inbox-query.dto';
import { InboxItemDto, InboxResponseDto } from './dto/inbox-response.dto';
import { Conversation } from './entities/conversation.entity';
import { MessageType } from './enums/message-type.enum';

export interface FindOrCreateConversationResult {
  conversation: ConversationResponseDto;
  created: boolean;
}

interface PostgresError {
  code?: string;
  constraint?: string;
}

interface InboxRow {
  id: number;
  last_message_at: Date;
  other_id: string;
  other_username: string;
  other_photo_url: string | null;
  other_display_name: string | null;
  other_is_verified: boolean | null;
  product_id: number;
  product_title: string;
  product_price: string;
  product_discount_percent: string | null;
  product_currency: string | null;
  product_image_url: string | null;
  last_message_id: number;
  last_message_type: MessageType;
  last_message_content: string | null;
  last_message_sender_id: string;
  last_message_created_at: Date;
  unread_count: number;
}

const UNIQUE_CONVERSATION_CONSTRAINT =
  'UQ_conversation_buyer_id_seller_id_product_id';

// Conversaciones del usuario ($1) que tienen al menos un mensaje. Se filtra
// con EXISTS y no con last_message_at, que arranca en now() al crearse la
// conversación aunque nadie haya escrito todavía.
const INBOX_WHERE = `(c.buyer_id = $1 OR c.seller_id = $1)
  AND EXISTS (SELECT 1 FROM message em WHERE em.conversation_id = c.id)`;

// Una sola consulta por página (sin N+1): el otro participante y su tienda,
// el producto (incluso si fue borrado lógicamente), el último mensaje vía
// LATERAL y los no leídos con un COUNT correlacionado (usa el índice
// conversation_id, created_at).
const INBOX_PAGE_SQL = `
  SELECT c.id,
         c.last_message_at,
         other.id            AS other_id,
         other.username      AS other_username,
         other.photo_url     AS other_photo_url,
         s.display_name      AS other_display_name,
         s.is_verified       AS other_is_verified,
         p.id                AS product_id,
         p.title             AS product_title,
         p.price             AS product_price,
         p.discount_percent  AS product_discount_percent,
         p.currency          AS product_currency,
         p.image_url         AS product_image_url,
         lm.id               AS last_message_id,
         lm.type             AS last_message_type,
         lm.content          AS last_message_content,
         lm.sender_id        AS last_message_sender_id,
         lm.created_at       AS last_message_created_at,
         (SELECT COUNT(*)::int
            FROM message um
           WHERE um.conversation_id = c.id
             AND um.sender_id <> $1
             AND um.read_at IS NULL) AS unread_count
    FROM conversation c
    JOIN users other
      ON other.id = CASE WHEN c.buyer_id = $1 THEN c.seller_id ELSE c.buyer_id END
    LEFT JOIN seller s ON s.user_id = other.id
    JOIN product p ON p.id = c.product_id
    LEFT JOIN LATERAL (
      SELECT m.id, m.type, m.content, m.sender_id, m.created_at
        FROM message m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1
    ) lm ON true
   WHERE ${INBOX_WHERE}
   ORDER BY c.last_message_at DESC, c.id DESC
   LIMIT $2 OFFSET $3`;

const INBOX_COUNT_SQL = `
  SELECT COUNT(*)::int AS total
    FROM conversation c
   WHERE ${INBOX_WHERE}`;

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly cosmeticsService: CosmeticsService,
  ) {}

  async hasSellerMessageForProduct(
    buyerId: string,
    productId: number,
    sellerUserId: string,
  ): Promise<boolean> {
    const rows = await this.dataSource.query<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1
           FROM conversation c
           INNER JOIN message m ON m.conversation_id = c.id
          WHERE c.buyer_id = $1
            AND c.product_id = $2
            AND c.seller_id = $3
            AND m.sender_id = c.seller_id
       ) AS exists`,
      [buyerId, productId, sellerUserId],
    );

    return rows[0]?.exists === true;
  }

  // Bandeja del usuario como comprador o vendedor, más reciente primero.
  async getInbox(
    userId: string,
    query: GetInboxQueryDto,
  ): Promise<InboxResponseDto> {
    const { page, limit } = query;
    const [rows, countRows] = await Promise.all([
      this.dataSource.query<InboxRow[]>(INBOX_PAGE_SQL, [
        userId,
        limit,
        (page - 1) * limit,
      ]),
      this.dataSource.query<{ total: number }[]>(INBOX_COUNT_SQL, [userId]),
    ]);
    const total = countRows[0]?.total ?? 0;
    // Badge Pro y marco de todos los participantes de la página: una sola
    // resolución por lotes, no una por conversación.
    const displays = await this.cosmeticsService.getEffectiveSummaryForUsers(
      rows.map((row) => row.other_id),
    );

    return {
      data: rows.map((row) =>
        this.toInboxItem(
          row,
          displays.get(row.other_id) ?? FALLBACK_USER_DISPLAY,
        ),
      ),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Idempotente por (comprador, vendedor, producto). Si la conversación ya
  // existe se devuelve aunque el producto ya no esté activo o visible (p. ej.
  // vendido u oculto): status e isVisible solo bloquean abrir conversaciones
  // nuevas.
  async findOrCreate(
    buyerId: string,
    productId: number,
  ): Promise<FindOrCreateConversationResult> {
    const product = await this.productRepository.findOne({
      where: { id: productId },
      relations: { seller: true },
      select: {
        id: true,
        status: true,
        isVisible: true,
        seller: { sellerId: true, userId: true },
      },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const sellerId = product.seller.userId;
    if (sellerId === buyerId) {
      throw new ForbiddenException(
        'No puedes iniciar una conversación sobre tu propio producto',
      );
    }

    const existing = await this.findExisting(buyerId, sellerId, productId);
    if (existing)
      return { conversation: this.toResponse(existing), created: false };

    // Mismo criterio que los listados públicos: activo y visible.
    if (product.status !== ProductStatus.ACTIVE || !product.isVisible) {
      throw new BadRequestException('El producto no está disponible');
    }

    try {
      const conversation = await this.conversationRepository.save(
        this.conversationRepository.create({ buyerId, sellerId, productId }),
      );
      return { conversation: this.toResponse(conversation), created: true };
    } catch (error: unknown) {
      // Dos solicitudes simultáneas pueden pasar el findExisting; la que
      // pierde contra el índice único devuelve la que ganó.
      if (this.isUniqueConversationViolation(error)) {
        const winner = await this.findExisting(buyerId, sellerId, productId);
        if (winner) {
          return { conversation: this.toResponse(winner), created: false };
        }
      }
      throw error;
    }
  }

  // Resuelve la conversación solo si userId es su comprador o vendedor.
  // Lo usa ConversationParticipantGuard y sirve para contextos sin guards
  // HTTP (p. ej. un gateway de websockets).
  async findForParticipant(
    conversationId: number,
    userId: string,
  ): Promise<Conversation> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    if (!isConversationParticipant(conversation, userId)) {
      throw new ForbiddenException('No participas en esta conversación');
    }
    return conversation;
  }

  // Total de no leídos del usuario en todas sus conversaciones (badge del
  // nav): mensajes del otro participante con read_at null. Un solo COUNT; las
  // conversaciones salen por los índices de buyer_id/seller_id y sus mensajes
  // por IDX_message_conversation_id_created_at.
  async getTotalUnread(userId: string): Promise<number> {
    const rows = await this.dataSource.query<{ total: number }[]>(
      `SELECT COUNT(*)::int AS total
         FROM conversation c
         JOIN message m ON m.conversation_id = c.id
        WHERE (c.buyer_id = $1 OR c.seller_id = $1)
          AND m.sender_id <> $1
          AND m.read_at IS NULL`,
      [userId],
    );
    return rows[0]?.total ?? 0;
  }

  // Usuarios con los que userId comparte al menos una conversación (para
  // avisarles de su presencia).
  async findCounterpartIds(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query<{ user_id: string }[]>(
      `SELECT DISTINCT
              CASE WHEN c.buyer_id = $1 THEN c.seller_id ELSE c.buyer_id END
                AS user_id
         FROM conversation c
        WHERE c.buyer_id = $1 OR c.seller_id = $1`,
      [userId],
    );
    return rows.map((row) => row.user_id);
  }

  toResponse(conversation: Conversation): ConversationResponseDto {
    return {
      id: conversation.id,
      productId: conversation.productId,
      buyerId: conversation.buyerId,
      sellerId: conversation.sellerId,
      createdAt: conversation.createdAt,
      lastMessageAt: conversation.lastMessageAt,
    };
  }

  private toInboxItem(
    row: InboxRow,
    display: UserDisplaySummary,
  ): InboxItemDto {
    return {
      id: row.id,
      otherParticipant: toParticipantSummary(
        {
          id: row.other_id,
          username: row.other_username,
          photoUrl: row.other_photo_url,
        },
        row.other_display_name === null
          ? null
          : {
              displayName: row.other_display_name,
              isVerified: row.other_is_verified ?? false,
            },
        display,
      ),
      product: toProductSummary({
        id: row.product_id,
        title: row.product_title,
        price: parseFloat(row.product_price),
        discountPercent:
          row.product_discount_percent === null
            ? null
            : parseFloat(row.product_discount_percent),
        currency: row.product_currency,
        imageUrl: row.product_image_url,
      }),
      lastMessage: {
        id: row.last_message_id,
        type: row.last_message_type,
        content:
          row.last_message_type === MessageType.TEXT
            ? row.last_message_content
            : null,
        senderId: row.last_message_sender_id,
        createdAt: row.last_message_created_at,
      },
      unreadCount: row.unread_count,
      lastMessageAt: row.last_message_at,
    };
  }

  private findExisting(buyerId: string, sellerId: string, productId: number) {
    return this.conversationRepository.findOne({
      where: { buyerId, sellerId, productId },
    });
  }

  private isUniqueConversationViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as PostgresError;
    return (
      driverError.code === '23505' &&
      driverError.constraint === UNIQUE_CONVERSATION_CONSTRAINT
    );
  }
}

export function isConversationParticipant(
  conversation: Pick<Conversation, 'buyerId' | 'sellerId'>,
  userId: string,
): boolean {
  return conversation.buyerId === userId || conversation.sellerId === userId;
}
