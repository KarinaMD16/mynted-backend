/* eslint-disable */
// Publica la tienda de prueba de "twilightbuns": 11 productos de My Little Pony
// con sus fotos (scripts/seed-images/twilightbuns).
//
// Los productos se crean por la API (POST /products), no con INSERTs, para que
// pasen por las mismas validaciones, la subida a Cloudinary, la moneda del
// vendedor y el cálculo de finalPrice que usa el frontend.
//
// Requisitos:
//   - El backend corriendo (npm run start:dev).
//   - Si el usuario "twilightbuns" no existe, el script lo crea como vendedor
//     aprobado (email twilightbuns@mynted.test, contraseña Test1234, moneda CRC).
//     Si ya existe, debe ser vendedor aprobado (role = 'seller', con fila en
//     seller) y tener moneda (currency) configurada; el script no modifica
//     cuentas existentes.
//
// Uso (desde la raíz del repo):
//   node scripts/seed-twilightbuns-products.js            -> publica lo que falte
//   node scripts/seed-twilightbuns-products.js --clean    -> borra (soft delete) los productos sembrados
//   node scripts/seed-twilightbuns-products.js --no-community -> publica sin comunidad
//   API_URL=http://localhost:3000 ...                     -> URL del backend (por defecto la de abajo)
//
// Es idempotente: si twilightbuns ya tiene un producto activo con el mismo
// título, ese producto se salta.
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
process.chdir(root);
require(path.join(root, 'node_modules/dotenv')).config({ quiet: true });
const { Client } = require(path.join(root, 'node_modules/pg'));
const jwt = require(path.join(root, 'node_modules/jsonwebtoken'));
const bcrypt = require(path.join(root, 'node_modules/bcrypt'));

