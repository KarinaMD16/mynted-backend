import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { Product } from '../products/entities/product.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { ConversationMessagesController } from './conversation-messages.controller';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { ConversationParticipantGuard } from './guards/conversation-participant.guard';
import { MessagesService } from './messages.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message, Product, Seller]),
    CloudinaryModule,
  ],
  controllers: [ConversationsController, ConversationMessagesController],
  providers: [
    ConversationsService,
    MessagesService,
    ConversationParticipantGuard,
  ],
  exports: [
    TypeOrmModule,
    ConversationsService,
    MessagesService,
    ConversationParticipantGuard,
  ],
})
export class ConversationsModule {}
