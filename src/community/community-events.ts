// Solicitudes de unión a comunidades privadas. Se emiten (con EventEmitter2
// opcional) después de guardar.
export const CommunityEvents = {
  JOIN_REQUEST_CREATED: 'community.join_request.created',
  JOIN_REQUEST_RESOLVED: 'community.join_request.resolved',
} as const;

export interface JoinRequestCreatedEvent {
  requestId: number;
  communityId: number;
  // Quien pidió unirse.
  userId: string;
}

export interface JoinRequestResolvedEvent {
  requestId: number;
  communityId: number;
  // Quien pidió unirse (a quien se le avisa).
  userId: string;
  accepted: boolean;
  // Owner o moderador que la resolvió.
  resolvedByUserId: string;
}
