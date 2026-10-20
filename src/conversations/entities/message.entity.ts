import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { MessageType } from '../enums/message-type.enum';
import { Conversation } from './conversation.entity';

// Un mensaje de texto exige content; uno de imagen exige image_url. La base
// admitiría content en una imagen, pero la app las crea siempre con content
// null (ver message-payload.ts).
@Entity('message')
@Index('IDX_message_conversation_id_created_at', [
  'conversationId',
  'createdAt',
])
// Parcial: solo los no leídos. Los conteos de no leídos (bandeja, badge,
// totalUnread de los eventos) y el UPDATE de marcar como leído tocan solo
// estas filas en vez de recorrer todo el historial de cada conversación.
@Index('IDX_message_unread_conversation_id', ['conversationId'], {
  where: '"read_at" IS NULL',
})
@Check(
  'CHK_message_payload_by_type',
  `("type" = 'text' AND "content" IS NOT NULL) OR ("type" = 'image' AND "image_url" IS NOT NULL)`,
)
export class Message {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'conversation_id' })
  conversationId!: number;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id', referencedColumnName: 'id' })
  conversation!: Conversation;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id', referencedColumnName: 'id' })
  sender!: User;

  @Column({ type: 'enum', enum: MessageType })
  type!: MessageType;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  // Solo la fija el service con la URL que devuelve Cloudinary
  // (imageMessagePayload); nunca viene del body de una request.
  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  // Lo fija el destinatario al leer el mensaje; null = no leído.
  @Column({ name: 'read_at', type: 'timestamp with time zone', nullable: true })
  readAt!: Date | null;
}
