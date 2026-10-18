/* eslint-disable */
// Datos de prueba para los feeds de foros (Home / Explore).
//
// Uso (desde la raíz del repo):
//   node scripts/seed-forum-test-data.js           -> limpia lo anterior y siembra
//   node scripts/seed-forum-test-data.js --clean   -> solo borra los datos sembrados
//
// Todo lo sembrado se identifica así, para poder borrarlo sin tocar datos reales:
//   usuarios     username  seed_*   (contraseña: Test1234)
//   comunidades  slug      seed-*
// Los posts, votos, respuestas, favoritos y perfiles cuelgan de esos usuarios y
// comunidades y se borran con ellos.
const path = require('path');
const root = path.resolve(__dirname, '..');
process.chdir(root);
require(path.join(root, 'node_modules/dotenv')).config({ quiet: true });
const { Client } = require(path.join(root, 'node_modules/pg'));
const bcrypt = require(path.join(root, 'node_modules/bcrypt'));

const PASSWORD = 'Test1234';

// PRNG determinista para que dos corridas den los mismos datos.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(2026);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const sample = (arr, n) => shuffle(arr).slice(0, n);

const USERNAMES = [
  'ana', 'beto', 'carla', 'diego', 'elena', 'fabio', 'gala',
  'hugo', 'irene', 'jorge', 'karen', 'luis', 'maria', 'nico',
].map((n) => `seed_${n}`);

// Comunidades nuevas (públicas) para que Explore tenga qué descubrir.
const NEW_COMMUNITIES = [
  { slug: 'seed-pokemon-tcg-latam', name: 'Pokémon TCG Latam', categoryId: 2, tags: [2, 4], topics: ['cartas holográficas', 'sobres de Escarlata y Púrpura', 'cartas first edition', 'fundas y protectores', 'torneos locales', 'cartas de Charizard'] },
  { slug: 'seed-anime-manga-hub', name: 'Anime y Manga Hub', categoryId: 4, tags: [6, 18], topics: ['figuras de Dragon Ball', 'tomos de One Piece', 'figuras Nendoroid', 'mangas de Berserk', 'ediciones limitadas', 'figuras de Naruto'] },
  { slug: 'seed-comic-book-club', name: 'Comic Book Club', categoryId: 9, tags: [7, 1], topics: ['cómics de Spider-Man', 'ediciones variantes', 'bolsas y cartones para cómics', 'sagas de Batman', 'cómics independientes', 'primeras apariciones'] },
  { slug: 'seed-lego-builders', name: 'Lego Builders', categoryId: 8, tags: [15, 16], topics: ['sets de Star Wars', 'MOCs propios', 'sets retirados', 'Lego Technic', 'maquetas de ciudad', 'piezas raras'] },
  { slug: 'seed-noches-juegos-de-mesa', name: 'Noches de Juegos de Mesa', categoryId: 9, tags: [9], topics: ['juegos cooperativos', 'Catan y expansiones', 'juegos para dos', 'ediciones de colección', 'juegos de cartas', 'mesas para jugar'] },
  { slug: 'seed-peluches-plushies', name: 'Peluches y Plushies', categoryId: 9, tags: [14, 21], topics: ['peluches de Pokémon', 'muñecas vintage', 'cuidado y limpieza', 'peluches de anime', 'ediciones limitadas', 'ferias de coleccionismo'] },
  { slug: 'seed-sports-cards-traders', name: 'Sports Cards Traders', categoryId: 2, tags: [8, 4], topics: ['cartas de fútbol', 'rookies de NBA', 'cartas firmadas', 'gradeo de cartas', 'cajas selladas', 'cartas de Mundial'] },
];
const PRIVATE_COMMUNITY = { slug: 'seed-vault-privada', name: 'Vault privada (seed)', categoryId: 9, tags: [1], topics: ['piezas exclusivas', 'ventas entre miembros', 'colecciones privadas', 'subastas internas'] };

// Comunidades que ya existen y son públicas (id -> temas).
const EXISTING_TOPICS = {
  1: { tags: [1], topics: ['ponis de generación 4', 'figuras de Fluttershy', 'ponis vintage G1', 'mini ponis', 'ediciones de Applejack', 'coleccionistas de México'] },
  3: { tags: [3], topics: ['Funko Pop exclusivos', 'variantes chase', 'cajas protectoras', 'Funko de Marvel', 'Funko de anime', 'pops de colección'] },
  4: { tags: [3], topics: ['Funko Pop de Pokémon', 'Funko con brillo', 'Funko de Disney', 'Funko de películas', 'ventas de Funko', 'Funko raros'] },
  8: { tags: [1, 3], topics: ['mi colección', 'objetos de colección', 'dónde comprar', 'cómo exhibir', 'piezas raras', 'novedades'] },
  9: { tags: [6], topics: ['figuras de Gon y Killua', 'arco de las Hormigas Quimera', 'mangas de Togashi', 'cosplay', 'teorías del manga', 'figuras de Hisoka'] },
  29: { tags: [11, 13, 12], topics: ['vinilos de rap', 'llaveros de artistas', 'figuras de hip hop', 'ediciones limitadas', 'discos clásicos', 'conciertos'] },
};

