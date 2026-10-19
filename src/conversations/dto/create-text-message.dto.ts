import { ApiProperty } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trimOrUndefined = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);

/**
 * Body del endpoint de mensajes de texto. Solo acepta `content`: no existe
 * `type` ni `imageUrl` a propósito. El service fuerza type 'text' (ver
 * textMessagePayload) y, como el ValidationPipe global usa
 * forbidNonWhitelisted, un body que mande type o imageUrl responde 400.
 *
 * Los mensajes 'image' no tienen DTO: el cliente sube el archivo y el service
 * crea el mensaje con la URL que devuelve Cloudinary (imageMessagePayload).
 */
export class CreateTextMessageDto {
  @ApiProperty({ example: '¡Hola! ¿Sigue disponible?', maxLength: 2000 })
  @Transform(trimOrUndefined)
  @IsString({ message: 'content debe ser texto' })
  @IsNotEmpty({ message: 'content es obligatorio' })
  @MaxLength(2000, { message: 'content no puede superar 2000 caracteres' })
  content!: string;
}
