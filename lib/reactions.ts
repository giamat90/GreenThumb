export const REACTIONS = {
  sprouting:   { emoji: "🌱", labelKey: "community.reaction_sprouting" },
  blooming:    { emoji: "🌸", labelKey: "community.reaction_blooming" },
  hydrated:    { emoji: "💧", labelKey: "community.reaction_hydrated" },
  green_thumb: { emoji: "🏆", labelKey: "community.reaction_green_thumb" },
} as const;

export type ReactionType = keyof typeof REACTIONS;
export const REACTION_ORDER: ReactionType[] = ["sprouting", "blooming", "hydrated", "green_thumb"];
export const DEFAULT_REACTION: ReactionType = "sprouting";

export type ReactionCounts = Record<ReactionType, number>;

export const EMPTY_COUNTS: ReactionCounts = {
  sprouting: 0,
  blooming: 0,
  hydrated: 0,
  green_thumb: 0,
};
