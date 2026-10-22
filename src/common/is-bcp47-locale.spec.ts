import { isBcp47Locale } from './is-bcp47-locale';

describe('isBcp47Locale', () => {
  it.each(['es', 'es-CR', 'es-cr', 'es-419', 'en-US', 'pt-BR', 'zh-Hant-TW'])(
    'acepta %s',
    (value) => {
      expect(isBcp47Locale(value)).toBe(true);
    },
  );

  it.each(['', '   ', 'es_CR', 'español', 'e', 42, null])(
    'rechaza %p',
    (value) => {
      expect(isBcp47Locale(value)).toBe(false);
    },
  );
});
