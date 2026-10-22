import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CheckoutDto } from './checkout.dto';
import { PaymentCardDto } from './payment-card.dto';

describe('PaymentCardDto.cardHolderName', () => {
  const card = (cardHolderName: unknown) =>
    plainToInstance(PaymentCardDto, {
      cardNumber: '4242424242424242',
      expiryMonth: 12,
      expiryYear: 2099,
      cvv: '123',
      cardHolderName,
    });

  const holderErrors = async (value: unknown) => {
    const errors = await validate(card(value));
    const holder = errors.find((error) => error.property === 'cardHolderName');
    return Object.values(holder?.constraints ?? {});
  };

  it.each([
    'María José Núñez',
    'Ñandú Peña',
    "O'Connor",
    'D’Angelo',
    'Ana-Lucía Gómez Jr.',
    'Zoë Müller',
    'Al',
  ])('acepta %p', async (value) => {
    await expect(holderErrors(value)).resolves.toEqual([]);
  });

  it('recorta y colapsa espacios conservando mayúsculas', () => {
    expect(card('  maría   JOSÉ  núñez ').cardHolderName).toBe(
      'maría JOSÉ núñez',
    );
  });

  it('une las tildes compuestas (NFD → NFC)', async () => {
    // "José Núñez" escrito con letras base + marcas combinantes.
    const decomposed = 'José Núñez';
    expect(card(decomposed).cardHolderName).toBe('José Núñez');
    await expect(holderErrors(decomposed)).resolves.toEqual([]);
  });

  it('es obligatorio', async () => {
    await expect(holderErrors(undefined)).resolves.toContain(
      'El nombre del titular es obligatorio',
    );
    await expect(holderErrors('')).resolves.toContain(
      'El nombre del titular es obligatorio',
    );
    await expect(holderErrors('    ')).resolves.toContain(
      'El nombre del titular es obligatorio',
    );
  });

  it('rechaza números y símbolos', async () => {
    for (const value of ['Juan 2', 'Ana@Pérez', '4242 4242', 'José_Núñez']) {
      await expect(holderErrors(value)).resolves.toContain(
        'El nombre del titular solo puede contener letras, espacios, apóstrofes, guiones y puntos',
      );
    }
  });

  it('debe empezar con una letra', async () => {
    await expect(holderErrors('-Ana')).resolves.not.toEqual([]);
    await expect(holderErrors('..')).resolves.not.toEqual([]);
  });

  it('rechaza nombres de menos de 2 o más de 80 caracteres', async () => {
    await expect(holderErrors('A')).resolves.toContain(
      'El nombre del titular debe tener entre 2 y 80 caracteres',
    );
    await expect(holderErrors('A'.repeat(81))).resolves.toContain(
      'El nombre del titular debe tener entre 2 y 80 caracteres',
    );
    await expect(holderErrors('A'.repeat(80))).resolves.toEqual([]);
  });

  it('los mensajes no incluyen el valor enviado', async () => {
    const messages = await holderErrors('Secreto 123');
    expect(messages.join(' ')).not.toContain('Secreto');
  });

  // Mismo ValidationPipe global que main.ts (sin transform: true).
  describe('con el ValidationPipe global del checkout', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const body = (cardHolderName?: string) => ({
      productId: 42,
      card: {
        cardNumber: '4242424242424242',
        expiryMonth: 12,
        expiryYear: 2099,
        cvv: '123',
        ...(cardHolderName === undefined ? {} : { cardHolderName }),
      },
    });
    const run = (value: unknown) =>
      pipe.transform(value, { type: 'body', metatype: CheckoutDto });

    it('entrega al servicio el nombre ya normalizado', async () => {
      const dto = (await run(body('  María   José Núñez '))) as CheckoutDto;

      expect(dto.card.cardHolderName).toBe('María José Núñez');
    });

    it('rechaza con 400 un checkout sin nombre del titular', async () => {
      await expect(run(body())).rejects.toThrow(BadRequestException);
    });

    it('rechaza con 400 un nombre inválido dentro de card', async () => {
      await expect(run(body('Juan 2'))).rejects.toThrow(BadRequestException);
    });
  });
});
