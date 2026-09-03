import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Interest } from './entities/interest.entity';
import { UserInterest } from './entities/user-interest.entity';
import { CreateInterestDto } from './dto/create-interest.dto';
import { UpdateInterestDto } from './dto/update-interest.dto';

// Catálogo con el que se arranca la tabla si está vacía (ver Figma "DESIGN
// cleanup" > Create account - choose interests). Los superadmins pueden
// agregar, renombrar o borrar intereses después vía el CRUD; por eso esto
// solo se inserta una vez, nunca se vuelve a aplicar en cada arranque.
const INTEREST_CATALOG = [
  'Pokémon',
  'Funko Pop',
  'Trading Cards',
  'My Little Pony',
  'Anime Figures',
  'Comic Books',
  'Sports Cards',
  'Board Games',
  'Retro Games',
  'Vinyl Records',
  'Action Figures',
  'Keychains',
  'Plushies',
  'Lego Sets',
  'Model Kits',
  'Stamps',
  'Manga',
  'Vintage Dolls',
];

@Injectable()
export class InterestsService implements OnModuleInit {
  constructor(
    @InjectRepository(Interest)
    private readonly interestsRepository: Repository<Interest>,
    @InjectRepository(UserInterest)
    private readonly userInterestsRepository: Repository<UserInterest>,
  ) {}

  async onModuleInit(): Promise<void> {
    const count = await this.interestsRepository.count();
    if (count === 0) {
      await this.interestsRepository.insert(
        INTEREST_CATALOG.map((name) => ({ name })),
      );
    }
  }

  async findAll(): Promise<Interest[]> {
    return this.interestsRepository.find({ order: { name: 'ASC' } });
  }

  async findOne(id: number): Promise<Interest> {
    const interest = await this.interestsRepository.findOne({
      where: { id },
    });
    if (!interest) {
      throw new NotFoundException('Interés no encontrado');
    }
    return interest;
  }

  async create(dto: CreateInterestDto): Promise<Interest> {
    await this.assertNameAvailable(dto.name);
    const interest = this.interestsRepository.create({ name: dto.name });
    return this.interestsRepository.save(interest);
  }

  async update(id: number, dto: UpdateInterestDto): Promise<Interest> {
    const interest = await this.findOne(id);

    if (dto.name && dto.name !== interest.name) {
      await this.assertNameAvailable(dto.name);
      interest.name = dto.name;
      await this.interestsRepository.save(interest);
    }

    return interest;
  }

  async remove(id: number): Promise<void> {
    const interest = await this.findOne(id);
    await this.interestsRepository.remove(interest);
  }

  async getUserInterests(userId: string): Promise<Interest[]> {
    const userInterests = await this.userInterestsRepository.find({
      where: { userId },
      relations: { interest: true },
    });
    return userInterests.map((ui) => ui.interest);
  }

  async setUserInterests(
    userId: string,
    interestIds: number[],
  ): Promise<Interest[]> {
    const uniqueIds = [...new Set(interestIds)];
    const interests = await this.interestsRepository.findBy({
      id: In(uniqueIds),
    });

    if (interests.length !== uniqueIds.length) {
      throw new BadRequestException(
        'Uno o más intereses seleccionados no existen',
      );
    }

    await this.userInterestsRepository.manager.transaction(async (manager) => {
      await manager.delete(UserInterest, { userId });
      await manager.insert(
        UserInterest,
        uniqueIds.map((interestId) => ({ userId, interestId })),
      );
    });

    return interests;
  }

  private async assertNameAvailable(name: string): Promise<void> {
    const existing = await this.interestsRepository.findOne({
      where: { name },
    });
    if (existing) {
      throw new ConflictException('Ya existe un interés con ese nombre');
    }
  }
}
