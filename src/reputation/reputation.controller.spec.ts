import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';

describe('GET /profiles/:perfilId/reputation', () => {
  const userId = '6f1c2a9e-1b2c-4d3e-8f90-123456789abc';
  const emptyDistribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

  let app: INestApplication<App>;
  let getUserReputation: jest.Mock;

  beforeEach(async () => {
    getUserReputation = jest.fn();
    const moduleRef = await Test.createTestingModule({
      controllers: [ReputationController],
      providers: [
        { provide: ReputationService, useValue: { getUserReputation } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('responde 200 sin sesión con la reputación de un usuario con reseñas', async () => {
    const reputation = {
      userId,
      isSeller: true,
      ratingAverage: 4.6,
      reviewsCount: 12,
      completedSalesCount: 15,
      ratingDistribution: { '1': 0, '2': 0, '3': 1, '4': 3, '5': 8 },
      badges: [],
    };
    getUserReputation.mockResolvedValue(reputation);

    const response = await request(app.getHttpServer())
      .get(`/profiles/${userId}/reputation`)
      .expect(200);

    expect(response.body).toEqual(reputation);
    expect(getUserReputation).toHaveBeenCalledWith(userId);
  });

  it('responde 200 con ratingAverage null si no tiene reseñas', async () => {
    getUserReputation.mockResolvedValue({
      userId,
      isSeller: true,
      ratingAverage: null,
      reviewsCount: 0,
      completedSalesCount: 0,
      ratingDistribution: emptyDistribution,
      badges: [],
    });

    const response = await request(app.getHttpServer())
      .get(`/profiles/${userId}/reputation`)
      .expect(200);

    expect(response.body).toMatchObject({
      ratingAverage: null,
      reviewsCount: 0,
      ratingDistribution: emptyDistribution,
    });
  });

  it('responde 404 si el usuario no existe', async () => {
    getUserReputation.mockRejectedValue(
      new NotFoundException('Usuario no encontrado'),
    );

    await request(app.getHttpServer())
      .get(`/profiles/${userId}/reputation`)
      .expect(404);
  });

  it('responde 400 si perfilId no es un uuid', async () => {
    await request(app.getHttpServer())
      .get('/profiles/no-es-uuid/reputation')
      .expect(400);
    expect(getUserReputation).not.toHaveBeenCalled();
  });
});
