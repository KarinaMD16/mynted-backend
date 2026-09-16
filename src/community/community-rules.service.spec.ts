import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UsersService } from '../users/users.service';
import { CommunityService } from './community.service';
import { Category } from './entities/category.entity';
import { Community } from './entities/community.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { Tag } from './entities/tag.entity';
import { CreateCommunityRuleDto } from './dto/create-community-rule.dto';
import { UpdateCommunityRuleDto } from './dto/update-community-rule.dto';

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */

describe('CommunityService rule CRUD', () => {
  const communityRepository = {
    findOne: jest.fn(),
  };
  const communityRuleRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((values) => values),
    save: jest.fn((value) => Promise.resolve(value)),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const manager = {
    save: jest.fn((entity, value) => Promise.resolve(value)),
  };
  const dataSource = {
    transaction: jest.fn(async (callback) => callback(manager)),
  };

  const service = new CommunityService(
    communityRepository as unknown as Repository<Community>,
    {} as Repository<Category>,
    {} as Repository<Tag>,
    communityRuleRepository as unknown as Repository<CommunityRule>,
    dataSource as never,
    {} as CloudinaryService,
    {} as UsersService,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET rules', () => {
    it('returns only the community rules in stable ID order', async () => {
      const rules = [
        { communityRuleId: 8, communityId: 4, description: 'A' },
        { communityRuleId: 9, communityId: 4, description: 'B' },
        { communityRuleId: 11, communityId: 4, description: 'C' },
      ];
      communityRepository.findOne.mockResolvedValue({ id: 4 });
      communityRuleRepository.find.mockResolvedValue(rules);

      await expect(service.findAllRules(4)).resolves.toEqual(rules);

      expect(communityRuleRepository.find).toHaveBeenCalledWith({
        where: { communityId: 4 },
        select: { communityRuleId: true, description: true },
        order: { communityRuleId: 'ASC' },
      });
    });

    it('rejects when the community does not exist', async () => {
      communityRepository.findOne.mockResolvedValue(null);

      await expect(service.findAllRules(999)).rejects.toThrow(
        NotFoundException,
      );
      expect(communityRuleRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('POST rules', () => {
    it('creates one or several rules in a transaction', async () => {
      communityRepository.findOne.mockResolvedValue({ id: 4 });
      communityRuleRepository.find.mockResolvedValue([]);

      const dto: CreateCommunityRuleDto = {
        description: ['A', 'B'],
      };

      await expect(service.createRule(4, dto)).resolves.toEqual([
        { communityId: 4, description: 'A' },
        { communityId: 4, description: 'B' },
      ]);

      expect(dataSource.transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(manager.save).toHaveBeenCalledWith(
        CommunityRule,
        expect.arrayContaining([
          expect.objectContaining({ communityId: 4, description: 'A' }),
          expect.objectContaining({ communityId: 4, description: 'B' }),
        ]),
      );
    });

    it('rejects a missing community', async () => {
      communityRepository.findOne.mockResolvedValue(null);

      await expect(
        service.createRule(999, { description: ['A'] }),
      ).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects duplicates in the request and existing community rules', async () => {
      communityRepository.findOne.mockResolvedValue({ id: 4 });

      await expect(
        service.createRule(4, { description: ['A', 'A'] }),
      ).rejects.toThrow('No puede repetir reglas');

      communityRuleRepository.find.mockResolvedValue([
        { communityRuleId: 8, communityId: 4, description: 'A' },
      ]);
      await expect(
        service.createRule(4, { description: ['A'] }),
      ).rejects.toThrow('La comunidad ya tiene una regla');
    });
  });

  describe('PATCH rules', () => {
    it('updates the description without changing the stable ID', async () => {
      communityRepository.findOne.mockResolvedValue({ id: 4 });
      const rule = { communityRuleId: 8, communityId: 4, description: 'A' };
      communityRuleRepository.findOne
        .mockResolvedValueOnce(rule)
        .mockResolvedValueOnce(null);

      const dto: UpdateCommunityRuleDto = { description: 'Updated' };
      await expect(service.updateRule(4, 8, dto)).resolves.toBe(rule);

      expect(rule).toEqual({
        communityRuleId: 8,
        communityId: 4,
        description: 'Updated',
      });
      expect(communityRuleRepository.save).toHaveBeenCalledWith(rule);
    });

    it('rejects a missing rule or a rule from another community', async () => {
      communityRepository.findOne.mockResolvedValue({ id: 4 });
      communityRuleRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateRule(4, 999, { description: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a duplicated description during update', async () => {
      communityRepository.findOne.mockResolvedValue({ id: 4 });
      communityRuleRepository.findOne
        .mockResolvedValueOnce({
          communityRuleId: 8,
          communityId: 4,
          description: 'A',
        })
        .mockResolvedValueOnce({
          communityRuleId: 9,
          communityId: 4,
          description: 'B',
        });

      await expect(
        service.updateRule(4, 8, { description: 'B' }),
      ).rejects.toThrow('La comunidad ya tiene una regla');
    });
  });

  describe('DELETE rules', () => {
    it('deletes only the rule identified by community and rule ID', async () => {
      communityRepository.findOne.mockResolvedValue({ id: 4 });
      const rule = { communityRuleId: 9, communityId: 4, description: 'B' };
      communityRuleRepository.findOne.mockResolvedValue(rule);

      await expect(service.deleteRule(4, 9)).resolves.toEqual({
        message: 'Regla eliminada exitosamente',
      });
      expect(communityRuleRepository.remove).toHaveBeenCalledWith(rule);
    });

    it('rejects a missing rule or a rule from another community', async () => {
      communityRepository.findOne.mockResolvedValue({ id: 4 });
      communityRuleRepository.findOne.mockResolvedValue(null);

      await expect(service.deleteRule(4, 999)).rejects.toThrow(
        NotFoundException,
      );
      expect(communityRuleRepository.remove).not.toHaveBeenCalled();
    });
  });
});
