import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateTextMessageDto } from './dto/create-text-message.dto';
import { MessageType } from './enums/message-type.enum';

// Solo se usa la URL de la subida (uploadImage devuelve además publicId, etc.).
export type CloudinaryUploadResult = Pick<
  Awaited<ReturnType<CloudinaryService['uploadImage']>>,
  'url'
>;

/**
 * Datos con los que el service inserta un Message. No es un DTO: nunca se
 * arma desde el body de una request, y estas dos funciones son la única vía
 * para fijar `type` e `imageUrl`.
 */
export type NewMessagePayload =
  | { type: MessageType.TEXT; content: string; imageUrl: null }
  | { type: MessageType.IMAGE; content: null; imageUrl: string };

// El type lo fija el servidor; del cliente solo se toma el texto.
export function textMessagePayload(
  dto: CreateTextMessageDto,
): NewMessagePayload {
  return { type: MessageType.TEXT, content: dto.content, imageUrl: null };
}

// imageUrl sale de CloudinaryService.uploadImage (secure_url de la subida que
// hizo el propio backend), nunca de un string enviado por el cliente.
export function imageMessagePayload(
  upload: CloudinaryUploadResult,
): NewMessagePayload {
  return { type: MessageType.IMAGE, content: null, imageUrl: upload.url };
}
