import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { UploadApiResponse, v2 as cloudinary } from 'cloudinary';
import { Readable } from 'node:stream';
import 'multer';
import { CLOUDINARY } from './cloudinary.provider';

// Lo que se guarda de una imagen subida: la URL para mostrarla y el publicId
// para poder borrarla después.
export interface UploadedImage {
  url: string;
  publicId: string;
  format: string;
  // GIF o imagen con más de un fotograma.
  isAnimated: boolean;
}

export interface UploadImageOptions {
  // Tope de tamaño de esta subida; por defecto 5 MB (foto de perfil, productos).
  maxFileSize?: number;
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  private readonly allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ];

  private readonly maxFileSize = 5 * 1024 * 1024;

  constructor(
    @Inject(CLOUDINARY)
    private readonly cloudinaryClient: typeof cloudinary,
  ) {}

  async uploadImage(
    file: Express.Multer.File,
    options: UploadImageOptions = {},
  ): Promise<UploadedImage> {
    this.validateImage(file, options.maxFileSize ?? this.maxFileSize);

    const result = await this.uploadToCloudinary(file);

    return {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      isAnimated: result.format === 'gif' || (result.pages ?? 1) > 1,
    };
  }

  // Borra una imagen por su publicId. Es de mejor esfuerzo: un fallo se registra
  // y devuelve false, nunca rompe la acción del usuario (a lo sumo queda un
  // archivo huérfano).
  async deleteImage(publicId: string): Promise<boolean> {
    try {
      const result = (await this.cloudinaryClient.uploader.destroy(publicId, {
        resource_type: 'image',
        invalidate: true,
      })) as { result?: string };
      return result.result === 'ok' || result.result === 'not found';
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo borrar la imagen ${publicId} de Cloudinary: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  async uploadImages(files: Express.Multer.File[]): Promise<{ url: string }[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Debe proporcionar al menos una imagen');
    }

    return Promise.all(files.map((file) => this.uploadImage(file)));
  }

  private validateImage(file: Express.Multer.File, maxFileSize: number): void {
    if (!file) {
      throw new BadRequestException('Debe proporcionar una imagen');
    }

    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Formato de imagen no permitido. Solo se permiten JPEG, PNG, WEBP y GIF',
      );
    }

    if (file.size > maxFileSize) {
      throw new BadRequestException(
        `La imagen supera el tamaño máximo permitido de ${maxFileSize / (1024 * 1024)} MB`,
      );
    }
  }

  private uploadToCloudinary(
    file: Express.Multer.File,
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = this.cloudinaryClient.uploader.upload_stream(
        {
          resource_type: 'image',
        },
        (error, result) => {
          if (error) {
            reject(
              new BadRequestException(
                'El archivo no es una imagen válida o está corrupto',
              ),
            );
            return;
          }

          if (!result) {
            reject(
              new InternalServerErrorException(
                'Cloudinary no devolvió una respuesta válida',
              ),
            );
            return;
          }

          resolve(result);
        },
      );

      Readable.from(file.buffer).pipe(uploadStream);
    });
  }
}
