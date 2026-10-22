// CORS compartido por la API HTTP (main.ts) y el gateway de socket.io: la
// sesión viaja en cookies httpOnly, así que ambos necesitan credentials.
export const CORS_OPTIONS = {
  origin: 'http://localhost:5173',
  credentials: true,
};
