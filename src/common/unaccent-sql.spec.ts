import { unaccentSql } from './unaccent-sql';

describe('unaccentSql', () => {
  it('envuelve la expresión en translate con el mapa de acentos del español', () => {
    expect(unaccentSql('seller.display_name')).toBe(
      "translate(seller.display_name, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')",
    );
  });

  it('ambas cadenas del mapa tienen la misma longitud', () => {
    const [, from, to] = /'(.+)', '(.+)'/.exec(unaccentSql(':text'))!;
    expect([...from]).toHaveLength([...to].length);
  });
});
