import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTextMessageDto } from './create-text-message.dto';

// Mismas opciones que el ValidationPipe global de main.ts.
const errorsFor = async (payload: Record<string, unknown>) =>
  (
    await validate(plainToInstance(CreateTextMessageDto, payload), {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  ).map((error) => error.property);

describe('CreateTextMessageDto', () => {
  it('accepts a body with only content', async () => {
    await expect(errorsFor({ content: 'Hola' })).resolves.toEqual([]);
  });

  it('trims content', () => {
    expect(
      plainToInstance(CreateTextMessageDto, { content: '  Hola  ' }).content,
    ).toBe('Hola');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace-only', '   '],
    ['null', null],
    ['too long', 'a'.repeat(2001)],
  ])('rejects %s content', async (_label, content) => {
    await expect(errorsFor({ content })).resolves.toEqual(['content']);
  });

  it.each([
    ['type', { type: 'image' }],
    ['imageUrl', { imageUrl: 'https://res.cloudinary.com/x/a.jpg' }],
  ])('rejects a client-sent %s', async (property, extra) => {
    await expect(errorsFor({ content: 'Hola', ...extra })).resolves.toEqual([
      property,
    ]);
  });
});
