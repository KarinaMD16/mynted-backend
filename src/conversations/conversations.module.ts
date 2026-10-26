import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WsJwtAuthenticator } from '../auth/ws-jwt-authenticator';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { PricingModule } from '../pricing/pricing.module';
import { ProStatusModule } from '../pro-status/pro-status.module';
import { Product } from '../products/entities/product.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { ConversationMessagesController } from './conversation-messages.controller';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { ChatGateway } from './gateway/chat.gateway';
import { ChatPresence } from './gateway/chat-presence';
import { ConversationParticipantGuard } from './guards/conversation-participant.guard';
import { MessagesService } from './messages.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message, Product, Seller]),
    CloudinaryModule,
    PricingModule,
    ProStatusModule,
    // Solo para verificar el token del handshake: el secret se pasa al
    // verificar (JWT_SECRET), igual que en JwtStrategy.
    JwtModule.register({}),
  ],
  controllers: [ConversationsController, ConversationMessagesController],
  providers: [
    ConversationsService,
    MessagesService,
    ConversationParticipantGuard,
    WsJwtAuthenticator,
    ChatPresence,
    ChatGateway,
  ],
  exports: [
    TypeOrmModule,
    ConversationsService,
    MessagesService,
    ConversationParticipantGuard,
  ],
})
export class ConversationsModule {}
