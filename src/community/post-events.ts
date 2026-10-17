// Eventos de posts para el stream en vivo (GET /posts/live).
export const PostEvents = {
  METRICS_UPDATED: 'post.metrics.updated',
} as const;

export interface PostMetricsUpdatedEvent {
  postId: number;
  upVotes: number;
  downVotes: number;
  timesSaved: number;
  replyCount: number;
}
