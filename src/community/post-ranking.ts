// Fórmulas SQL de ranking de posts. Se calculan en cada petición con los votos
// actuales, así el orden es dinámico: cambia cuando cambian los votos, el paso
// del tiempo o (en Explore) los intereses y comunidades del usuario.
//
// Todas asumen que la consulta tiene el alias `post` (tabla post).

export enum PostSort {
  // Mezcla de votos y frescura (por defecto).
  HOT = 'hot',
  // Más recientes primero, sin considerar votos.
  NEW = 'new',
  // Más votos netos (upvotes - downvotes) primero.
  TOP = 'top',
}

const UPVOTES = `(SELECT COUNT(*) FROM post_vote rank_vote WHERE rank_vote.post_id = post.id AND rank_vote."voteType" = 'UP')`;
const DOWNVOTES = `(SELECT COUNT(*) FROM post_vote rank_vote WHERE rank_vote.post_id = post.id AND rank_vote."voteType" = 'DOWN')`;

// Votos netos.
export const NET_VOTES_SQL = `(${UPVOTES} - ${DOWNVOTES})`;

// Votos netos en escala logarítmica y simétrica: 100 votos no valen 100 veces
// más que 1, y un post muy rechazado queda con valor negativo.
export const VOTES_SCORE_SQL = `(CASE WHEN ${NET_VOTES_SQL} >= 0 THEN LN(1 + ${NET_VOTES_SQL}) ELSE -LN(1 - ${NET_VOTES_SQL}) END)`;

// Edad del post en días.
export const AGE_DAYS_SQL = `(EXTRACT(EPOCH FROM (now() - post.posted_at)) / 86400.0)`;

// Decaimiento exponencial: tras `halfLifeDays` días el peso se reduce a la mitad.
export function decaySql(halfLifeDays: number): string {
  return `POWER(0.5, ${AGE_DAYS_SQL} / ${halfLifeDays})`;
}

// "Hot": (1 + votos) * frescura. Con half-life corto domina lo reciente; con
// uno largo domina la popularidad.
export function hotScoreSql(halfLifeDays: number): string {
  return `((1 + ${VOTES_SCORE_SQL}) * ${decaySql(halfLifeDays)})`;
}

// Expresión de orden según el modo pedido. halfLifeDays solo aplica a HOT.
export function sortScoreSql(sort: PostSort, halfLifeDays: number): string {
  switch (sort) {
    case PostSort.NEW:
      return 'EXTRACT(EPOCH FROM post.posted_at)';
    case PostSort.TOP:
      return NET_VOTES_SQL;
    case PostSort.HOT:
    default:
      return hotScoreSql(halfLifeDays);
  }
}

// Intereses que coinciden con los tags del post (parámetro :userTagIds).
export const AFFINITY_SQL = `(SELECT COUNT(DISTINCT affinity_tag.tag_id) FROM post_tag affinity_tag WHERE affinity_tag.post_id = post.id AND affinity_tag.tag_id = ANY(CAST(:userTagIds AS int[])))`;

// Variación determinista por usuario y hora: el feed cambia cada hora pero se
// mantiene estable mientras se pagina (parámetro :jitterSeed).
export const JITTER_SQL = `((ABS(HASHTEXT(CAST(post.id AS text) || :jitterSeed)) % 1000) / 1000.0)`;

export function jitterSeed(userId: string | undefined): string {
  return `${userId ?? 'anon'}:${Math.floor(Date.now() / 3_600_000)}`;
}

// Pesos de Explore ("para ti"): afinidad + popularidad, con descubrimiento.
export const EXPLORE = {
  HALF_LIFE_DAYS: 7,
  AFFINITY_WEIGHT: 2.0,
  VOTES_WEIGHT: 1.5,
  BASE: 1.0,
  // Bonus a posts de comunidades a las que el usuario todavía no pertenece
  // (parámetro :joinedIds): Explore sirve para conocer comunidades nuevas.
  NOT_JOINED_BONUS: 0.8,
  JITTER_WEIGHT: 0.4,
} as const;

export function exploreScoreSql(): string {
  return `(
    (${EXPLORE.AFFINITY_WEIGHT} * ${AFFINITY_SQL}
      + ${EXPLORE.VOTES_WEIGHT} * ${VOTES_SCORE_SQL}
      + ${EXPLORE.BASE}) * ${decaySql(EXPLORE.HALF_LIFE_DAYS)}
    + (CASE WHEN community.id = ANY(CAST(:joinedIds AS int[])) THEN 0 ELSE ${EXPLORE.NOT_JOINED_BONUS} END)
    + ${EXPLORE.JITTER_WEIGHT} * ${JITTER_SQL}
  )`;
}

// Home: frescura muy marcada, con los votos como empuje.
export const HOME = {
  HALF_LIFE_DAYS: 1.5,
} as const;

// Feeds por comunidad y feed global.
export const FEED = {
  HALF_LIFE_DAYS: 3,
} as const;
