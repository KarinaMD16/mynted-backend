// Sala personal de socket.io: todos los sockets (pestañas y dispositivos) de
// un usuario. ChatGateway une cada socket al conectar; cualquier gateway del
// mismo servidor puede emitir a ella (p. ej. NotificationsGateway).
export const userRoom = (userId: string) => `user:${userId}`;
