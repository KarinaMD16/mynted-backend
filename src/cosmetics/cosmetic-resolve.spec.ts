import { toStaticImageUrl } from './banner-urls';
import {
  CosmeticLike,
  resolveBanner,
  resolveCosmetics,
  resolveEffective,
} from './cosmetic-resolve';
import { CosmeticType } from './entities/cosmetic.entity';

const row = (overrides: Partial<CosmeticLike> = {}): CosmeticLike => ({
  id: 1,
  code: 'banner_default',
  type: CosmeticType.BANNER,
  assetUrl: null,
  proOnly: false,
  isActive: true,
  ...overrides,
});

const defaultBanner = row();
const freeBanner = row({ id: 2, code: 'banner_sunset' });
const proBanner = row({ id: 3, code: 'banner_aurora', proOnly: true });

describe('resolveEffective', () => {
  it('Pro con un cosmético Pro equipado: se aplica', () => {
    expect(resolveEffective(proBanner, defaultBanner, true)).toBe(proBanner);
  });

  it('sin Pro, un cosmético Pro equipado vuelve al valor por defecto', () => {
    expect(resolveEffective(proBanner, defaultBanner, false)).toBe(
      defaultBanner,
    );
  });

  it('un cosmético gratuito se aplica con o sin Pro', () => {
    expect(resolveEffective(freeBanner, defaultBanner, false)).toBe(freeBanner);
    expect(resolveEffective(freeBanner, defaultBanner, true)).toBe(freeBanner);
  });

  it('sin nada equipado, o con uno desactivado, es el valor por defecto', () => {
    expect(resolveEffective(null, defaultBanner, true)).toBe(defaultBanner);
    expect(resolveEffective(undefined, defaultBanner, true)).toBe(
      defaultBanner,
    );
    expect(
      resolveEffective({ ...freeBanner, isActive: false }, defaultBanner, true),
    ).toBe(defaultBanner);
  });
});

describe('resolveBanner', () => {
  const custom = {
    url: 'https://res.cloudinary.com/mynted/image/upload/v1/banner.gif',
    isAnimated: true,
  };
  const base = {
    equipped: freeBanner,
    defaultRow: defaultBanner,
    isPro: true,
    useCustomBanner: true,
    customBanner: custom,
  };

  it('Pro con banner propio preferido: es el propio, con su versión estática', () => {
    expect(resolveBanner(base)).toEqual({
      source: 'custom',
      code: null,
      url: custom.url,
      staticUrl: 'https://res.cloudinary.com/mynted/image/upload/v1/banner.jpg',
      isAnimated: true,
    });
  });

  it('sin Pro el banner propio no cuenta, aunque lo prefiera y siga guardado', () => {
    const effective = resolveBanner({ ...base, isPro: false });

    expect(effective.source).toBe('catalog');
    expect(effective.code).toBe('banner_sunset');
  });

  it('si no lo prefiere, usa el del catálogo', () => {
    expect(resolveBanner({ ...base, useCustomBanner: false }).source).toBe(
      'catalog',
    );
  });

  it('prefiere el propio pero no existe la URL: cae al catálogo', () => {
    expect(resolveBanner({ ...base, customBanner: null }).source).toBe(
      'catalog',
    );
  });

  it('sin Pro y con un banner Pro del catálogo equipado: default', () => {
    expect(
      resolveBanner({
        ...base,
        equipped: proBanner,
        isPro: false,
        useCustomBanner: false,
      }),
    ).toEqual({
      source: 'default',
      code: 'banner_default',
      url: null,
      staticUrl: null,
      isAnimated: false,
    });
  });

  it('un banner de catálogo con url la repite como staticUrl', () => {
    const withUrl = row({
      id: 5,
      code: 'banner_x',
      assetUrl: 'https://cdn/x.png',
    });

    expect(
      resolveBanner({ ...base, equipped: withUrl, useCustomBanner: false }),
    ).toMatchObject({
      source: 'catalog',
      url: 'https://cdn/x.png',
      staticUrl: 'https://cdn/x.png',
      isAnimated: false,
    });
  });

  it('un banner propio que no es animado tiene la misma URL estática', () => {
    const png = {
      url: 'https://res.cloudinary.com/mynted/image/upload/v1/banner.png',
      isAnimated: false,
    };

    expect(resolveBanner({ ...base, customBanner: png })).toMatchObject({
      url: png.url,
      staticUrl: png.url,
      isAnimated: false,
    });
  });
});

describe('resolveCosmetics', () => {
  const goosePro = row({
    id: 20,
    code: 'goose_ninja',
    type: CosmeticType.GOOSE_SKIN,
    proOnly: true,
  });
  const gooseDefault = row({
    id: 10,
    code: 'goose_default',
    type: CosmeticType.GOOSE_SKIN,
  });
  const frameDefault = row({
    id: 30,
    code: 'frame_default',
    type: CosmeticType.FRAME,
  });
  const framePro = row({
    id: 31,
    code: 'frame_gold',
    type: CosmeticType.FRAME,
    proOnly: true,
  });
  const input = (isPro: boolean) => ({
    banner: {
      equipped: proBanner,
      defaultRow: defaultBanner,
      isPro,
      useCustomBanner: false,
      customBanner: null,
    },
    gooseSkin: goosePro,
    gooseDefault,
    frame: framePro,
    frameDefault,
  });

  it('Pro: aplica los tres cosméticos Pro equipados', () => {
    const effective = resolveCosmetics(input(true));

    expect(effective.banner).toMatchObject({
      source: 'catalog',
      code: 'banner_aurora',
    });
    expect(effective.gooseSkin).toEqual({
      code: 'goose_ninja',
      assetUrl: null,
    });
    expect(effective.frame).toEqual({ code: 'frame_gold', assetUrl: null });
  });

  it('al vencer Pro, los tres vuelven al valor por defecto (la preferencia no cambia)', () => {
    const effective = resolveCosmetics(input(false));

    expect(effective.banner).toMatchObject({
      source: 'default',
      code: 'banner_default',
    });
    expect(effective.gooseSkin.code).toBe('goose_default');
    expect(effective.frame.code).toBe('frame_default');
  });
});

describe('toStaticImageUrl', () => {
  const gif = 'https://res.cloudinary.com/mynted/image/upload/v1/abc.gif';

  it('cambia la extensión a .jpg para obtener el primer fotograma', () => {
    expect(toStaticImageUrl(gif, true)).toBe(
      'https://res.cloudinary.com/mynted/image/upload/v1/abc.jpg',
    );
    expect(toStaticImageUrl(gif.replace('.gif', '.WEBP'), true)).toMatch(
      /\.jpg$/,
    );
  });

  it('conserva la query string', () => {
    expect(toStaticImageUrl(`${gif}?v=2`, true)).toMatch(/abc\.jpg\?v=2$/);
  });

  it('deja igual lo que no es animado o no es de Cloudinary', () => {
    expect(toStaticImageUrl(gif, false)).toBe(gif);
    expect(toStaticImageUrl('https://otro.com/a.gif', true)).toBe(
      'https://otro.com/a.gif',
    );
  });
});
