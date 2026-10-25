import { computeFinalPrice } from '../products/product-pricing';
import { Product, ProductStatus } from '../products/entities/product.entity';
import {
  ParticipantSummaryDto,
  ProductContextDto,
  ProductSummaryDto,
} from './dto/conversation-context.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

// Mapeos compartidos entre la bandeja (SQL crudo) y el historial (entidades).

export function otherParticipantId(
  conversation: Pick<Conversation, 'buyerId' | 'sellerId'>,
  userId: string,
): string {
  return conversation.buyerId === userId
    ? conversation.sellerId
    : conversation.buyerId;
}

export function toParticipantSummary(
  user: { id: string; username: string; photoUrl: string | null },
  seller: { displayName: string; isVerified: boolean } | null,
): ParticipantSummaryDto {
  return {
    id: user.id,
    username: user.username,
    displayName: seller?.displayName ?? user.username,
    photoUrl: user.photoUrl ?? null,
    isVerified: seller?.isVerified ?? false,
  };
}

export function toProductSummary(product: {
  id: number;
  title: string;
  price: number;
  discountPercent: number | null;
  currency: string | null;
  imageUrl: string | null;
}): ProductSummaryDto {
  return {
    id: product.id,
    title: product.title,
    price: product.price,
    finalPrice: computeFinalPrice(product.price, product.discountPercent),
    currency: product.currency ?? null,
    imageUrl: product.imageUrl ?? null,
  };
}

// Sin los campos display*: los agrega MessagesService con PriceDisplayService.
export function toProductContext(
  product: Product,
): Omit<
  ProductContextDto,
  'displayPrice' | 'displayFinalPrice' | 'displayCurrency' | 'isConverted'
> {
  return {
    ...toProductSummary(product),
    status: product.status,
    isAvailable:
      product.status === ProductStatus.ACTIVE &&
      product.isVisible &&
      !product.deletedAt &&
      product.quantity > 0,
  };
}

export function toMessageResponse(message: Message): MessageResponseDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    type: message.type,
    content: message.content,
    imageUrl: message.imageUrl,
    createdAt: message.createdAt,
    readAt: message.readAt ?? null,
  };
}
