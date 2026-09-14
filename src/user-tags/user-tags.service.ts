import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Tag } from '../community/entities/tag.entity';
import { UserTag } from './entities/user-tag.entity';
import { UsersService } from '../users/users.service';
import { SaveUserTagsDto } from './dto/save-user-tags.dto';

@Injectable()
export class UserTagsService {
  constructor(
    @InjectRepository(Tag)
    private readonly tagsRepository: Repository<Tag>,
    @InjectRepository(UserTag)
    private readonly userTagsRepository: Repository<UserTag>,
    private readonly usersService: UsersService,
  ) {}

  async getUserTags(userId: string): Promise<Tag[]> {
    const userTags = await this.userTagsRepository.find({
      where: { userId },
      relations: { tag: true },
    });
    return userTags.map((ut) => ut.tag);
  }

  async setUserTags(userId: string, dto: SaveUserTagsDto): Promise<Tag[]> {
    const uniqueIds = [...new Set(dto.tagIds)];

    // Se permite un arreglo vacío (flujo "Omitir por ahora"); si trae
    // elementos, debe cumplir el mínimo de 3 para el onboarding.
    if (uniqueIds.length > 0 && uniqueIds.length < 3) {
      throw new BadRequestException(
        'Debes elegir al menos 3 intereses, o ninguno para omitir este paso',
      );
    }

    let tags: Tag[] = [];
    if (uniqueIds.length > 0) {
      tags = await this.tagsRepository.findBy({ tagId: In(uniqueIds) });

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
    }

    await this.userTagsRepository.manager.transaction(async (manager) => {
      await manager.delete(UserTag, { userId });
      if (uniqueIds.length > 0) {
        await manager.insert(
          UserTag,
          uniqueIds.map((tagId) => ({ userId, tagId })),
        );
      }
    });

    if (
      dto.privacyPolicyVersion !== undefined ||
      dto.locale !== undefined ||
      dto.currency !== undefined
    ) {
      await this.usersService.updateOnboardingMeta(userId, {
        privacyPolicyVersion: dto.privacyPolicyVersion,
        locale: dto.locale,
        currency: dto.currency,
      });
    }

    return tags;
  }
}