const TITLE_TEMPLATES = [
  (x) => `¿Qué opinan de ${x}?`,
  (x) => `Mi nueva adquisición: ${x}`,
  (x) => `Busco recomendaciones sobre ${x}`,
  (x) => `Guía rápida para empezar con ${x}`,
  (x) => `Mostrando mi colección de ${x}`,
  (x) => `¿Vale la pena invertir en ${x}?`,
  (x) => `Duda sobre autenticidad en ${x}`,
  (x) => `Intercambio ${x} por algo similar`,
];
const BODIES = [
  'Llevo un tiempo en esto y quería compartirlo con ustedes. Me encantaría saber su experiencia y qué recomiendan para no equivocarme.',
  'Acabo de conseguirlo y estoy feliz con el resultado. Les dejo mis impresiones y estoy abierto a consejos.',
  'Tengo varias dudas y no sé por dónde empezar. Cualquier ayuda o enlace útil se agradece muchísimo.',
  'Estuve comparando precios en distintas tiendas y la diferencia es enorme. ¿Ustedes dónde compran normalmente?',
  'Les cuento mi experiencia por si le sirve a alguien más de la comunidad. Pregunten lo que quieran.',
];
const REPLIES = [
  '¡Totalmente de acuerdo, gracias por compartirlo!',
  'Yo tuve la misma duda hace poco, te recomiendo revisar con calma antes de comprar.',
  'Se ve genial. ¿Dónde lo conseguiste?',
  'Cuidado con las imitaciones, siempre pide fotos del empaque.',
  'Muy buen aporte, lo guardo para después.',
  'No lo había pensado así, buen punto.',
];

async function clean(c) {
  const users = (await c.query("select id from users where username like 'seed\\_%'")).rows.map((r) => r.id);
  if (users.length) {
    await c.query('delete from favorite where user_id = any($1)', [users]);
    await c.query(
      'delete from post where community_profile_id in (select community_profile_id from community_profile where user_id = any($1))',
      [users],
    );
    await c.query('delete from community_profile where user_id = any($1)', [users]);
  }
  await c.query("delete from community where slug like 'seed-%'");
  await c.query("delete from users where username like 'seed\\_%'");
}

