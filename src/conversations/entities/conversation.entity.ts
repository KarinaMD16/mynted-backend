import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { User } from '../../users/entities/user.entity';
import { Message } from './message.entity';

// Chat 1 a 1 entre comprador y vendedor, siempre ligado a un producto: una
// sola conversación por (comprador, vendedor, producto).
@Entity('conversation')
@Unique('UQ_conversation_buyer_id_seller_id_product_id', [
  'buyerId',
  'sellerId',
  'productId',
])
@Index('IDX_conversation_buyer_id', ['buyerId'])
@Index('IDX_conversation_seller_id', ['sellerId'])
@Index('IDX_conversation_last_message_at', ['lastMessageAt'])
@Check('CHK_conversation_distinct_participants', '"buyer_id" <> "seller_id"')
export class Conversation {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'buyer_id', type: 'uuid' })
  buyerId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'buyer_id', referencedColumnName: 'id' })
  buyer!: User;

  // Usuario dueño de la tienda (seller.user_id), no seller.seller_id: ambos
  // participantes del chat se modelan como usuarios.
  @Column({ name: 'seller_id', type: 'uuid' })
  sellerId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seller_id', referencedColumnName: 'id' })
  seller!: User;

  // RESTRICT: los productos se borran lógicamente y deben conservar sus
  // conversaciones; un borrado físico no debe llevárselas.
  @Column({ name: 'product_id' })
  productId!: number;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id', referencedColumnName: 'id' })
  product!: Product;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  // Arranca en la fecha de creación y se actualiza con cada mensaje nuevo;
  // la bandeja de entrada ordena por esta columna.
  @Column({
    name: 'last_message_at',
    type: 'timestamp with time zone',
    default: () => 'now()',
  })
  lastMessageAt!: Date;

  @OneToMany(() => Message, (message) => message.conversation)
  messages!: Message[];
}
