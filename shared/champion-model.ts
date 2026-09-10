export const CHAMPION_MODEL_STANDARD_TYPES = ['ASIA', 'INTERNATIONAL', 'GOLD'] as const;

export type ChampionModelStandardType = (typeof CHAMPION_MODEL_STANDARD_TYPES)[number];

export const CHAMPION_MODEL_STANDARD_LABELS: Record<ChampionModelStandardType, string> = {
  ASIA: '亚洲标准',
  INTERNATIONAL: '国际标准',
  GOLD: '金牌标准'
};

export function isChampionModelStandardType(value: unknown): value is ChampionModelStandardType {
  return typeof value === 'string' && (CHAMPION_MODEL_STANDARD_TYPES as readonly string[]).includes(value);
}
