import { parseIntegerArray, parseMultipartArray } from './create-community.dto';

describe('Community multipart transforms', () => {
  it('parses rules sent as a JSON array and preserves internal commas', () => {
    const value = JSON.stringify([
      'No hacer comentarios ofensivos',
      'Solo temas relacionados a Digimon, y sus derivados',
    ]);

    expect(parseMultipartArray(value)).toEqual([
      'No hacer comentarios ofensivos',
      'Solo temas relacionados a Digimon, y sus derivados',
    ]);
  });

  it('wraps one multipart rule without splitting its commas', () => {
    expect(
      parseMultipartArray('No publicar insultos, amenazas o discriminación'),
    ).toEqual(['No publicar insultos, amenazas o discriminación']);
  });

  it('parses comma-separated tag ids produced by Swagger', () => {
    expect(parseIntegerArray('1,2,3')).toEqual([1, 2, 3]);
  });
});