const USERNAME = 'twilightbuns';
// Datos de la cuenta si hay que crearla. El email NO usa @seed.mynted.test
// para que seed-community-users.js --clean no la borre.
const NEW_ACCOUNT = {
  email: 'twilightbuns@mynted.test',
  password: 'Test1234',
  bio: 'Coleccionista de My Little Pony G4 y Equestria Girls 💜 Vendo e intercambio desde Costa Rica.',
  country: 'CR',
  currency: 'CRC',
  seller: {
    displayName: 'Twilight Buns',
    description: 'Ponis G4, Equestria Girls y accesorios. Todo revisado y bien empacado.',
    location: 'Nicoya, Guanacaste, Costa Rica',
    owner: 'Twilight Buns',
    bank: 'Banco de Costa Rica',
    number: 'SEED-TWILIGHTBUNS',
  },
};
const API_URL = (process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const IMAGES_DIR = path.join(__dirname, 'seed-images', USERNAME);
const CLEAN = process.argv.includes('--clean');
const NO_COMMUNITY = process.argv.includes('--no-community');

// Tags preferidos por producto (por nombre). Si alguno no existe en la BD se
// completa con FALLBACK_TAGS hasta llegar a los 3 que exige la publicación.
const FALLBACK_TAGS = ['My Little Pony', 'Action Figures', 'Vintage Dolls', 'Plushies', 'Funko Pop'];
const PONY_TAGS = ['My Little Pony', 'Action Figures', 'Vintage Dolls'];
const EQG_TAGS = ['My Little Pony', 'Vintage Dolls', 'Action Figures'];

// Precios en USD y en CRC. Si el vendedor usa otra moneda se usa el de USD.
const PRODUCTS = [
  {
    image: 'dj-pon3.jpg',
    title: 'DJ Pon-3 (Vinyl Scratch) brushable G4',
    description:
      'DJ Pon-3, también conocida como Vinyl Scratch, en versión brushable de la generación 4. ' +
      'Melena y cola azul de dos tonos, lentes magenta pintados y cutie mark de nota musical con brillitos. ' +
      'Está en excelente estado: la pintura de los lentes está intacta y el pelo se mantiene suave, solo fue de exhibición. ' +
      'Ideal si te falta la DJ oficial de Ponyville en la colección.',
    usd: 16, crc: 8500, discountPercent: null,
    type: 'sale', condition: 'like_new', shipsTo: ['CR', 'PA'], tags: PONY_TAGS,
  },
  {
    image: 'eqg-accesorios.jpg',
    title: 'Lote de accesorios Equestria Girls Rainbow Rocks',
    description:
      'Lote de accesorios sueltos para muñecas Equestria Girls, la mayoría de la línea Rainbow Rocks. ' +
      'Incluye: batería rosada Rainbow Rocks, guitarra verde, alas de cristal azul, extensión de cabello trenzada, ' +
      'varios pares de botas (rojas con alas, amarillas), faldas, blusas, pantalón, cinturones, ' +
      'diadema dorada y otras piezas pequeñas. Algunas piezas tienen marcas de uso normales. ' +
      'Perfecto para completar o renovar el outfit de tus muñecas. Acepto intercambio por ponis G4.',
    usd: 14, crc: 7000, discountPercent: null,
    type: 'exchange', condition: 'used_with_details', shipsTo: ['CR'], tags: EQG_TAGS,
  },
  {
    image: 'eqg-lote-munecas.jpg',
    title: 'Lote de 17 muñecas Equestria Girls',
    description:
      'Lote grande de 17 muñecas Equestria Girls de distintas líneas (Rainbow Rocks, Friendship Games y básicas). ' +
      'Vienen las Mane 6, Sunset Shimmer, Trixie, Sonata Dusk, DJ Pon-3, Twilight Sparkle con alas y varias más. ' +
      'Todas con ropa y zapatos puestos. Algunas tienen el cabello un poco despeinado por el tiempo y detalles mínimos de uso, ' +
      'pero ninguna está rota. Se venden juntas, ideal para revendedores o para empezar una colección completa de un solo golpe.',
    usd: 110, crc: 55000, discountPercent: 10,
    type: 'sale', condition: 'good_condition', shipsTo: ['CR'], tags: EQG_TAGS,
  },
  {
    image: 'eqg-minis-muebles.jpg',
    title: 'Equestria Girls Minis con muebles (Pinkie Pie, Rarity, DJ Pon-3, Applejack)',
    description:
      'Set de 4 Equestria Girls Minis articuladas: Pinkie Pie, Rarity, DJ Pon-3 y Applejack con su sombrero. ' +
      'Incluye los muebles del playset: cama con estampado de globos, puff rosado y escritorio con tablero de fotos y stickers. ' +
      'Las figuras están en buen estado, con la pintura de las caras completa. ' +
      'Un set muy lindo para exhibir en repisa o para dioramas.',
    usd: 32, crc: 16500, discountPercent: null,
    type: 'sale', condition: 'good_condition', shipsTo: ['CR', 'PA', 'NI'], tags: EQG_TAGS,
  },
  {
    image: 'fluttershy.jpg',
    title: 'Fluttershy figura G4 con cola de pelo',
    description:
      'Figura de Fluttershy de la generación 4, cuerpo rígido con melena moldeada y cola de pelo rosado real. ' +
      'Cutie mark de mariposas en ambos lados y ojos sin raspones. Tamaño aproximado de 8 cm. ' +
      'Casi nueva, solo se usó para fotos. Se entrega bien empacada.',
    usd: 9, crc: 4500, discountPercent: null,
    type: 'sale', condition: 'like_new', shipsTo: ['CR'], tags: PONY_TAGS,
  },
  {
    image: 'mane6-brushables.jpg',
    title: 'Lote Mane 6 brushables G4 con accesorios',
    description:
      'Las Mane 6 completas en versión brushable G4: Twilight Sparkle con corona de estrella, Pinkie Pie, ' +
      'Fluttershy con diadema y collar de perlas, Applejack con sombrero celeste, Rainbow Dash con melena arcoíris ' +
      'y Rarity con falda brillante. Todas con el pelo en buen estado y pintura completa. ' +
      'Algunas tienen marcas leves de juego en las patas. Se venden como set.',
    usd: 48, crc: 24500, discountPercent: null,
    type: 'sale', condition: 'good_condition', shipsTo: ['CR', 'PA'], tags: PONY_TAGS,
  },
  {
    image: 'set-5-figuras.jpg',
    title: 'Set de 5 figuras: Celestia, Rainbow Dash, Fluttershy, Rarity y Starlight Glimmer',
    description:
      'Set de 5 figuras G4 de cuerpo rígido con cola de pelo: Princesa Celestia (con alas, corona y melena pastel), ' +
      'Rainbow Dash, Fluttershy, Rarity y Starlight Glimmer. ' +
      'Están casi nuevas, sin pintura gastada. Precio especial por llevarte el set completo ' +
      '(también tengo algunas por separado en mi tienda).',
    usd: 34, crc: 17500, discountPercent: 15,
    type: 'sale', condition: 'like_new', shipsTo: ['CR', 'PA', 'NI'], tags: PONY_TAGS,
  },
  {
    image: 'lote-ponis-g4.jpg',
    title: 'Lote grande de 16 ponis G4 brushables',
    description:
      'Lote de 16 ponis brushables de la generación 4 de distintas ediciones: varias Rarity, Applejack, ' +
      'Fluttershy, Rainbow Dash, Pinkie Pie, ponis con brillantina, una princesa translúcida morada y algunos ponis de fondo. ' +
      'Varios tienen el pelo enredado o con frizz y algunos detalles de pintura gastada; nada roto. ' +
      'Ideal para customizar, restaurar o para quien quiere hacer volumen en su colección.',
    usd: 65, crc: 33000, discountPercent: null,
    type: 'sale', condition: 'used_with_details', shipsTo: ['CR'], tags: PONY_TAGS,
  },
  {
    image: 'rainbow-dash.jpg',
    title: 'Rainbow Dash figura G4 con cola de pelo',
    description:
      'Figura de Rainbow Dash G4 con alas abiertas, melena moldeada en colores arcoíris y cola de pelo real. ' +
      'Cutie mark de nube con rayo bien definido. Mide unos 8 cm. ' +
      'Casi nueva, siempre estuvo en vitrina. ¡20% más cool!',
    usd: 9, crc: 4500, discountPercent: null,
    type: 'sale', condition: 'like_new', shipsTo: ['CR'], tags: PONY_TAGS,
  },
  {
    image: 'rarity.jpg',
    title: 'Rarity figura G4 con cola de pelo',
    description:
      'Figura de Rarity G4, cuerpo blanco con melena moldeada morada y cola de pelo lila. ' +
      'Cutie mark de tres diamantes celestes y pestañas pintadas perfectas. Tamaño aproximado de 8 cm. ' +
      'En excelente estado, sin raspones. Divinamente fabulosa para tu repisa.',
    usd: 9, crc: 4500, discountPercent: null,
    type: 'sale', condition: 'like_new', shipsTo: ['CR'], tags: PONY_TAGS,
  },
  {
    image: 'starlight-glimmer.jpg',
    title: 'Starlight Glimmer figura G4 con cola de pelo',
    description:
      'Figura de Starlight Glimmer G4, una de las menos comunes de esta línea. ' +
      'Melena moldeada morada con mechón turquesa, cola de pelo lila y cutie mark de estrella mágica. ' +
      'Mide unos 8 cm y está casi nueva, sin detalles de pintura.',
    usd: 11, crc: 5500, discountPercent: null,
    type: 'sale', condition: 'like_new', shipsTo: ['CR', 'PA'], tags: PONY_TAGS,
  },
];

function fail(message) {
  throw new Error(message);
}

function priceFor(product, currency) {
  return currency === 'CRC' ? product.crc : product.usd;
}

const findUser = async (c) =>
  (await c.query('select id, email, role, currency from users where lower(username) = lower($1)', [USERNAME])).rows[0];

// Crea la cuenta como vendedor aprobado, con datos de pago y fila en seller.
async function createAccount(c) {
  const a = NEW_ACCOUNT;
  const taken = (await c.query('select 1 from users where lower(email) = lower($1)', [a.email])).rows[0];
  if (taken) fail(`El email ${a.email} ya lo usa otra cuenta; cambie NEW_ACCOUNT.email.`);

  await c.query('begin');
  try {
    const user = (
      await c.query(
        `insert into users (email, username, password_hash, bio, role, seller_request_status, seller_requested_at,
                            currency, country, locale, accepted_privacy_policy_at, privacy_policy_version)
         values ($1,$2,$3,$4,'seller','approved', now(), $5,$6,'es', now(), 'seed') returning id`,
        [a.email, USERNAME, await bcrypt.hash(a.password, 10), a.bio, a.currency, a.country],
      )
    ).rows[0];
    const pay = (
      await c.query(
        `insert into payment_info (owner_full_name, name, number, type) values ($1,$2,$3,'bank_account') returning payment_info_id`,
        [a.seller.owner, a.seller.bank, a.seller.number],
      )
    ).rows[0];
    await c.query(
      'insert into seller (display_name, description, location, user_id, payment_id) values ($1,$2,$3,$4,$5)',
      [a.seller.displayName, a.seller.description, a.seller.location, user.id, pay.payment_info_id],
    );
    const tag = (await c.query(`select tag_id from tag where lower(name) = 'my little pony'`)).rows[0];
    if (tag) await c.query('insert into user_tag (user_id, tag_id) values ($1,$2) on conflict do nothing', [user.id, tag.tag_id]);
    // Miembro de My Little Pony Latam (si existe) para publicar ahí sus productos.
    const community = (await c.query('select id, slug, name from community where is_active = true')).rows.find(
      (r) => [r.slug, r.name].some((v) => v.toLowerCase().replace(/[^a-z0-9]/g, '') === 'mylittleponylatam'),
    );
    if (community) {
      await c.query(
        `insert into community_profile (display_name, bio, user_id, community_id, role) values ($1,$2,$3,$4,'member')`,
        [USERNAME, a.bio, user.id, community.id],
      );
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
  console.log(`Cuenta "${USERNAME}" creada (${a.email} / ${a.password}).\n`);
}

async function loadContext(c) {
  let user = await findUser(c);
  if (!user) {
    if (CLEAN) fail(`No existe el usuario "${USERNAME}"; no hay nada que borrar.`);
    await createAccount(c);
    user = await findUser(c);
  }
  if (user.role !== 'seller') {
    fail(`"${USERNAME}" tiene role "${user.role}"; debe ser un vendedor aprobado (role = 'seller').`);
  }
  const seller = (await c.query('select seller_id from seller where user_id = $1', [user.id])).rows[0];
  if (!seller) fail(`"${USERNAME}" no tiene fila en seller: falta completar la activación de vendedor.`);
  if (!user.currency) fail(`"${USERNAME}" no tiene moneda (currency) configurada en su perfil.`);
  if (user.currency !== 'CRC' && user.currency !== 'USD') {
    console.warn(`Aviso: la moneda de ${USERNAME} es ${user.currency}; se usarán los precios en USD como números.`);
  }

  const tags = new Map(
    (await c.query('select tag_id, name from tag')).rows.map((r) => [r.name.trim().toLowerCase(), r.tag_id]),
  );

  let community = null;
  if (!NO_COMMUNITY) {
    community = (
      await c.query(
        `select c.id, c.name from community c
           join community_profile cp on cp.community_id = c.id
          where cp.user_id = $1 and c.is_active = true
            and (c.name ilike '%pony%' or c.name ilike '%mlp%' or c.name ilike '%poni%')
          order by c.id limit 1`,
        [user.id],
      )
    ).rows[0] || null;
  }

  return { user, sellerId: seller.seller_id, tags, community };
}

function resolveTagIds(names, tags) {
  const ids = [];
  for (const name of [...names, ...FALLBACK_TAGS]) {
    const id = tags.get(name.toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length === 3) return ids;
  }
  fail(`No se encontraron 3 tags válidos entre: ${[...names, ...FALLBACK_TAGS].join(', ')}`);
}

function accessToken(user) {
  if (!process.env.JWT_SECRET) fail('Falta JWT_SECRET en el .env');
  // Mismo payload y secret que AuthService.login, así no hace falta la contraseña.
  return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: 600 });
}

async function api(method, url, token, body) {
  let res;
  try {
    res = await fetch(`${API_URL}${url}`, { method, headers: { Cookie: `access_token=${token}` }, body });
  } catch (e) {
    fail(`No se pudo conectar con el backend en ${API_URL} (¿está corriendo?): ${e.message}`);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message || text;
    fail(`${method} ${url} -> ${res.status}: ${msg}`);
  }
  return data;
}

async function existingTitles(c, sellerId) {
  const rows = (
    await c.query('select id, title from product where seller_id = $1 and deleted_at is null and title = any($2)', [
      sellerId,
      PRODUCTS.map((p) => p.title),
    ])
  ).rows;
  return new Map(rows.map((r) => [r.title, r.id]));
}

async function clean(c, ctx, token) {
  const existing = await existingTitles(c, ctx.sellerId);
  for (const [title, id] of existing) {
    await api('DELETE', `/products/${id}`, token);
    console.log(`  borrado  #${id}  ${title}`);
  }
  console.log(`Productos seed de ${USERNAME} eliminados: ${existing.size}`);
}

async function seed(c, ctx, token) {
  const existing = await existingTitles(c, ctx.sellerId);
  const url = ctx.community ? `/communities/${ctx.community.id}/products` : '/products';
  console.log(
    `Publicando como ${USERNAME} (${ctx.user.currency}) ${ctx.community ? `en la comunidad "${ctx.community.name}"` : 'sin comunidad'}\n`,
  );

  let created = 0;
  for (const p of PRODUCTS) {
    if (existing.has(p.title)) {
      console.log(`  ya existe #${existing.get(p.title)}  ${p.title}`);
      continue;
    }
    const file = path.join(IMAGES_DIR, p.image);
    if (!fs.existsSync(file)) fail(`No se encontró la imagen ${file}`);

    const form = new FormData();
    form.append('title', p.title);
    form.append('description', p.description);
    form.append('price', String(priceFor(p, ctx.user.currency)));
    if (p.discountPercent) form.append('discountPercent', String(p.discountPercent));
    form.append('type', p.type);
    form.append('condition', p.condition);
    form.append('tagIds', JSON.stringify(resolveTagIds(p.tags, ctx.tags)));
    form.append('shipsTo', JSON.stringify(p.shipsTo));
    form.append('image', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), p.image);

    const product = await api('POST', url, token, form);
    created++;
    console.log(`  creado   #${product?.id ?? '?'}  ${p.title}  (${priceFor(p, ctx.user.currency)} ${ctx.user.currency})`);
  }
  console.log(`\nListo: ${created} creados, ${PRODUCTS.length - created} ya existían.`);
}

(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USERNAME || process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || process.env.DB_DATABASE,
  });
  await c.connect();
  try {
    const ctx = await loadContext(c);
    const token = accessToken(ctx.user);
    if (CLEAN) await clean(c, ctx, token);
    else await seed(c, ctx, token);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
