import { BadRequestException } from '@nestjs/common';
import request from 'supertest';
import { CloudinaryService } from '../src/cloudinary/cloudinary.service';
import { CosmeticsModule } from '../src/cosmetics/cosmetics.module';
import { UserCosmetics } from '../src/cosmetics/entities/user-cosmetics.entity';
import { Subscription } from '../src/subscriptions/entities/subscription.entity';
import { SubscriptionPeriod } from '../src/subscriptions/subscription-period.enum';
import { User } from '../src/users/entities/user.entity';
import {
  createNotificationsTestApp,
  NotificationsTestApp,
} from './utils/notifications-test-app';

/**
 * Banner propio (solo Pro) con Cloudinary simulado: validaciones, reemplazo
 * con borrado del anterior, quitarlo, vencimiento y la versión estática de un
 * GIF.
 */
jest.setTimeout(90_000);

interface Body {
  isPro: boolean;
  equipped: {
    useCustomBanner: boolean;
    customBanner: {
      url: string;
      staticUrl: string;
      isAnimated: boolean;
    } | null;
  };
  cosmetics: {
    banner: {
      source: string;
      url: string | null;
      staticUrl: string | null;
      isAnimated: boolean;
    };
  };
}
const json = (response: { body: unknown }) => response.body as Body;