async function seed(c) {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const interestTags = (await c.query('select tag_id from tag where is_interest = true order by tag_id')).rows.map((r) => r.tag_id);

  // --- comunidades nuevas
  const communities = []; // { id, name, tags, topics, isPrivate }
  for (const [id, info] of Object.entries(EXISTING_TOPICS)) {
    const row = (await c.query('select id, name, is_private, is_active from community where id = $1', [id])).rows[0];
    if (row && !row.is_private && row.is_active) {
      communities.push({ id: row.id, name: row.name, tags: info.tags, topics: info.topics, isPrivate: false });
    }
  }
  for (const cm of [...NEW_COMMUNITIES, PRIVATE_COMMUNITY]) {
    const isPrivate = cm === PRIVATE_COMMUNITY;
    const r = await c.query(
      'insert into community (name, description, slug, is_private, is_active, category_id) values ($1,$2,$3,$4,true,$5) returning id',
      [cm.name, `Comunidad de prueba: ${cm.name}`, cm.slug, isPrivate, cm.categoryId],
    );
    for (const t of cm.tags) {
      await c.query('insert into community_tag (community_id, tag_id) values ($1,$2)', [r.rows[0].id, t]);
    }
    communities.push({ id: r.rows[0].id, name: cm.name, tags: cm.tags, topics: cm.topics, isPrivate });
  }
  const publicCommunities = communities.filter((x) => !x.isPrivate);
  const privateCommunity = communities.find((x) => x.isPrivate);

  // --- usuarios + intereses
  const users = [];
  for (const username of USERNAMES) {
    const r = await c.query(
      "insert into users (email, username, password_hash, bio, role, accepted_privacy_policy_at, privacy_policy_version) values ($1,$2,$3,$4,'user', now(), 'seed') returning id",
      [`${username}@mynted.test`, username, hash, 'Usuario de prueba para los feeds'],
    );
    const interests = sample(interestTags, 3);
    for (const t of interests) {
      await c.query('insert into user_tag (user_id, tag_id) values ($1,$2)', [r.rows[0].id, t]);
    }
    users.push({ id: r.rows[0].id, username, interests, joined: new Set() });
  }

  // --- membresías: cada usuario entra a 5 comunidades públicas; 4 usuarios a la privada.
  const membersOf = new Map(communities.map((cm) => [cm.id, []]));
  const join = (user, cm) => {
    if (user.joined.has(cm.id)) return;
    user.joined.add(cm.id);
    membersOf.get(cm.id).push(user);
  };
  for (const u of users) sample(publicCommunities, 5).forEach((cm) => join(u, cm));
  // Mínimo 5 miembros por comunidad pública para que haya votos variados.
  for (const cm of publicCommunities) {
    while (membersOf.get(cm.id).length < 5) join(pick(users), cm);
  }
  sample(users, 5).forEach((u) => join(u, privateCommunity));

  const profileId = new Map(); // `${userId}:${communityId}` -> profileId
  for (const cm of communities) {
    const members = membersOf.get(cm.id);
    for (let i = 0; i < members.length; i++) {
      const u = members[i];
      const r = await c.query(
        'insert into community_profile (display_name, bio, user_id, community_id, role) values ($1,$2,$3,$4,$5) returning community_profile_id',
        [u.username, '', u.id, cm.id, i === 0 && NEW_COMMUNITIES.concat(PRIVATE_COMMUNITY).some((n) => n.name === cm.name) ? 'owner' : 'member'],
      );
      profileId.set(`${u.id}:${cm.id}`, r.rows[0].community_profile_id);
    }
  }

  // --- posts, votos, respuestas
  const DAY = 24 * 60 * 60 * 1000;
  const allPosts = []; // { id, communityId, authorUserId }
  let votes = 0;
  let replies = 0;
  for (const cm of communities) {
    const members = membersOf.get(cm.id);
    const count = cm.isPrivate ? 4 : 6;
    const topics = shuffle(cm.topics);
    for (let i = 0; i < count; i++) {
      const author = pick(members);
      const topic = topics[i % topics.length];
      const title = `[SEED] ${pick(TITLE_TEMPLATES)(topic)}`;
      const postedAt = new Date(Date.now() - Math.floor(rand() * 20 * DAY) - Math.floor(rand() * DAY));
      const p = await c.query(
        'insert into post (title, body, community_profile_id, posted_at) values ($1,$2,$3,$4) returning id',
        [title, pick(BODIES), profileId.get(`${author.id}:${cm.id}`), postedAt],
      );
      const postId = p.rows[0].id;
      // tags: los de la comunidad + a veces un tag de interés extra (cruce para Explore)
      const tagIds = new Set(cm.tags);
      if (rand() < 0.35) tagIds.add(pick(interestTags));
      for (const t of tagIds) {
        await c.query('insert into post_tag (post_id, tag_id) values ($1,$2)', [postId, t]);
      }
      allPosts.push({ id: postId, communityId: cm.id, authorId: author.id, isPrivate: cm.isPrivate });

      // votos: la "calidad" del post decide la proporción de UP/DOWN
      const quality = 0.1 + rand() * 0.85;
      for (const voter of members) {
        if (voter.id === author.id || rand() > 0.7) continue;
        await c.query(
          'insert into post_vote (post_id, community_profile_id, "voteType") values ($1,$2,$3)',
          [postId, profileId.get(`${voter.id}:${cm.id}`), rand() < quality ? 'UP' : 'DOWN'],
        );
        votes++;
      }
      // respuestas (~40% de los posts)
      if (rand() < 0.4) {
        const n = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          const replier = pick(members);
          await c.query(
            'insert into reply (body, post_id, community_profile_id) values ($1,$2,$3)',
            [pick(REPLIES), postId, profileId.get(`${replier.id}:${cm.id}`)],
          );
          replies++;
        }
      }
    }
  }

  // --- favoritos: cada usuario guarda 5 posts públicos ajenos
  let favorites = 0;
  const publicPosts = allPosts.filter((p) => !p.isPrivate);
  for (const u of users) {
    for (const post of sample(publicPosts.filter((p) => p.authorId !== u.id), 5)) {
      await c.query('insert into favorite (user_id, item_id, "itemType") values ($1,$2,\'POST\')', [u.id, post.id]);
      favorites++;
    }
  }

  const name = new Map(communities.map((cm) => [cm.id, cm.name]));
  const tagName = new Map((await c.query('select tag_id, name from tag')).rows.map((r) => [r.tag_id, r.name]));
  console.log(`Comunidades: ${communities.length} (${communities.length - 1} públicas, 1 privada) | usuarios: ${users.length} | posts: ${allPosts.length} | votos: ${votes} | respuestas: ${replies} | favoritos: ${favorites}`);
  console.log(`Login: cualquier seed_* con contraseña ${PASSWORD}\n`);
  for (const u of users) {
    console.log(`${u.username}  intereses: ${u.interests.map((t) => tagName.get(t)).join(', ')}`);
    console.log(`   comunidades: ${[...u.joined].map((id) => name.get(id)).join(' | ')}`);
  }
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
    await c.query('begin');
    await clean(c);
    if (!process.argv.includes('--clean')) await seed(c);
    else console.log('Datos seed eliminados.');
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
