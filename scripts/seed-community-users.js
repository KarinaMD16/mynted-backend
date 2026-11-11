/* eslint-disable */
// Usuarios, posts, hilos de conversación y productos de prueba para dos
// comunidades:
//   - My Little Pony Latam (ya existe; se busca por slug/nombre "mylittleponylatam")
//   - Minecraft Crafters CR (se crea por la API si no existe una de Minecraft)
//
// Imágenes en scripts/seed-images/{mlp-posts,minecraft-posts,minecraft-productos,minecraft-comunidad}
//
// Uso (desde la raíz del repo, con el backend corriendo: npm run start:dev):
//   node scripts/seed-community-users.js          -> limpia lo anterior y siembra
//   node scripts/seed-community-users.js --clean  -> solo borra lo sembrado
//   API_URL=http://localhost:3000 ...             -> URL del backend
//
// Cómo funciona:
//   - Usuarios, vendedores y membresías se insertan directo en la BD (como en
//     seed-forum-test-data.js). Contraseña de todos: Test1234.
//   - Comunidad, posts (con imágenes a Cloudinary), respuestas, votos,
//     favoritos y productos se crean por la API, con un access_token firmado
//     con JWT_SECRET para cada usuario. Así pasan por las validaciones reales.
//   - Al final se reparten las fechas de posts y respuestas en los últimos
//     días para que los feeds se vean naturales.
//
// Todo lo sembrado se identifica por el email @seed.mynted.test; --clean borra
// esos usuarios (y en cascada sus perfiles, posts, respuestas, votos y
// productos), sus datos de pago y la comunidad de Minecraft si la creó el seed.
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
process.chdir(root);
require(path.join(root, 'node_modules/dotenv')).config({ quiet: true });
const { Client } = require(path.join(root, 'node_modules/pg'));
const bcrypt = require(path.join(root, 'node_modules/bcrypt'));
const jwt = require(path.join(root, 'node_modules/jsonwebtoken'));

