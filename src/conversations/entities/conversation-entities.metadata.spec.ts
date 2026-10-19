import { getMetadataArgsStorage } from 'typeorm';
import { Conversation } from './conversation.entity';
import { Message } from './message.entity';
import { MessageType } from '../enums/message-type.enum';

describe('conversation entity metadata', () => {
  const storage = getMetadataArgsStorage();

  it('maps Conversation with one row per buyer, seller and product', () => {
    const entity = storage.tables.find(
      (table) => table.target === Conversation,
    );
    const unique = storage.uniques.find(
      (constraint) => constraint.target === Conversation,
    );
    const indices = storage.indices
      .filter((index) => index.target === Conversation)
      .map((index) => index.name)
      .sort();

    expect(entity?.name).toBe('conversation');
    expect(unique?.name).toBe('UQ_conversation_buyer_id_seller_id_product_id');
    expect(unique?.columns).toEqual(['buyerId', 'sellerId', 'productId']);
    expect(indices).toEqual([
      'IDX_conversation_buyer_id',
      'IDX_conversation_last_message_at',
      'IDX_conversation_seller_id',
    ]);
  });

  it('maps Message with a (conversation, createdAt) index and cascade', () => {
    const entity = storage.tables.find((table) => table.target === Message);
    const index = storage.indices.find((i) => i.target === Message);
    const conversationRelation = storage.relations.find(
      (relation) =>
        relation.target === Message && relation.propertyName === 'conversation',
    );

    expect(entity?.name).toBe('message');
    expect(index?.name).toBe('IDX_message_conversation_id_created_at');
    expect(index?.columns).toEqual(['conversationId', 'createdAt']);
    expect(conversationRelation?.options.onDelete).toBe('CASCADE');
    expect(Object.values(MessageType)).toEqual(['text', 'image']);
  });
});
