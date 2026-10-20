import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { translateUploadError } from './message-image.interceptor';

describe('translateUploadError', () => {
  const messageOf = (error: unknown) => (error as Error).message;

  it('keeps 413 for oversized files with a clear message', () => {
    const error = translateUploadError(
      new PayloadTooLargeException('File too large'),
    );

    expect(error).toBeInstanceOf(PayloadTooLargeException);
    expect(messageOf(error)).toContain('5 MB');
  });

  it('explains that text fields are not accepted', () => {
    const error = translateUploadError(
      new BadRequestException('Too many fields'),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(messageOf(error)).toContain('sin campos de texto');
  });

  it.each(['Unexpected field - foto', 'Too many files'])(
    'explains the single image field for "%s"',
    (raw) => {
      expect(
        messageOf(translateUploadError(new BadRequestException(raw))),
      ).toContain("'image'");
    },
  );

  it('leaves unrelated errors untouched', () => {
    const own = new BadRequestException('Formato de imagen no permitido');
    const other = new NotFoundException();

    expect(translateUploadError(own)).toBe(own);
    expect(translateUploadError(other)).toBe(other);
  });
});
