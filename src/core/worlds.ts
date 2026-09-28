/** Campaign order, shared by content generation and the world map. */
export const WORLD_IDS = [
  'meadow', 'forest', 'sea', 'sweets', 'space', 'winter', 'fantasy',
  'harvest', 'safari', 'harbor', 'market', 'workshop', 'sky', 'festival',
] as const;

export type WorldId = typeof WORLD_IDS[number];
export const CAMPAIGN_LEVELS = WORLD_IDS.length * 20;
