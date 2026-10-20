import { Injectable } from '@nestjs/common';

/**
 * Presencia en memoria: userId → sockets abiertos (una entrada por pestaña).
 * Un usuario está online mientras tenga al menos un socket. Vive en el
 * proceso: con varias instancias del backend cada una vería solo a sus
 * propios sockets (ver docs/GUIA_CHAT.md, sección 4.4).
 */
@Injectable()
export class ChatPresence {
  private readonly socketsByUser = new Map<string, Set<string>>();

  // true si es el primer socket del usuario (pasa a online).
  connect(userId: string, socketId: string): boolean {
    const sockets = this.socketsByUser.get(userId);
    if (sockets) {
      sockets.add(socketId);
      return false;
    }
    this.socketsByUser.set(userId, new Set([socketId]));
    return true;
  }

  // true si era su último socket (pasa a offline).
  disconnect(userId: string, socketId: string): boolean {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets?.delete(socketId)) return false;
    if (sockets.size > 0) return false;
    this.socketsByUser.delete(userId);
    return true;
  }

  isOnline(userId: string): boolean {
    return this.socketsByUser.has(userId);
  }
}
