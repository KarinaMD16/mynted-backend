import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Tag } from '../community/entities/tag.entity';
import { UserTag } from './entities/user-tag.entity';

@Injectable()
export class UserTagsService {
  constructor(
    @InjectRepository(Tag)
    private readonly tagsRepository: Repository<Tag>,
    @InjectRepository(UserTag)
    private readonly userTagsRepository: Repository<UserTag>,
  ) {}

  async getUserTags(userId: string): Promise<Tag[]> {
    const userTags = await this.userTagsRepository.find({
      where: { userId },
      relations: { tag: true },
    });
    return userTags.map((ut) => ut.tag);
  }

  async setUserTags(userId: string, tagIds: number[]): Promise<Tag[]> {
    const uniqueIds = [...new Set(tagIds)];
    const tags = await this.tagsRepository.findBy({ tagId: In(uniqueIds) });

    if (tags.length !== uniqueIds.length) {
      throw new BadRequestException(
        'Uno o más intereses seleccionados no existen',
      );
    }

    if (tags.some((tag) => !tag.isInterest)) {
      throw new BadRequestException(
        'Solo se pueden elegir intereses principales en el onboarding',
      );
    }

    await this.userTagsRepository.manager.transaction(async (manager) => {
      await manager.delete(UserTag, { userId });
      await manager.insert(
        UserTag,
        uniqueIds.map((tagId) => ({ userId, tagId })),
      );
    });

    return tags;
  }
}