const PASSWORD = 'Test1234';
const EMAIL_DOMAIN = 'seed.mynted.test';
const PAYMENT_PREFIX = 'SEED-';
const API_URL = (process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const IMG = path.join(__dirname, 'seed-images');
const MLP_KEY = 'mylittleponylatam';
const MINECRAFT_SLUG = 'minecraft-crafters-cr';
const NEW_TAGS = ['Minecraft', 'Fan Art', 'Videojuegos'];

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------
// communities: 'mlp' | 'mc'. seller: datos de la tienda (si vende).
const USERS = [
  // --- My Little Pony Latam
  { username: 'lunadreamer', country: 'CR', communities: ['mlp'], interests: ['My Little Pony', 'Plushies', 'Vintage Dolls'],
    bio: 'Team Luna desde 2011 🌙 Coleccionista de G4 y fan del fanart.' },
  { username: 'pastelhooves', country: 'MX', communities: ['mlp'], interests: ['My Little Pony', 'Anime Figures', 'Comic Books'],
    bio: 'Ilustradora 🎨 Dibujo ponis todos los días. Comisiones abiertas por mensaje.' },
  { username: 'ponyvillebrony', country: 'CO', communities: ['mlp'], interests: ['My Little Pony', 'Action Figures', 'Comic Books'],
    bio: 'Brony de Medellín. Me encanta debatir lore y teorías de Equestria.' },
  { username: 'glimmerstar', country: 'AR', communities: ['mlp'], interests: ['My Little Pony', 'Funko Pop', 'Manga'],
    bio: 'Starlight Glimmer es la mejor villana reformada y no acepto debate ✨' },
  { username: 'rainbowflash_pe', country: 'PE', communities: ['mlp'], interests: ['My Little Pony', 'Plushies', 'Trading Cards'],
    bio: '20% más cool. Desde Lima coleccionando todo lo de Rainbow Dash.' },
  { username: 'derpymuffins', country: 'CL', communities: ['mlp', 'mc'], interests: ['My Little Pony', 'Retro Games', 'Lego Sets'],
    bio: 'Muffins, ponis y bloques. Juego Minecraft con mi hermano los fines de semana.' },

  // --- Minecraft Crafters CR
  { username: 'creeperqueen', country: 'CR', communities: ['mc'], interests: ['Action Figures', 'Plushies', 'Lego Sets'],
    bio: 'Hago lamparitas y manualidades de Minecraft a mano 🐝 Tienda en Mynted.',
    seller: { displayName: 'Creeper Queen Crafts', description: 'Manualidades, merch y figuras de Minecraft. Envíos a todo Costa Rica.', location: 'Heredia, Costa Rica', owner: 'Daniela Mora Solís', bank: 'BAC Credomatic' } },
  { username: 'blockbuilder_cr', country: 'CR', communities: ['mc'], interests: ['Retro Games', 'Lego Sets', 'Model Kits'],
    bio: 'Constructor en survival. Vendo juegos y figuras que ya no uso.',
    seller: { displayName: 'BlockBuilder Store', description: 'Juegos físicos y figuras de Minecraft en buen estado.', location: 'San José, Costa Rica', owner: 'Esteban Rojas Vargas', bank: 'Banco Nacional' } },
  { username: 'enderpixel', country: 'MX', communities: ['mc'], interests: ['Retro Games', 'Action Figures', 'Board Games'],
    bio: 'Explorador de semillas raras. Día 5 y ya encontré cosas locas.' },
  { username: 'villagerjuan', country: 'CR', communities: ['mc'], interests: ['Comic Books', 'Retro Games', 'Manga'],
    bio: 'Dibujo, Gravity Falls y Minecraft. Hmmm 🟫' },
  { username: 'redstonemaria', country: 'CO', communities: ['mc'], interests: ['Anime Figures', 'Retro Games', 'Plushies'],
    bio: 'Ingeniera de redstone de día, dibujante de aldeanos de noche.' },
];

// ---------------------------------------------------------------------------
// Comunidad de Minecraft (si no existe ninguna de Minecraft)
// ---------------------------------------------------------------------------
const MINECRAFT_COMMUNITY = {
  owner: 'creeperqueen',
  name: 'Minecraft Crafters CR',
  slug: MINECRAFT_SLUG,
  description:
    'Comunidad para fans de Minecraft en Costa Rica y Latam: mostrá tus construcciones, fanart y ' +
    'colección de figuras, peluches y merch. Compra, venta e intercambio entre crafters.',
  tags: ['Minecraft', 'Videojuegos', 'Action Figures'],
  rules: [
    'Respeto ante todo: nada de insultos ni acoso.',
    'Si compartís arte de otra persona, dale crédito.',
    'Las ventas e intercambios van con fotos reales del producto.',
    'Nada de spam ni links sospechosos.',
  ],
  image: 'minecraft-comunidad/icon-creeper.jpg',
  banner: 'minecraft-comunidad/banner-grass.jpg',
};

// ---------------------------------------------------------------------------
// Posts e hilos. daysAgo/hour fijan la fecha del post; las respuestas se
// colocan unos minutos/horas después, en orden. parent = key de otra respuesta.
// ---------------------------------------------------------------------------
const POSTS = [
  // ===================== My Little Pony Latam =====================
  {
    community: 'mlp', author: 'rainbowflash_pe', daysAgo: 12, hour: 19,
    title: '¿Qué personaje tiene el cuerpo más aerodinámico?',
    images: ['mlp-posts/aerodynamic-build.webp'],
    tags: ['My Little Pony', 'Fan Art'],
    body:
      'Estaba viendo este póster con casi todo el elenco y me quedé pensando: si hiciéramos una carrera de vuelo, ' +
      '¿quién tiene el cuerpo más aerodinámico? Yo obviamente voto por Rainbow Dash (melena hacia atrás, alas compactas, ' +
      'cero resistencia al viento), pero Spitfire y Soarin también tienen lo suyo. Los leo 👀',
    replies: [
      { key: 'a', by: 'ponyvillebrony', text: 'Derpy. Choca con todo y sigue volando, eso es ingeniería pura 😂' },
      { key: 'b', by: 'derpymuffins', parent: 'a', text: 'Gracias por el respeto a la reina 🧁 Los muffins también son aerodinámicos.' },
      { key: 'c', by: 'glimmerstar', text: 'Técnicamente Spitfire, es la capitana de los Wonderbolts por algo. Rainbow todavía está aprendiendo jaja' },
      { key: 'd', by: 'rainbowflash_pe', parent: 'c', text: 'Rainbow le ganó a Spitfire en varias pruebas, no me hagás esto 😤' },
      { key: 'e', by: 'lunadreamer', text: 'Luna tiene las alas más grandes de todas, ¿eso no cuenta?' },
      { key: 'f', by: 'rainbowflash_pe', parent: 'e', text: 'Alas grandes = más resistencia jaja, sirven para planear, no para la Sonic Rainboom.' },
      { key: 'g', by: 'pastelhooves', text: 'Como dibujante te digo que Fluttershy tiene las patas más largas del grupo, igual sorprende a todos 🦋' },
    ],
  },
  {
    community: 'mlp', author: 'glimmerstar', daysAgo: 10, hour: 14,
    title: 'Lyra solo tiene ojos para Bon Bon',
    images: ['mlp-posts/lyra-bon-bon.webp'],
    tags: ['My Little Pony'],
    body:
      'Volví a ver "Amending Fences" y no había notado este detalle: en la fiesta todas están felices comiendo cupcakes ' +
      'con Moondancer y Twilight, y Lyra está ahí sonriendo pero claramente pensando en una sola pony. ' +
      'Lyra y Bon Bon son canon y la serie lo sabía desde la temporada 1. ¿Cuál es su escena favorita de ellas dos?',
    replies: [
      { key: 'a', by: 'lunadreamer', text: '"Slice of Life" obviamente. Cuando Bon Bon cuenta que es agente secreta y Lyra ni se inmuta 💚' },
      { key: 'b', by: 'glimmerstar', parent: 'a', text: '¡Sí! Y el final de la serie con ellas juntas en la boda. Lloré.' },
      { key: 'c', by: 'ponyvillebrony', text: 'Lo mejor es que los animadores las ponían juntas en el fondo en casi todos los episodios. Fandom 1, guionistas 0.' },
      { key: 'd', by: 'derpymuffins', text: 'Las cupcakes de esa escena se ven riquísimas, no voy a mentir 🧁' },
      { key: 'e', by: 'rainbowflash_pe', parent: 'd', text: 'Siempre pensando en comida jajaja' },
    ],
  },
  {
    community: 'mlp', author: 'pastelhooves', daysAgo: 8, hour: 20,
    title: 'Les presento mi ponysona',
    images: ['mlp-posts/ponysona.webp'],
    tags: ['My Little Pony', 'Fan Art'],
    body:
      '¡Por fin terminé el diseño de mi ponysona! Se llama Seafoam Shell 🐚: una pegaso de playa con melena de espuma de mar ' +
      'en tonos menta, lila y amarillo pastel, una concha con perla en el cabello y flores de plumeria. ' +
      'Me tomó como tres versiones llegar a esta. ¿Qué les parece? ¿Ustedes tienen ponysona?',
    replies: [
      { key: 'a', by: 'lunadreamer', text: 'Me encantan los rulos de la melena, parecen olas de verdad 😍' },
      { key: 'b', by: 'pastelhooves', parent: 'a', text: '¡Esa era la idea! Gracias 💙' },
      { key: 'c', by: 'glimmerstar', text: 'Yo tengo una pero nunca la he dibujado bien... ¿aceptás comisiones?' },
      { key: 'd', by: 'pastelhooves', parent: 'c', text: 'Sí, escribime por mensaje y te paso precios ✨' },
      { key: 'e', by: 'rainbowflash_pe', text: 'Los brillitos y la paleta pastel quedaron perfectos. ¿Qué programa usás?' },
      { key: 'f', by: 'pastelhooves', parent: 'e', text: 'Procreate en iPad, con un pincel de lineart que hice yo.' },
      { key: 'g', by: 'derpymuffins', text: 'Seafoam Shell suena a nombre oficial de la serie, 10/10' },
    ],
  },
  {
    community: 'mlp', author: 'lunadreamer', daysAgo: 6, hour: 11,
    title: 'Fanart de Starlight Glimmer humana hecho por ShrimpBat',
    images: ['mlp-posts/human-starlight.webp'],
    tags: ['My Little Pony', 'Fan Art'],
    body:
      'Encontré este fanart de Starlight Glimmer humana hecho por ShrimpBat (todo el crédito para el artista) y tenía que compartirlo. ' +
      'Recrea la cara de "villana relajada" de la temporada 5 y el detalle de la taza que dice "Twilight Sparkle\'s Tears" me mató 😂',
    replies: [
      { key: 'a', by: 'glimmerstar', text: 'LA TAZA. Esta es exactamente la energía de Starlight en la temporada 5.' },
      { key: 'b', by: 'lunadreamer', parent: 'a', text: 'Sabía que ibas a ser la primera en comentar jaja' },
      { key: 'c', by: 'pastelhooves', text: 'El estilo de ShrimpBat es buenísimo, la pose es idéntica al frame del cuadrito.' },
      { key: 'd', by: 'ponyvillebrony', text: 'Starlight pasó de villana a directora de escuela, el mejor arco de redención de la serie.' },
      { key: 'e', by: 'glimmerstar', parent: 'd', text: 'Gracias, alguien que entiende 🙏' },
    ],
  },
  {
    community: 'mlp', author: 'ponyvillebrony', daysAgo: 4, hour: 18,
    title: 'Creo que tendría más sentido que Celestia y Luna...',
    images: ['mlp-posts/celestia-luna.webp'],
    tags: ['My Little Pony', 'Fan Art'],
    body:
      '...tener los tamaños al revés. Vi este rediseño (arte de Night Heart) donde Luna es la alicornio enorme e imponente, ' +
      'con alas de constelaciones, y Celestia es más pequeña y cálida. Si lo piensan, la noche es inmensa y el sol "cuida" ' +
      'de cerca, así que tiene sentido. Además Luna pasó mil años sola en la luna, podría haber crecido 😅 ¿Qué opinan?',
    replies: [
      { key: 'a', by: 'lunadreamer', text: 'Como fan de Luna: SÍ. Este diseño le queda perfecto, las alas con estrellas 😭🌙' },
      { key: 'b', by: 'glimmerstar', text: 'No sé, Celestia siempre fue la hermana mayor y la gobernante principal. Que sea más alta tiene lógica.' },
      { key: 'c', by: 'ponyvillebrony', parent: 'b', text: 'Pero en edad no se llevan tanto, y Luna como Nightmare Moon ya era enorme.' },
      { key: 'd', by: 'glimmerstar', parent: 'c', text: 'Ok, punto para vos con lo de Nightmare Moon.' },
      { key: 'e', by: 'pastelhooves', text: 'El contraste de colores en este arte es precioso. Me dieron ganas de dibujar mi versión.' },
      { key: 'f', by: 'ponyvillebrony', parent: 'e', text: '¡Hacelo y lo compartís aquí!' },
      { key: 'g', by: 'rainbowflash_pe', text: 'Celestia pequeñita con esos rizos se ve adorable, no voy a mentir.' },
    ],
  },
  {
    community: 'mlp', author: 'pastelhooves', daysAgo: 2, hour: 16,
    title: 'Más dibujos, algunos acercamientos',
    images: ['mlp-posts/more-drawings.webp'],
    tags: ['My Little Pony', 'Fan Art'],
    body:
      'Más dibujos de esta semana. Este es un acercamiento de Rainbow Dash en versión invierno: gorro morado con estrellita, ' +
      'bufanda de rayas y guantes. Quería probar un estilo más texturizado, tipo grano de papel. ' +
      'Pronto subo el de Fluttershy con orejeras ❄️',
    replies: [
      { key: 'a', by: 'rainbowflash_pe', text: '¡¡RAINBOW CON GORRO!! Me lo voy a poner de fondo de pantalla 🌈' },
      { key: 'b', by: 'pastelhooves', parent: 'a', text: 'Jajaja sabía que te iba a gustar' },
      { key: 'c', by: 'lunadreamer', text: 'La textura le da un toque súper acogedor. ¿Harías stickers con estos?' },
      { key: 'd', by: 'pastelhooves', parent: 'c', text: 'Lo estoy pensando, ¡si hay interés hago un pedido!' },
      { key: 'e', by: 'derpymuffins', parent: 'd', text: 'Yo quiero uno para la laptop.' },
    ],
  },

  // ===================== Minecraft Crafters CR =====================
  {
    community: 'mc', author: 'creeperqueen', daysAgo: 13, hour: 10,
    title: '¡Bienvenidos a Minecraft Crafters CR!',
    images: [],
    tags: ['Minecraft'],
    body:
      'Hola a todos 💚 Abrí esta comunidad para juntar a la gente que juega y colecciona Minecraft en Costa Rica y Latam. ' +
      'Aquí pueden mostrar sus construcciones, fanart, figuras y merch, y también vender o intercambiar. ' +
      'Lean las reglas y preséntense: ¿Java o Bedrock? ¿Survival o creativo?',
    replies: [
      { key: 'a', by: 'blockbuilder_cr', text: 'Bedrock en PS5, survival siempre. ¡Gracias por crearla!' },
      { key: 'b', by: 'villagerjuan', text: 'Java y mucho creativo para construir pueblos 🏘️' },
      { key: 'c', by: 'enderpixel', text: 'Bedrock en Switch. Explorador profesional de semillas.' },
      { key: 'd', by: 'redstonemaria', text: 'Java por la redstone, obvio 🔴' },
      { key: 'e', by: 'derpymuffins', text: 'Llegué de la comunidad de ponis jaja, Bedrock con mi hermano.' },
      { key: 'f', by: 'creeperqueen', parent: 'e', text: '¡Bienvenidx! Los ponis y los creepers se llevan bien 😂' },
    ],
  },
  {
    community: 'mc', author: 'redstonemaria', daysAgo: 9, hour: 21,
    title: 'Dibujé una familia de aldeanos',
    images: ['minecraft-posts/villager-family.webp'],
    tags: ['Minecraft', 'Fan Art'],
    body:
      'Hice este dibujo de una familia de aldeanos: el papá granjero con su bebé en hombros (con sombrero de paja), ' +
      'la abuela clériga con los brazos cruzados y el pequeño saludando. Quería que se sintieran como una familia de verdad ' +
      'y no solo NPCs que gritan "hmm". ¿Qué profesión de aldeano dibujo después?',
    replies: [
      { key: 'a', by: 'villagerjuan', text: 'Como villager oficial de la comunidad, me siento representado 🟫 Hmmm.' },
      { key: 'b', by: 'redstonemaria', parent: 'a', text: 'Jajaja sabía que ibas a decir eso' },
      { key: 'c', by: 'creeperqueen', text: 'El bebé en los hombros es lo más tierno que he visto. Dibujá al bibliotecario porfa 📚' },
      { key: 'd', by: 'enderpixel', text: 'Ahora me siento mal por todas las veces que los encerré para tradear 😭' },
      { key: 'e', by: 'blockbuilder_cr', parent: 'd', text: 'Todos tenemos un salón de comercio con aldeanos en celdas, no te sientas solo.' },
    ],
  },
  {
    community: 'mc', author: 'enderpixel', daysAgo: 7, hour: 13,
    title: 'Encontré una roca con forma de elefante cerca del spawn',
    images: ['minecraft-posts/elephant-rock.webp'],
    tags: ['Minecraft', 'Videojuegos'],
    body:
      'Día 5 en mi mundo nuevo y encontré esta formación de piedra que parece un elefante, con trompa y todo, ' +
      'justo al atardecer. Está en las coordenadas 0, 84, -175, muy cerca del spawn. ' +
      'Es Bedrock 1.21; si quieren la semilla se las paso para que la vean ustedes mismos 🐘',
    replies: [
      { key: 'a', by: 'redstonemaria', text: '¡Es idéntico! Hasta las lianas parecen las orejas.' },
      { key: 'b', by: 'blockbuilder_cr', text: 'Pasá la semilla, quiero construir una base adentro del elefante 😂' },
      { key: 'c', by: 'enderpixel', parent: 'b', text: 'Te la mando por mensaje, ¡después enseñá la base!' },
      { key: 'd', by: 'derpymuffins', text: 'Esos shaders del atardecer están preciosos. ¿Cuáles usás?' },
      { key: 'e', by: 'enderpixel', parent: 'd', text: 'Es el modo Vibrant Visuals de Bedrock, sin mods.' },
    ],
  },
  {
    community: 'mc', author: 'villagerjuan', daysAgo: 5, hour: 17,
    title: 'Dibujé páginas de un diario de Minecraft inspirado en Gravity Falls',
    images: ['minecraft-posts/journal-1.webp', 'minecraft-posts/journal-2.webp', 'minecraft-posts/journal-3.webp'],
    tags: ['Minecraft', 'Fan Art'],
    body:
      'Siempre quise hacer un "Diario 3" de Gravity Falls pero del mundo de Minecraft. Aquí van tres páginas: ' +
      'Steve como el Hombre de Vitruvio ("Dominus Omnium"), notas sobre criaturas y textos en código como en la serie. ' +
      'El papel está envejecido con café de verdad ☕ ¿Alguien logra descifrar el criptograma?',
    replies: [
      { key: 'a', by: 'redstonemaria', text: '¡¡Esto está increíble!! El detalle del papel manchado se ve real.' },
      { key: 'b', by: 'enderpixel', text: 'Estoy intentando descifrarlo... ¿es un cifrado de sustitución como el de Bill?' },
      { key: 'c', by: 'villagerjuan', parent: 'b', text: 'Puede ser 👁️ No digo más.' },
      { key: 'd', by: 'creeperqueen', text: 'Deberías hacer el diario completo e imprimirlo, yo lo compraría.' },
      { key: 'e', by: 'villagerjuan', parent: 'd', text: '¡Gracias! Si llego a 20 páginas lo pongo a la venta aquí.' },
      { key: 'f', by: 'derpymuffins', text: 'Gravity Falls + Minecraft es un crossover que no sabía que necesitaba.' },
    ],
  },
  {
    community: 'mc', author: 'blockbuilder_cr', daysAgo: 3, hour: 22,
    title: '¿Qué puedo hacer para que mi base no parezca una cárcel?',
    images: ['minecraft-posts/base-prison.webp'],
    tags: ['Minecraft', 'Videojuegos'],
    body:
      'Terminé el patio central de mi base de piedra con la fuente en el medio, pero de noche se siente como una cárcel 😅 ' +
      'Todo es gris, los muros son muy altos y las ventanas iguales. ¿Qué le cambiarían para que se sienta más acogedora?',
    replies: [
      { key: 'a', by: 'creeperqueen', text: 'Meté madera: vigas de roble oscuro en las esquinas y marcos de ventana. Rompe muchísimo el gris.' },
      { key: 'b', by: 'redstonemaria', text: 'Linternas colgando y faroles en el camino. Y cambiá la fuente por agua con sea lanterns abajo.' },
      { key: 'c', by: 'blockbuilder_cr', parent: 'b', text: 'Lo de las sea lanterns bajo el agua no se me había ocurrido, ¡gracias!' },
      { key: 'd', by: 'villagerjuan', text: 'Árboles y flores en el patio. Azaleas y cerezos le darían vida.' },
      { key: 'e', by: 'enderpixel', text: 'Variá los bloques del muro: piedra, andesita pulida, piedra musgosa. La textura cambia todo.' },
      { key: 'f', by: 'creeperqueen', parent: 'e', text: 'Y escaleras/losas en la fachada para dar profundidad.' },
      { key: 'g', by: 'blockbuilder_cr', text: 'Voy a probar todo esto y subo el antes/después 🙌' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Productos (en la comunidad de Minecraft). Precios en CRC (la moneda de los vendedores).
// ---------------------------------------------------------------------------
const PRODUCTS = [
  {
    seller: 'creeperqueen', image: 'minecraft-productos/lamparita-abeja.jpg',
    title: 'Lamparita de abeja de Minecraft hecha a mano',
    description:
      'Lamparita decorativa en frasco de vidrio con una abeja de Minecraft flotando sobre un jardín de tulipanes rojos pixelados. ' +
      'Hecha a mano con papel pixel art y luz LED cálida de baterías (incluidas). Mide unos 15 cm de alto. ' +
      'Perfecta como luz de noche o para el escritorio gamer. Hecha por pedido, lista en 3 días.',
    price: 12000, discountPercent: null, type: 'sale', condition: 'new', shipsTo: ['CR'],
    tags: ['Minecraft', 'Model Kits', 'Action Figures'],
  },
  {
    seller: 'creeperqueen', image: 'minecraft-productos/set-16-minifiguras.jpg',
    title: 'Set de 16 minifiguras estilo Minecraft con accesorios',
    description:
      'Caja con 16 minifiguras armables estilo Minecraft (línea "My World", no oficial) compatibles con bloques tipo Lego. ' +
      'Incluye Steve, Alex, zombie, esqueleto, Herobrine, mineros con casco y más, cada uno con su arma o herramienta. ' +
      'Caja nueva y sellada, trae base para armar. Ideal para regalo.',
    price: 9500, discountPercent: null, type: 'sale', condition: 'new', shipsTo: ['CR', 'PA'],
    tags: ['Minecraft', 'Lego Sets', 'Action Figures'],
  },
  {
    seller: 'creeperqueen', image: 'minecraft-productos/lote-merch-creeper.jpg',
    title: 'Lote de merch Creeper: peluche, mochila, gorras, taza y más',
    description:
      'Lote de merch de Minecraft, todo nuevo: peluche de Creeper, mochila estilo cofre, lámparas Icons de Steve y Esqueleto ' +
      '(Paladone), pantuflas de Creeper, cojín en forma de control, taza cuadrada de Creeper, tres gorras (una "Time to Mine") ' +
      'y billetera. El precio es por el lote completo; también vendo por separado, pregunte por mensaje.',
    price: 68000, discountPercent: 10, type: 'sale', condition: 'new', shipsTo: ['CR'],
    tags: ['Minecraft', 'Plushies', 'Action Figures'],
  },
  {
    seller: 'blockbuilder_cr', image: 'minecraft-productos/minecraft-ps5.jpg',
    title: 'Minecraft para PS5 (físico)',
    description:
      'Juego físico de Minecraft para PlayStation 5, edición con el arte de los cerezos. Disco sin rayones y caja en perfecto estado. ' +
      'El código de 3500 tokens ya fue canjeado. Me pasé a la versión de PC, por eso lo vendo. Entrega en San José o envío por Correos.',
    price: 19000, discountPercent: null, type: 'sale', condition: 'like_new', shipsTo: ['CR'],
    tags: ['Minecraft', 'Videojuegos', 'Retro Games'],
  },
  {
    seller: 'blockbuilder_cr', image: 'minecraft-productos/world-builder-7pk.jpg',
    title: 'Minecraft World Builder Pack - 7 figuras (Mattel)',
    description:
      'Pack Mundial de Constructor de Mattel con 7 figuras: Steve, Alex, Creeper, lobo, esqueleto, Enderman y delfín, ' +
      'más el código de item digital exclusivo (sin usar). Las figuras están selladas, pero la caja tiene golpes y dobleces ' +
      'en las esquinas (ver foto). Acepto intercambio por figuras de Minecraft Legends o Dungeons.',
    price: 22000, discountPercent: null, type: 'exchange', condition: 'good_condition', shipsTo: ['CR', 'PA'],
    tags: ['Minecraft', 'Action Figures', 'Videojuegos'],
  },
];

// Favoritos (usuario -> títulos de posts que guarda)
const FAVORITES = {
  lunadreamer: ['Les presento mi ponysona', 'Creo que tendría más sentido que Celestia y Luna...'],
  glimmerstar: ['Fanart de Starlight Glimmer humana hecho por ShrimpBat', 'Más dibujos, algunos acercamientos'],
  rainbowflash_pe: ['Más dibujos, algunos acercamientos', '¿Qué personaje tiene el cuerpo más aerodinámico?'],
  derpymuffins: ['Les presento mi ponysona', 'Encontré una roca con forma de elefante cerca del spawn'],
  redstonemaria: ['Dibujé páginas de un diario de Minecraft inspirado en Gravity Falls'],
  creeperqueen: ['Dibujé una familia de aldeanos', 'Dibujé páginas de un diario de Minecraft inspirado en Gravity Falls'],
  enderpixel: ['¿Qué puedo hacer para que mi base no parezca una cárcel?'],
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1021);

function fail(message) {
  throw new Error(message);
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
function fileBlob(rel) {
  const file = path.join(IMG, rel);
  if (!fs.existsSync(file)) fail(`No se encontró la imagen ${file}`);
  return new Blob([fs.readFileSync(file)], { type: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
}

function tokenFor(user) {
  return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: 1800 });
}

async function api(method, url, user, body) {
  const headers = { Cookie: `access_token=${user.token}` };
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${API_URL}${url}`, { method, headers, body: payload });
  } catch (e) {
    fail(`No se pudo conectar con el backend en ${API_URL} (¿está corriendo?): ${e.message}`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message || text;
    fail(`${method} ${url} (como ${user.username}) -> ${res.status}: ${msg}`);
  }
  return data;
}

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------------------
// Limpieza
// ---------------------------------------------------------------------------
async function clean(c) {
  const users = (await c.query('select id from users where email like $1', [`%@${EMAIL_DOMAIN}`])).rows.map((r) => r.id);
  if (users.length) {
    const profiles = `select community_profile_id from community_profile where user_id = any($1)`;
    // Favoritos de usuarios reales que apuntan a contenido sembrado (item_id no tiene FK).
    await c.query(
      `delete from favorite where "itemType" = 'POST' and item_id in (select id from post where community_profile_id in (${profiles}))`,
      [users],
    );
    await c.query(
      `delete from favorite where "itemType" = 'REPLY' and item_id in (select id from reply where community_profile_id in (${profiles}))`,
      [users],
    );
    await c.query(
      `delete from favorite where "itemType" = 'PRODUCT' and item_id in (select p.id from product p join seller s on s.seller_id = p.seller_id where s.user_id = any($1))`,
      [users],
    );
    // users -> community_profile/seller/... en cascada (posts, respuestas, votos, productos).
    await c.query('delete from users where id = any($1)', [users]);
  }
  // Solo los datos de pago que ya no usa ningún vendedor: seed-twilightbuns-products.js
  // también usa el prefijo SEED- (SEED-TWILIGHTBUNS) y seller.payment_id es RESTRICT.
  await c.query(
    `delete from payment_info p
      where p.number like $1
        and not exists (select 1 from seller s where s.payment_id = p.payment_info_id)`,
    [`${PAYMENT_PREFIX}%`],
  );
  await c.query('delete from community where slug = $1', [MINECRAFT_SLUG]);
  return users.length;
}

// ---------------------------------------------------------------------------
// Siembra
// ---------------------------------------------------------------------------
async function ensureTags(c) {
  for (const name of NEW_TAGS) {
    await c.query('insert into tag (name, is_interest) values ($1, false) on conflict (name) do nothing', [name]);
  }
  return new Map((await c.query('select tag_id, name from tag')).rows.map((r) => [r.name.trim().toLowerCase(), r.tag_id]));
}

function tagIds(names, tags, { exact } = {}) {
  const ids = [];
  for (const n of names) {
    const id = tags.get(n.toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
  }
  // Productos: exactamente 3 tags. Se completa con tags genéricos si alguno no existe.
  if (exact) {
    for (const n of ['Minecraft', 'Action Figures', 'Videojuegos', 'Plushies', 'Lego Sets']) {
      if (ids.length >= exact) break;
      const id = tags.get(n.toLowerCase());
      if (id && !ids.includes(id)) ids.push(id);
    }
    if (ids.length < exact) fail(`No hay ${exact} tags válidos para: ${names.join(', ')}`);
  }
  if (!ids.length) fail(`Ningún tag existe de: ${names.join(', ')}`);
  return ids.slice(0, 3);
}

async function findMlpCommunity(c) {
  const rows = (await c.query('select id, name, slug, is_active from community')).rows;
  const found = rows.find((r) => normalize(r.slug) === MLP_KEY) || rows.find((r) => normalize(r.name) === MLP_KEY);
  if (!found) fail(`No se encontró la comunidad "${MLP_KEY}" (por slug o nombre). Créala primero.`);
  if (!found.is_active) fail(`La comunidad "${found.name}" está desactivada.`);
  return found;
}

async function createUsers(c, tags) {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const byName = new Map();
  for (const u of USERS) {
    const isSeller = Boolean(u.seller);
    const r = await c.query(
      `insert into users (email, username, password_hash, bio, role, seller_request_status, seller_requested_at,
                          currency, country, locale, accepted_privacy_policy_at, privacy_policy_version)
       values ($1,$2,$3,$4,$5,$6,$7,'CRC',$8,'es', now(), 'seed') returning id, email`,
      [
        `${u.username}@${EMAIL_DOMAIN}`, u.username, hash, u.bio,
        isSeller ? 'seller' : 'user', isSeller ? 'approved' : 'none', isSeller ? new Date() : null, u.country,
      ],
    );
    const user = { ...u, id: r.rows[0].id, email: r.rows[0].email };
    user.token = tokenFor(user);
    for (const name of u.interests) {
      const id = tags.get(name.toLowerCase());
      if (id) await c.query('insert into user_tag (user_id, tag_id) values ($1,$2) on conflict do nothing', [user.id, id]);
    }
    if (isSeller) {
      const pay = await c.query(
        `insert into payment_info (owner_full_name, name, number, type) values ($1,$2,$3,'bank_account') returning payment_info_id`,
        [u.seller.owner, u.seller.bank, `${PAYMENT_PREFIX}CR${String(Math.floor(rand() * 1e12)).padStart(12, '0')}`],
      );
      await c.query(
        // is_verified + approved_at: la tienda solo es pública para vendedores aprobados (GET /sellers/:id).
        `insert into seller (display_name, description, location, user_id, payment_id, is_verified, approved_at) values ($1,$2,$3,$4,$5, true, now())`,
        [u.seller.displayName, u.seller.description, u.seller.location, user.id, pay.rows[0].payment_info_id],
      );
    }
    byName.set(u.username, user);
  }
  return byName;
}

async function joinCommunity(c, user, communityId) {
  await c.query(
    `insert into community_profile (display_name, bio, user_id, community_id, role)
     select $1, $2, $3, $4, 'member'
      where not exists (select 1 from community_profile where user_id = $3 and community_id = $4)`,
    [user.username, user.bio, user.id, communityId],
  );
}

async function ensureMinecraftCommunity(c, users, tags) {
  const existing = (
    await c.query(`select id, name from community where is_active = true and (slug ilike '%minecraft%' or name ilike '%minecraft%') order by id limit 1`)
  ).rows[0];
  if (existing) return existing;

  const cfg = MINECRAFT_COMMUNITY;
  const category = (
    await c.query(
      `select category_id from category where is_active = true
        order by case when name ilike '%minecraft%' then 0 when name ilike '%juego%' or name ilike '%game%' then 1
                      when name ilike 'otra%' then 2 else 3 end, category_id limit 1`,
    )
  ).rows[0];
  if (!category) fail('No hay categorías activas para crear la comunidad de Minecraft.');

  const form = new FormData();
  form.append('name', cfg.name);
  form.append('description', cfg.description);
  form.append('slug', cfg.slug);
  form.append('isPrivate', 'false');
  form.append('categoryId', String(category.category_id));
  form.append('tagIds', JSON.stringify(tagIds(cfg.tags, tags)));
  form.append('rules', JSON.stringify(cfg.rules));
  form.append('image', fileBlob(cfg.image), path.basename(cfg.image));
  form.append('banner', fileBlob(cfg.banner), path.basename(cfg.banner));
  await api('POST', '/communities', users.get(cfg.owner), form);

  return (await c.query('select id, name from community where slug = $1', [cfg.slug])).rows[0];
}

async function profileId(c, userId, communityId) {
  return (await c.query('select community_profile_id from community_profile where user_id = $1 and community_id = $2', [userId, communityId]))
    .rows[0].community_profile_id;
}

async function createPosts(c, users, communities, tags) {
  const created = []; // { def, id, replyIds: Map }
  for (const def of POSTS) {
    const author = users.get(def.author);
    const communityId = communities[def.community].id;
    const form = new FormData();
    form.append('title', def.title);
    form.append('body', def.body);
    form.append('tagIds', JSON.stringify(tagIds(def.tags, tags)));
    for (const img of def.images) form.append('images', fileBlob(img), path.basename(img));
    const res = await api('POST', `/communities/${communityId}/posts`, author, form);
    let id = res?.id ?? res?.postId;
    if (!id) {
      id = (await c.query(
        'select id from post where title = $1 and community_profile_id = $2 order by id desc limit 1',
        [def.title, await profileId(c, author.id, communityId)],
      )).rows[0].id;
    }

    const replyIds = new Map();
    for (const r of def.replies) {
      const body = { body: r.text };
      if (r.parent) body.parentReplyId = replyIds.get(r.parent);
      const reply = await api('POST', `/posts/${id}/replies`, users.get(r.by), body);
      let replyId = reply?.id;
      if (!replyId) {
        replyId = (await c.query(
          'select id from reply where post_id = $1 and community_profile_id = $2 order by id desc limit 1',
          [id, await profileId(c, users.get(r.by).id, communityId)],
        )).rows[0].id;
      }
      replyIds.set(r.key, replyId);
    }
    created.push({ def, id, replyIds });
    console.log(`  post #${id} (${def.replies.length} respuestas)  ${def.title}`);
  }
  return created;
}

async function voteAndFavorite(users, posts) {
  let postVotes = 0;
  let replyVotes = 0;
  for (const { def, id, replyIds } of posts) {
    const members = [...users.values()].filter((u) => u.communities.includes(def.community) && u.username !== def.author);
    for (const voter of members) {
      if (rand() < 0.85) {
        await api('PUT', `/posts/${id}/vote`, voter, { voteType: rand() < 0.93 ? 'UP' : 'DOWN' });
        postVotes++;
      }
    }
    for (const r of def.replies) {
      for (const voter of members) {
        if (voter.username === r.by || rand() > 0.35) continue;
        await api('PUT', `/replies/${replyIds.get(r.key)}/vote`, voter, { voteType: rand() < 0.9 ? 'UP' : 'DOWN' });
        replyVotes++;
      }
    }
  }
  let favorites = 0;
  const idByTitle = new Map(posts.map((p) => [p.def.title, p.id]));
  for (const [username, titles] of Object.entries(FAVORITES)) {
    for (const title of titles) {
      await api('PUT', `/posts/${idByTitle.get(title)}/favorite`, users.get(username));
      favorites++;
    }
  }
  return { postVotes, replyVotes, favorites };
}

// Reparte las fechas: cada post en su día/hora y sus respuestas después, en orden.
async function backdate(c, posts) {
  const now = Date.now();
  for (const { def, id, replyIds } of posts) {
    const day = new Date(now - def.daysAgo * 86400000);
    day.setHours(def.hour, Math.floor(rand() * 60), 0, 0);
    await c.query('update post set posted_at = $1 where id = $2', [day, id]);
    let t = day.getTime();
    for (const r of def.replies) {
      t += (8 + Math.floor(rand() * 170)) * 60000; // 8 min a ~3 h después de la anterior
      await c.query('update reply set posted_at = $1 where id = $2', [new Date(Math.min(t, now - 60000)), replyIds.get(r.key)]);
    }
  }
}

async function createProducts(users, communities, tags) {
  for (const p of PRODUCTS) {
    const form = new FormData();
    form.append('title', p.title);
    form.append('description', p.description);
    form.append('price', String(p.price));
    if (p.discountPercent) form.append('discountPercent', String(p.discountPercent));
    form.append('type', p.type);
    form.append('condition', p.condition);
    form.append('tagIds', JSON.stringify(tagIds(p.tags, tags, { exact: 3 })));
    form.append('shipsTo', JSON.stringify(p.shipsTo));
    form.append('image', fileBlob(p.image), path.basename(p.image));
    const res = await api('POST', `/communities/${communities.mc.id}/products`, users.get(p.seller), form);
    console.log(`  producto #${res?.id ?? '?'}  ${p.title}  (₡${p.price.toLocaleString('es-CR')}, ${p.seller})`);
  }
}

async function seed(c) {
  const tags = await ensureTags(c);
  const mlp = await findMlpCommunity(c);

  console.log('Usuarios y membresías...');
  const users = await createUsers(c, tags);
  for (const u of users.values()) if (u.communities.includes('mlp')) await joinCommunity(c, u, mlp.id);

  console.log('Comunidad de Minecraft...');
  const mc = await ensureMinecraftCommunity(c, users, tags);
  for (const u of users.values()) if (u.communities.includes('mc')) await joinCommunity(c, u, mc.id);
  const communities = { mlp, mc };
  console.log(`  ${mlp.name} (#${mlp.id}) | ${mc.name} (#${mc.id})\n`);

  console.log('Posts e hilos...');
  const posts = await createPosts(c, users, communities, tags);
  const stats = await voteAndFavorite(users, posts);
  await backdate(c, posts);

  console.log('\nProductos...');
  await createProducts(users, communities, tags);

  const replies = POSTS.reduce((n, p) => n + p.replies.length, 0);
  console.log(
    `\nListo: ${users.size} usuarios | ${posts.length} posts | ${replies} respuestas | ` +
      `${stats.postVotes} votos a posts | ${stats.replyVotes} votos a respuestas | ${stats.favorites} favoritos | ${PRODUCTS.length} productos`,
  );
  console.log(`Login: cualquiera de estos usuarios con contraseña ${PASSWORD}`);
  for (const u of users.values()) {
    const where = u.communities.map((k) => communities[k].name).join(' + ');
    console.log(`  ${u.username.padEnd(16)} ${u.seller ? '[vendedor] ' : ''}${where}`);
  }
}

(async () => {
  if (!process.env.JWT_SECRET) fail('Falta JWT_SECRET en el .env');
  const c = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USERNAME || process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || process.env.DB_DATABASE,
  });
  await c.connect();
  try {
    // La limpieza va en transacción. La siembra no puede: la API escribe con
    // su propia conexión y necesita ver los usuarios ya confirmados.
    await c.query('begin');
    const removed = await clean(c);
    await c.query('commit');
    if (process.argv.includes('--clean')) {
      console.log(`Datos seed eliminados (${removed} usuarios).`);
      return;
    }
    if (removed) console.log(`Se limpiaron ${removed} usuarios de una corrida anterior.\n`);
    await seed(c);
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('ERROR', e.message);
  console.error('Si quedó a medias, corra el script de nuevo: limpia lo anterior antes de sembrar.');
  process.exit(1);
});
