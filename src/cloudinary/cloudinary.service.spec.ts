import { BadRequestException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

const MB = 1024 * 1024;

const file = (overrides: Partial<Express.Multer.File> = {}) =>
  ({
    mimetype: 'image/png',
    size: 1 * MB,
    buffer: Buffer.from('imagen'),
    ...overrides,
  }) as Express.Multer.File;

describe('CloudinaryService', () => {
  let upload: jest.Mock;
  let destroy: jest.Mock;
  let service: CloudinaryService;

  // upload_stream recibe las opciones y un callback; devuelve el stream que
  // consume el buffer.
  const respondWith = (result: object | null, error?: Error) => {
    upload.mockImplementation(
      (
        _options: unknown,
        callback: (error?: Error, result?: object) => void,
      ) => {
        const { Writable } =
          jest.requireActual<typeof import('node:stream')>('node:stream');
        return new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
          final(done) {
            callback(error, result ?? undefined);
            done();
          },
        });
      },
    );
  };

  beforeEach(() => {
    upload = jest.fn();
    destroy = jest.fn();
    service = new CloudinaryService({
      uploader: { upload_stream: upload, destroy },
    } as unknown as typeof cloudinary);
    respondWith({
      secure_url: 'https://res.cloudinary.com/x/image/upload/v1/abc.png',
      public_id: 'abc',
      format: 'png',
    });
  });

  describe('uploadImage', () => {
    it('devuelve la URL y el publicId', async () => {
      await expect(service.uploadImage(file())).resolves.toEqual({
        url: 'https://res.cloudinary.com/x/image/upload/v1/abc.png',
        publicId: 'abc',
        format: 'png',
        isAnimated: false,
      });
    });

    it('un GIF es animado; también cualquier imagen con varios fotogramas', async () => {
      respondWith({
        secure_url: 'https://res.cloudinary.com/x/image/upload/v1/a.gif',
        public_id: 'a',
        format: 'gif',
        pages: 2,
      });
      await expect(
        service.uploadImage(file({ mimetype: 'image/gif' })),
      ).resolves.toMatchObject({ isAnimated: true });

      respondWith({
        secure_url: 'https://res.cloudinary.com/x/image/upload/v1/a.webp',
        public_id: 'a',
        format: 'webp',
        pages: 3,
      });
      await expect(
        service.uploadImage(file({ mimetype: 'image/webp' })),
      ).resolves.toMatchObject({ isAnimated: true });
    });

    it('acepta JPEG, PNG, WEBP y GIF y rechaza el resto', async () => {
      for (const mimetype of [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
      ]) {
        await expect(
          service.uploadImage(file({ mimetype })),
        ).resolves.toBeDefined();
      }
      await expect(
        service.uploadImage(file({ mimetype: 'application/pdf' })),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.uploadImage(file({ mimetype: 'image/svg+xml' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('el tope por defecto es 5 MB', async () => {
      await expect(
        service.uploadImage(file({ size: 5 * MB })),
      ).resolves.toBeDefined();
      await expect(
        service.uploadImage(file({ size: 5 * MB + 1 })),
      ).rejects.toThrow('La imagen supera el tamaño máximo permitido de 5 MB');
    });

    it('el tope se puede subir en una subida concreta sin cambiar el de las demás', async () => {
      await expect(
        service.uploadImage(file({ size: 8 * MB }), { maxFileSize: 8 * MB }),
      ).resolves.toBeDefined();
      await expect(
        service.uploadImage(file({ size: 8 * MB + 1 }), {
          maxFileSize: 8 * MB,
        }),
      ).rejects.toThrow('máximo permitido de 8 MB');
      // Sin opciones sigue en 5 MB.
      await expect(service.uploadImage(file({ size: 6 * MB }))).rejects.toThrow(
        '5 MB',
      );
    });

    it('un archivo que Cloudinary no acepta es 400', async () => {
      respondWith(null, new Error('Invalid image file'));

      await expect(service.uploadImage(file())).rejects.toThrow(
        'El archivo no es una imagen válida o está corrupto',
      );
    });

    it('sin archivo es 400', async () => {
      await expect(
        service.uploadImage(undefined as unknown as Express.Multer.File),
      ).rejects.toThrow('Debe proporcionar una imagen');
    });
  });

  describe('deleteImage', () => {
    it('borra por publicId e invalida la caché del CDN', async () => {
      destroy.mockResolvedValue({ result: 'ok' });

      await expect(service.deleteImage('abc')).resolves.toBe(true);

      expect(destroy).toHaveBeenCalledWith('abc', {
        resource_type: 'image',
        invalidate: true,
      });
    });

    it('si ya no existe lo da por borrado', async () => {
      destroy.mockResolvedValue({ result: 'not found' });

      await expect(service.deleteImage('abc')).resolves.toBe(true);
    });

    it('nunca lanza: un fallo devuelve false', async () => {
      destroy.mockRejectedValue(new Error('red caída'));

      await expect(service.deleteImage('abc')).resolves.toBe(false);
    });
  });
});
