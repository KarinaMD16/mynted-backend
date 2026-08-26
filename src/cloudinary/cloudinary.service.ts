import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { UploadApiResponse, v2 as cloudinary } from 'cloudinary';
import { Readable } from 'node:stream';
import 'multer';
import { CLOUDINARY } from './cloudinary.provider';

@Injectable()
export class CloudinaryService {
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

  async uploadImage(file: Express.Multer.File): Promise<{ url: string }> {
    this.validateImage(file);

    const result = await this.uploadToCloudinary(file);

    return {
      url: result.secure_url,
    };
  }

  async uploadImages(files: Express.Multer.File[]): Promise<{ url: string }[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Debe proporcionar al menos una imagen');
    }

    return Promise.all(files.map((file) => this.uploadImage(file)));
  }

  private validateImage(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('Debe proporcionar una imagen');
    }

    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Formato de imagen no permitido. Solo se permiten JPEG, PNG, WEBP y GIF',
      );
    }

    if (file.size > this.maxFileSize) {
      throw new BadRequestException(
        'La imagen supera el tamaño máximo permitido de 5 MB',
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
            reject(new Error(error.message));
            return;
          }

          if (!result) {
            reject(new Error('Cloudinary no devolvió una respuesta válida'));
            return;
          }

          resolve(result);
        },
      );

      Readable.from(file.buffer).pipe(uploadStream);
    });
  }
}
