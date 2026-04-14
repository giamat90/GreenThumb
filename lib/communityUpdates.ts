/**
 * Lightweight singleton for propagating post-count changes from the post
 * detail screen back to the community feed without a network round-trip.
 * Keys: post ID. Values: new comments_count after the user's action.
 */
export const commentCountUpdates = new Map<string, number>();
