export const REACTIONS = {
  sprouting:   { emoji: "🌱", labelKey: "community.reaction_sprouting" },
  blooming:    { emoji: "🌸", labelKey: "community.reaction_blooming" },
  hydrated:    { emoji: "💧", labelKey: "community.reaction_hydrated" },
  green_thumb: { emoji: "🏆", labelKey: "community.reaction_green_thumb" },
} as const;

export type ReactionType = keyof typeof REACTIONS;
export const REACTION_ORDER: ReactionType[] = ["sprouting", "blooming", "hydrated", "green_thumb"];
export const DEFAULT_REACTION: ReactionType = "sprouting";

export const BADGE_TIERS = [
  { min: 500, emoji: "🏆", labelKey: "community.badge_green_thumb" },
  { min: 200, emoji: "💧", labelKey: "community.badge_hydrated" },
  { min: 50,  emoji: "🌸", labelKey: "community.badge_plant_parent" },
  { min: 10,  emoji: "🌱", labelKey: "community.badge_seedling" },
] as const;

export type BadgeTier = (typeof BADGE_TIERS)[number];

export function getBadgeTier(kudos: number): BadgeTier | null {
  return BADGE_TIERS.find((t) => kudos >= t.min) ?? null;
}

export type ReactionCounts = Record<ReactionType, number>;

export const EMPTY_COUNTS: ReactionCounts = {
  sprouting: 0,
  blooming: 0,
  hydrated: 0,
  green_thumb: 0,
};
