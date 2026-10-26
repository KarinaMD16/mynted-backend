import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommunityReportsController } from './community-reports.controller';
import { ReportsService } from './reports.service';
import { CommunityRoleGuard } from '../community/guards/community-role.guard';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { Community } from '../community/entities/community.entity';
import { User } from '../users/entities/user.entity';

describe('ReportsModule dependency graph', () => {
  it('resolves CommunityRoleGuard with the User repository', async () => {
    const module = await Test.createTestingModule({
      controllers: [CommunityReportsController],
      providers: [
        CommunityRoleGuard,
        { provide: ReportsService, useValue: {} },
        { provide: Reflector, useValue: { get: jest.fn() } },
        {
          provide: getRepositoryToken(CommunityProfile),
          useValue: {},
        },
        { provide: getRepositoryToken(Community), useValue: {} },
        { provide: getRepositoryToken(User), useValue: {} },
      ],
    }).compile();

    expect(module.get(CommunityRoleGuard)).toBeInstanceOf(CommunityRoleGuard);
    expect(module.get(CommunityReportsController)).toBeInstanceOf(
      CommunityReportsController,
    );
  });
});
