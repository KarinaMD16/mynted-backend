import {
  BadRequestException,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { SellerRequestStatus, User, UserRole } from './entities/user.entity';
import {
  OAuthProvider,
  UserOAuthAccount,
} from './entities/user-oauth-account.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserOAuthAccount)
    private readonly oauthAccountsRepository: Repository<UserOAuthAccount>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepository.findOne({
      where: [{ email: dto.email }, { username: dto.username }],
    });

    if (existing) {
      throw new ConflictException(
        existing.email === dto.email
          ? 'Ese email ya está registrado'
          : 'Ese username ya está en uso',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = this.usersRepository.create({
      email: dto.email,
      username: dto.username,
      passwordHash,
    });

    return this.usersRepository.save(user);
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find({ order: { createdAt: 'DESC' } });
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    photo?: Express.Multer.File,
  ): Promise<User> {
    const hasFieldUpdate =
      dto.username !== undefined ||
      dto.bio !== undefined ||
      dto.location !== undefined ||
      dto.locale !== undefined ||
      dto.currency !== undefined;

    if (!hasFieldUpdate && !photo) {
      throw new BadRequestException(
        'Debe proporcionar al menos un campo o una foto para actualizar',
      );
    }

    const user = await this.findById(userId);

    if (dto.username !== undefined && dto.username !== user.username) {
      const usernameOwner = await this.usersRepository.findOne({
        where: { username: dto.username },
      });

      if (usernameOwner) {
        throw new ConflictException('Ese username ya está en uso');
      }

      user.username = dto.username;
    }

    if (dto.bio !== undefined) user.bio = dto.bio;
    if (dto.location !== undefined) user.location = dto.location;
    if (dto.locale !== undefined) user.locale = dto.locale;
    if (dto.currency !== undefined) user.currency = dto.currency;

    if (photo) {
      const uploadedPhoto = await this.cloudinaryService.uploadImage(photo);
      user.photoUrl = uploadedPhoto.url;
    }

    try {
      return await this.usersRepository.save(user);
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Ese username ya está en uso');
      }
      throw error;
    }
  }

  async deactivate(userId: string, requestingUserId: string): Promise<User> {
    if (userId === requestingUserId) {
      throw new ForbiddenException(
        'Un superadministrador no puede desactivar su propia cuenta',
      );
    }

    const user = await this.findById(userId);
    user.isActive = false;
    return this.usersRepository.save(user);
  }

  async activate(userId: string): Promise<User> {
    const user = await this.findById(userId);
    user.isActive = true;
    return this.usersRepository.save(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async findByEmailOrUsername(identifier: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: [{ email: identifier }, { username: identifier }],
    });
  }

  async findByResetTokenHash(tokenHash: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { resetPasswordTokenHash: tokenHash },
    });
  }

  async setPasswordResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.usersRepository.update(userId, {
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: expiresAt,
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.usersRepository.update(userId, {
      passwordHash,
      resetPasswordTokenHash: null,
      resetPasswordExpiresAt: null,
    });
  }

  async updateOnboardingMeta(
    userId: string,
    meta: {
      privacyPolicyVersion?: string;
      locale?: string;
      currency?: string;
    },
  ): Promise<void> {
    const update: Partial<User> = {};

    if (meta.privacyPolicyVersion !== undefined) {
      update.privacyPolicyVersion = meta.privacyPolicyVersion;
      update.acceptedPrivacyPolicyAt = new Date();
    }
    if (meta.locale !== undefined) update.locale = meta.locale;
    if (meta.currency !== undefined) update.currency = meta.currency;

    if (Object.keys(update).length > 0) {
      await this.usersRepository.update(userId, update);
    }
  }

  async findByOAuthAccount(
    provider: OAuthProvider,
    providerUserId: string,
  ): Promise<User | null> {
    const account = await this.oauthAccountsRepository.findOne({
      where: { provider, providerUserId },
      relations: { user: true },
    });
    return account?.user ?? null;
  }

  async linkOAuthAccount(
    userId: string,
    provider: OAuthProvider,
    providerUserId: string,
  ): Promise<void> {
    const account = this.oauthAccountsRepository.create({
      userId,
      provider,
      providerUserId,
    });
    await this.oauthAccountsRepository.save(account);
  }

  async createFromOAuth(profile: {
    email: string;
    name?: string;
    photoUrl?: string;
  }): Promise<User> {
    const username = await this.generateUniqueUsername(
      profile.name ?? profile.email.split('@')[0],
    );

    // Defaults explícitos (no confiar solo en los defaults de columna): una
    // cuenta creada por OAuth nunca tiene contraseña propia y arranca como
    // usuario regular, sin ninguna solicitud de vendedor en curso.
    const user = this.usersRepository.create({
      email: profile.email,
      username,
      passwordHash: null,
      photoUrl: profile.photoUrl,
      role: UserRole.USER,
      sellerRequestStatus: SellerRequestStatus.NONE,
    });

    return this.usersRepository.save(user);
  }

  private async generateUniqueUsername(seed: string): Promise<string> {
    const base =
      seed
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 15) || 'user';

    const firstCandidate = base.padEnd(3, '0');
    if (
      !(await this.usersRepository.findOne({
        where: { username: firstCandidate },
      }))
    ) {
      return firstCandidate;
    }

    // Sufijo numérico incremental (1, 2, 3, ...) hasta encontrar uno libre.
    for (let suffix = 1; suffix <= 9999; suffix++) {
      const candidate = `${base}${suffix}`;
      const taken = await this.usersRepository.findOne({
        where: { username: candidate },
      });
      if (!taken) return candidate;
    }

    throw new ConflictException(
      'No se pudo generar un username único, intenta de nuevo',
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }
}
