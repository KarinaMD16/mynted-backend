import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';

export const MESSAGE_IMAGE_FIELD = 'image';
export const MESSAGE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
// Más estricto que CloudinaryService (que también admite GIF).
export const MESSAGE_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

const BaseMessageImageInterceptor = FileInterceptor(MESSAGE_IMAGE_FIELD, {
  // fields: 0 rechaza cualquier campo de texto: el multipart solo lleva el
  // archivo (no hay pie de foto ni forma de mandar type/imageUrl).
  limits: { fileSize: MESSAGE_IMAGE_MAX_BYTES, files: 1, fields: 0 },
  fileFilter: (_req, file, callback) => {
    if (MESSAGE_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(
      new BadRequestException(
        'Formato de imagen no permitido. Solo se permiten JPG, PNG y WEBP',
      ),
      false,
    );
  },
});

// Nest traduce los errores de multer con mensajes en inglés ("File too
// large", "Too many fields"...); aquí se reemplazan por mensajes claros.
export function translateUploadError(error: unknown): unknown {
  if (error instanceof PayloadTooLargeException) {
    return new PayloadTooLargeException(
      'La imagen supera el tamaño máximo permitido de 5 MB',
    );
  }
  if (!(error instanceof BadRequestException)) return error;

  if (error.message.startsWith('Too many fields')) {
    return new BadRequestException(
      `Este endpoint solo acepta el archivo '${MESSAGE_IMAGE_FIELD}', sin campos de texto`,
    );
  }
  if (
    error.message.startsWith('Unexpected field') ||
    error.message.startsWith('Too many files')
  ) {
    return new BadRequestException(
      `Envía una sola imagen en el campo '${MESSAGE_IMAGE_FIELD}'`,
    );
  }
  return error;
}

@Injectable()
export class MessageImageInterceptor extends BaseMessageImageInterceptor {
  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (error: unknown) {
      const translated = translateUploadError(error);
      if (translated instanceof HttpException) throw translated;
      throw error;
    }
  }
}
