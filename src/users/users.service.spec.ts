import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UserOAuthAccount } from './entities/user-oauth-account.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let usersRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let cloudinaryService: { uploadImage: jest.Mock };

  beforeEach(() => {
    usersRepository = {
      findOne: jest.fn(),
      save: jest.fn((user: User) => Promise.resolve(user)),
    };
    cloudinaryService = { uploadImage: jest.fn() };

    service = new UsersService(
      usersRepository as unknown as Repository<User>,
      {} as Repository<UserOAuthAccount>,
      cloudinaryService as unknown as CloudinaryService,
    );
  });

  it('actualiza únicamente el perfil del usuario autenticado', async () => {
    const user = { id: 'user-id', username: 'anterior' } as User;
    const photo = { mimetype: 'image/png' } as Express.Multer.File;
    usersRepository.findOne
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(null);
    cloudinaryService.uploadImage.mockResolvedValue({
      url: 'https://example.com/photo.png',
    });

    const result = await service.updateProfile(
      user.id,
      { username: 'nuevo_username' },
      photo,
    );

    expect(result.username).toBe('nuevo_username');
    expect(result.photoUrl).toBe('https://example.com/photo.png');
    expect(usersRepository.save).toHaveBeenCalledWith(user);
  });

  it('impide que un superadministrador se desactive a sí mismo', async () => {
    await expect(service.deactivate('admin-id', 'admin-id')).rejects.toThrow(
      ForbiddenException,
    );
    expect(usersRepository.findOne).not.toHaveBeenCalled();
    expect(usersRepository.save).not.toHaveBeenCalled();
  });

  it('desactiva al usuario indicado', async () => {
    const user = { id: 'user-id', isActive: true } as User;
    usersRepository.findOne.mockResolvedValue(user);

    const result = await service.deactivate(user.id, 'admin-id');

    expect(result.isActive).toBe(false);
    expect(usersRepository.save).toHaveBeenCalledWith(user);
  });

  it('activa al usuario indicado', async () => {
    const user = { id: 'user-id', isActive: false } as User;
    usersRepository.findOne.mockResolvedValue(user);

    const result = await service.activate(user.id);

    expect(result.isActive).toBe(true);
    expect(usersRepository.save).toHaveBeenCalledWith(user);
  });
});
