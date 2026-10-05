import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePostDto } from './create-post.dto';

const makeDto = (tagIds: unknown) =>
  plainToInstance(CreatePostDto, {
    title: 'Título',
    body: 'Contenido',
    tagIds,
  });

describe('CreatePostDto tagIds', () => {
  it.each([[[1]], [[1, 2]], [[1, 2, 3]]])('accepts %p tags', async (tagIds) => {
    await expect(validate(makeDto(tagIds))).resolves.toHaveLength(0);
  });

  it.each([[[]], [[1, 2, 3, 4]], [[2, 2]], [[0]], [[-1]], [['1']]])(
    'rejects invalid tags %p',
    async (tagIds) => {
      await expect(validate(makeDto(tagIds))).resolves.not.toHaveLength(0);
    },
  );

  it('requires tagIds', async () => {
    await expect(
      validate(
        plainToInstance(CreatePostDto, {
          title: 'Título',
          body: 'Contenido',
        }),
      ),
    ).resolves.not.toHaveLength(0);
  });
});
