import {
  BadRequestException,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { In, Repository } from 'typeorm';
import { BadgeEvents } from '../badges/badge-events';
import * as bcrypt from 'bcrypt';
import { SellerRequestStatus, User, UserRole } from './entities/user.entity';
import {
  OAuthProvider,
  UserOAuthAccount,
} from './entities/user-oauth-account.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { Seller } from '../sellers/entities/seller.entity';
import { Product } from '../products/entities/product.entity';
import { Review } from '../products/entities/review.entity';
import { escapeLike } from '../common/escape-like';
import { PublicSellerDto, PublicUserDto } from './dto/public-user.dto';
import { CosmeticsService } from '../cosmetics/cosmetics.service';
import { EffectiveCosmetics } from '../cosmetics/cosmetic-resolve';
import { ProStatusService } from '../pro-status/pro-status.service';
import { ResponseTimeService } from '../response-time/response-time.service';
import { SearchUsersQueryDto } from './dto/search-users-query.dto';
import {
  isSupportedCurrency,
  normalizeSupportedCurrency,
} from '../payments/exchange-rate/exchange-rate.constants';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserOAuthAccount)
    private readonly oauthAccountsRepository: Repository<UserOAuthAccount>,
    private readonly cloudinaryService: CloudinaryService,
    @InjectRepository(Seller)
    private readonly sellersRepository: Repository<Seller>,
    private readonly responseTimeService: ResponseTimeService,
    private readonly proStatusService: ProStatusService,
    private readonly cosmeticsService: CosmeticsService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
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

    const saved = await this.usersRepository.save(user);
    this.eventEmitter?.emit(BadgeEvents.USER_REGISTERED, { userId: saved.id });
    return saved;
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  // GET /users/me: la entidad completa (mismos campos de siempre) más isPro y
  // el objeto seller si es vendedor aprobado. Se agrega sobre la instancia
  // para que el serializador siga ocultando los campos @Exclude.
  async findMe(id: string): Promise<
    User & {
      isPro: boolean;
      cosmetics: EffectiveCosmetics;
      seller?: PublicSellerDto;
    }
  > {
    const user = await this.findById(id);
    const [seller, isPro] = await Promise.all([
      this.sellersRepository.findOne({
        where: { userId: id, isVerified: true },
      }),
      this.proStatusService.isPro(id),
    ]);
    const cosmetics = (
      await this.cosmeticsService.getEffectiveForUsers(
        [id],
        new Set(isPro ? [id] : []),
      )
    ).get(id)!;
    if (!seller) return Object.assign(user, { isPro, cosmetics });
    const [publicSeller] = await this.toPublicSellers([seller]);
    return Object.assign(user, { isPro, cosmetics, seller: publicSeller });
  }

  // Perfil público por id. Las cuentas desactivadas se tratan como inexistentes.
  async findPublicById(id: string): Promise<PublicUserDto> {
    const user = await this.usersRepository.findOne({
      where: { id, isActive: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return (await this.toPublicUsers([user]))[0];
  }

  async findPublicByUsername(username: string): Promise<PublicUserDto> {
    const user = await this.usersRepository.findOne({
      where: { username, isActive: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return (await this.toPublicUsers([user]))[0];
  }

  async searchPublic(query: SearchUsersQueryDto) {
    const [users, total] = await this.usersRepository
      .createQueryBuilder('user')
      .where('user.is_active = :isActive', { isActive: true })
      .andWhere('user.username ILIKE :q', { q: `%${escapeLike(query.q)}%` })
      .orderBy('user.username', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return {
      data: await this.toPublicUsers(users),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  // Mapea a la vista pública con una sola consulta de vendedores. Solo los
  // aprobados (is_verified) cuentan como vendedores: el registro seller se crea
  // al solicitar, así que un pendiente o rechazado sale sin objeto seller.
  async toPublicUsers(users: User[]): Promise<PublicUserDto[]> {
    const sellers = users.length
      ? await this.sellersRepository.find({
          where: {
            userId: In(users.map((user) => user.id)),
            isVerified: true,
          },
        })
      : [];
    // Una consulta para todos los usuarios de la lista, no una por usuario.
    const userIds = users.map((user) => user.id);
    const proUserIds = await this.proStatusService.proUserIds(userIds);
    const [publicSellers, cosmeticsByUser] = await Promise.all([
      this.toPublicSellers(sellers),
      this.cosmeticsService.getEffectiveForUsers(userIds, proUserIds),
    ]);
    const sellerByUserId = new Map(
      sellers.map((seller, index) => [seller.userId, publicSellers[index]]),
    );

    return users.map((user) => {
      const seller = sellerByUserId.get(user.id);
      return {
        id: user.id,
        username: user.username,
        photoUrl: user.photoUrl ?? null,
        bio: user.bio,
        location: user.location,
        role: user.role,
        createdAt: user.createdAt,
        isPro: proUserIds.has(user.id),
        cosmetics: cosmeticsByUser.get(user.id)!,
        ...(seller ? { seller } : {}),
      };
    });
  }

  // Objeto seller público (rating y tiempo de respuesta), con una consulta
  // de cada uno para todos.
  private async toPublicSellers(sellers: Seller[]): Promise<PublicSellerDto[]> {
    if (sellers.length === 0) return [];
    const [ratings, responseTimes] = await Promise.all([
      this.getSellerRatings(sellers.map((seller) => seller.sellerId)),
      this.responseTimeService.getForUsers(
        sellers.map((seller) => seller.userId),
      ),
    ]);
    return sellers.map((seller) => {
      const rating = ratings.get(seller.sellerId);
      return {
        sellerId: seller.sellerId,
        displayName: seller.displayName,
        isVerified: seller.isVerified,
        ratingAverage: rating?.ratingAverage ?? null,
        reviewsCount: rating?.reviewsCount ?? 0,
        responseTime: responseTimes.get(seller.userId) ?? null,
      };
    });
  }

  // Única definición de "las reseñas que cuentan para un vendedor": todas las
  // reseñas de sus productos, también las de productos que borró (soft delete;
  // si no, borrar un producto mal reseñado mejoraría su promedio), y solo si el
  // vendedor está aprobado. withDeleted afecta a toda la consulta, pero de las
  // tres entidades solo Product tiene deleted_at (Review y Seller no), así que
  // lo único que reincorpora son esos productos; el filtro de aprobado va
  // explícito en la unión. El rating y el conteo de vendedor, y la
  // distribución por estrellas, salen de aquí para que no puedan divergir. El
  // rating de un producto individual (ReviewsService) no usa esta consulta.
  private sellerReviewsQuery() {
    return this.sellersRepository.manager
      .createQueryBuilder()
      .from(Review, 'review')
      .withDeleted()
      .innerJoin(Product, 'product', 'product.id = review.product_id')
      .innerJoin(
        Seller,
        'seller',
        'seller.seller_id = product.seller_id AND seller.is_verified = true',
      );
  }

  // Reseñas del vendedor por cantidad de estrellas (1 a 5), con el mismo
  // alcance que getSellerRatings. Solo trae las estrellas que tienen reseñas.
  async getSellerRatingDistribution(
    sellerId: number,
  ): Promise<Map<number, number>> {
    const rows = await this.sellerReviewsQuery()
      .select('review.rating', 'rating')
      .addSelect('COUNT(*)', 'count')
      .where('product.seller_id = :sellerId', { sellerId })
      .groupBy('review.rating')
      .getRawMany<{ rating: number; count: string }>();

    return new Map(rows.map((row) => [Number(row.rating), Number(row.count)]));
  }

  // Rating del vendedor: promedio (1 decimal) y total de las reseñas de todos
  // sus productos (borrados incluidos), calculado con agregado. Un vendedor no
  // aprobado no tiene rating (no aparece en el resultado).
  async getSellerRatings(
    sellerIds: number[],
  ): Promise<
    Map<number, { ratingAverage: number | null; reviewsCount: number }>
  > {
    const result = new Map<
      number,
      { ratingAverage: number | null; reviewsCount: number }
    >();
    if (sellerIds.length === 0) return result;

    const rows = await this.sellerReviewsQuery()
      .select('product.seller_id', 'sellerId')
      .addSelect('ROUND(AVG(review.rating)::numeric, 1)', 'average')
      .addSelect('COUNT(*)', 'count')
      .where('product.seller_id IN (:...sellerIds)', { sellerIds })
      .groupBy('product.seller_id')
      .getRawMany<{ sellerId: number; average: string; count: string }>();

    for (const row of rows) {
      result.set(Number(row.sellerId), {
        ratingAverage: parseFloat(row.average),
        reviewsCount: Number(row.count),
      });
    }
    return result;
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
      dto.currency !== undefined ||
      dto.displayCurrency !== undefined ||
      dto.emailNotifications !== undefined ||
      dto.pushNotifications !== undefined ||
      dto.confirmUnfavorite !== undefined ||
      dto.country !== undefined;

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
    if (dto.displayCurrency !== undefined) {
      user.displayCurrency = dto.displayCurrency;
    }
    if (dto.emailNotifications !== undefined) {
      user.emailNotifications = dto.emailNotifications;
    }
    if (dto.pushNotifications !== undefined) {
      user.pushNotifications = dto.pushNotifications;
    }
    if (dto.confirmUnfavorite !== undefined) {
      user.confirmUnfavorite = dto.confirmUnfavorite;
    }
    if (dto.country !== undefined) user.country = dto.country;

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

  // Los correos no se normalizan al registrarse, así que para comprobar si un
  // correo ya está tomado se compara sin distinguir mayúsculas.
  async findByEmailInsensitive(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();
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

  async findByEmailChangeTokenHash(tokenHash: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { emailChangeTokenHash: tokenHash },
    });
  }

  async setEmailChangeToken(
    userId: string,
    pendingEmail: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.usersRepository.update(userId, {
      pendingEmail,
      emailChangeTokenHash: tokenHash,
      emailChangeExpiresAt: expiresAt,
    });
  }

  async completeEmailChange(userId: string, newEmail: string): Promise<void> {
    try {
      await this.usersRepository.update(userId, {
        email: newEmail,
        pendingEmail: null,
        emailChangeTokenHash: null,
        emailChangeExpiresAt: null,
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Ese email ya está en uso');
      }
      throw error;
    }
  }

  async updateOnboardingMeta(
    userId: string,
    meta: {
      privacyPolicyVersion?: string;
      locale?: string;
      currency?: string;
      displayCurrency?: string;
    },
  ): Promise<void> {
    const update: Partial<User> = {};

    if (meta.privacyPolicyVersion !== undefined) {
      update.privacyPolicyVersion = meta.privacyPolicyVersion;
      update.acceptedPrivacyPolicyAt = new Date();
    }
    if (meta.locale !== undefined) update.locale = meta.locale;
    if (meta.currency !== undefined) {
      update.currency = this.supportedCurrencyOrFail(meta.currency);
    }
    if (meta.displayCurrency !== undefined) {
      update.displayCurrency = this.supportedCurrencyOrFail(
        meta.displayCurrency,
      );
    }

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

    const saved = await this.usersRepository.save(user);
    this.eventEmitter?.emit(BadgeEvents.USER_REGISTERED, { userId: saved.id });
    return saved;
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

  private supportedCurrencyOrFail(value: string): string {
    const currency = normalizeSupportedCurrency(value);
    if (!isSupportedCurrency(currency)) {
      throw new BadRequestException('La moneda no está soportada por Mynted');
    }
    return currency;
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