describe('Banner propio (e2e)', () => {
  let ctx: NotificationsTestApp;
  let pro: User;
  let free: User;
  let uploads = 0;
  const uploadImage = jest.fn();
  const deleteImage = jest.fn();

  const gif = Buffer.from('GIF89a-contenido-simulado');
  const put = (user: User, buffer?: Buffer, contentType = 'image/gif') => {
    const req = request(ctx.app.getHttpServer())
      .put('/users/me/banner')
      .set('Cookie', ctx.cookieFor(user));
    return buffer
      ? req.attach('banner', buffer, { filename: 'banner', contentType })
      : req;
  };
  const remove = (user: User) =>
    request(ctx.app.getHttpServer())
      .delete('/users/me/banner')
      .set('Cookie', ctx.cookieFor(user));
  const mine = (user: User) =>
    request(ctx.app.getHttpServer())
      .get('/users/me/cosmetics')
      .set('Cookie', ctx.cookieFor(user));
  const rowOf = (user: User) =>
    ctx.repo(UserCosmetics).findOneByOrFail({ userId: user.id });

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([CosmeticsModule]);
    // El test app registra CloudinaryService como {}: se le ponen los métodos.
    Object.assign(ctx.app.get(CloudinaryService), {
      uploadImage,
      deleteImage,
    });

    const users = ctx.repo(User);
    [pro, free] = await users.save([
      users.create({ email: 'pro@e2e.test', username: 'banner_pro' }),
      users.create({ email: 'free@e2e.test', username: 'banner_free' }),
    ]);
    await ctx.repo(Subscription).save({
      userId: pro.id,
      period: SubscriptionPeriod.MONTHLY,
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 20 * 86_400_000),
      cancelAtPeriodEnd: false,
    });
  });

  beforeEach(() => {
    uploadImage.mockReset().mockImplementation((file: Express.Multer.File) => {
      uploads += 1;
      const animated = file.mimetype === 'image/gif';
      return Promise.resolve({
        url: `https://res.cloudinary.com/mynted/image/upload/v1/banner-${uploads}.${
          animated ? 'gif' : 'png'
        }`,
        publicId: `banner-${uploads}`,
        format: animated ? 'gif' : 'png',
        isAnimated: animated,
      });
    });
    deleteImage.mockReset().mockResolvedValue(true);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('exige sesión', async () => {
    await request(ctx.app.getHttpServer()).put('/users/me/banner').expect(401);
    await request(ctx.app.getHttpServer())
      .delete('/users/me/banner')
      .expect(401);
  });

  describe('sin Pro', () => {
    it('subir es 403 y no llega a Cloudinary', async () => {
      await put(free, gif).expect(403);

      expect(uploadImage).not.toHaveBeenCalled();
      expect(await ctx.repo(UserCosmetics).countBy({ userId: free.id })).toBe(
        0,
      );
    });

    it('quitar es idempotente y no exige Pro', async () => {
      await remove(free).expect(204);
      expect(deleteImage).not.toHaveBeenCalled();
    });
  });

  describe('con Pro', () => {
    it('sin archivo es 400', async () => {
      await put(pro).expect(400);
      expect(uploadImage).not.toHaveBeenCalled();
    });

    it('el tope es 8 MB: más es 413 y no llega a Cloudinary', async () => {
      await put(pro, Buffer.alloc(8 * 1024 * 1024 + 1024)).expect(413);

      expect(uploadImage).not.toHaveBeenCalled();
    });

    it('pasa a Cloudinary con el tope de 8 MB y rechaza lo que ese servicio rechaza', async () => {
      uploadImage.mockRejectedValueOnce(
        new BadRequestException('Formato de imagen no permitido'),
      );
      await put(pro, Buffer.from('%PDF'), 'application/pdf').expect(400);
      expect(uploadImage).toHaveBeenCalledWith(expect.anything(), {
        maxFileSize: 8 * 1024 * 1024,
      });
      expect(await ctx.repo(UserCosmetics).countBy({ userId: pro.id })).toBe(0);
    });

    it('un GIF queda como banner propio preferido, con su versión estática', async () => {
      const response = await put(pro, gif).expect(200);

      expect(json(response).cosmetics.banner).toEqual({
        source: 'custom',
        code: null,
        url: 'https://res.cloudinary.com/mynted/image/upload/v1/banner-1.gif',
        staticUrl:
          'https://res.cloudinary.com/mynted/image/upload/v1/banner-1.jpg',
        isAnimated: true,
      });
      expect(json(response).equipped).toMatchObject({
        useCustomBanner: true,
        customBanner: { isAnimated: true },
      });
      const row = await rowOf(pro);
      expect(row).toMatchObject({
        customBannerPublicId: 'banner-1',
        customBannerIsAnimated: true,
        useCustomBanner: true,
      });
      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('reemplazarlo guarda el nuevo y borra el anterior de Cloudinary', async () => {
      const response = await put(pro, Buffer.from('png'), 'image/png').expect(
        200,
      );

      // Un PNG no es animado: la versión estática es la misma URL.
      expect(json(response).cosmetics.banner).toMatchObject({
        source: 'custom',
        url: 'https://res.cloudinary.com/mynted/image/upload/v1/banner-2.png',
        staticUrl:
          'https://res.cloudinary.com/mynted/image/upload/v1/banner-2.png',
        isAnimated: false,
      });
      expect(deleteImage).toHaveBeenCalledTimes(1);
      expect(deleteImage).toHaveBeenCalledWith('banner-1');
      expect((await rowOf(pro)).customBannerPublicId).toBe('banner-2');
    });

    it('si la subida falla no cambia nada ni borra el banner actual', async () => {
      uploadImage.mockRejectedValueOnce(new Error('Cloudinary caído'));

      await put(pro, gif).expect(500);

      expect((await rowOf(pro)).customBannerPublicId).toBe('banner-2');
      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('un fallo al borrar el anterior no rompe la subida', async () => {
      deleteImage.mockResolvedValue(false);

      await put(pro, gif).expect(200);

      expect((await rowOf(pro)).customBannerPublicId).toBe('banner-3');
      expect(deleteImage).toHaveBeenCalledWith('banner-2');
    });
  });

  describe('vencimiento', () => {
    it('al vencer Pro el banner propio deja de aplicarse pero sigue guardado', async () => {
      await ctx.dataSource.query(
        `UPDATE subscription SET ends_at = now() - interval '1 minute' WHERE user_id = $1`,
        [pro.id],
      );

      const response = await mine(pro).expect(200);

      expect(json(response).isPro).toBe(false);
      expect(json(response).cosmetics.banner.source).toBe('default');
      expect(json(response).equipped.customBanner).not.toBeNull();
      expect(json(response).equipped.useCustomBanner).toBe(true);
      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('vencido no puede subir otro, pero sí quitar el suyo', async () => {
      await put(pro, gif).expect(403);

      await remove(pro).expect(204);

      expect(deleteImage).toHaveBeenCalledWith('banner-3');
      const row = await rowOf(pro);
      expect(row).toMatchObject({
        customBannerUrl: null,
        customBannerPublicId: null,
        customBannerIsAnimated: false,
        useCustomBanner: false,
      });
    });

    it('quitarlo dos veces no falla ni vuelve a borrar', async () => {
      deleteImage.mockClear();

      await remove(pro).expect(204);

      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('al renovar puede subir uno nuevo', async () => {
      await ctx.dataSource.query(
        `UPDATE subscription SET ends_at = now() + interval '30 days' WHERE user_id = $1`,
        [pro.id],
      );

      const response = await put(pro, gif).expect(200);

      expect(json(response).cosmetics.banner.source).toBe('custom');
    });
  });
});
