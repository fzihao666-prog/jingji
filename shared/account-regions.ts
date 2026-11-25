import { z } from 'zod';
import snapshot from './region-data/mca-2025-with-2026-updates.json' with { type: 'json' };
import { PROVINCES, PROVINCE_CITIES } from './regions.js';
import type { AreaLevel } from './access.js';

const entries = z
  .array(
    z.tuple([
      z.string().regex(/^\d{6}$/),
      z.string().min(1),
      z.union([z.literal(1), z.literal(2), z.literal(3)]),
    ])
  )
  .parse(snapshot);
export type AccountRegionOption = { name: string; code: string | null; wholeCity?: boolean };
type Area = { areaLevel: AreaLevel; province: string; city: string; county: string };
const municipalities = new Set(['北京', '天津', '上海', '重庆']);

function provinceCode(province: string) {
  if (!province) return undefined;
  return entries
    .find(
      ([code, name, level]) => level === 1 && name.startsWith(province) && code.endsWith('0000')
    )?.[0]
    .slice(0, 2);
}

export function getAccountCities(province: string): string[] {
  if (!PROVINCES.some((name) => name === province)) return [];
  const prefix = provinceCode(province);
  if (!prefix || ['香港', '澳门', '台湾'].includes(province))
    return PROVINCE_CITIES[province] || [];
  if (municipalities.has(province)) return [entries.find(([code]) => code === `${prefix}0000`)![1]];
  const cities = entries.filter(([code, , level]) => level === 2 && code.startsWith(prefix));
  const result = cities.map(([, name]) => name);
  if (
    entries.some(
      ([code, , level]) =>
        level === 3 &&
        code.startsWith(prefix) &&
        !cities.some(([cityCode]) => cityCode.slice(0, 4) === code.slice(0, 4))
    )
  ) {
    result.push(
      PROVINCE_CITIES[province]?.find((name) => name.includes('直辖县级')) || '省直辖县级行政单位'
    );
  }
  return result;
}

export function getAccountCounties(province: string, city: string): AccountRegionOption[] {
  if (!city || !getAccountCities(province).includes(city)) return [];
  const prefix = provinceCode(province);
  if (!prefix || ['香港', '澳门', '台湾'].includes(province)) return [];
  if (municipalities.has(province))
    return entries
      .filter(([code, , level]) => level === 3 && code.startsWith(prefix))
      .map(([code, name]) => ({ code, name }));
  const cityEntry = entries.find(
    ([code, name, level]) => level === 2 && code.startsWith(prefix) && name === city
  );
  const cityCodes = new Set(
    entries
      .filter(([code, , level]) => level === 2 && code.startsWith(prefix))
      .map(([code]) => code.slice(0, 4))
  );
  const counties = entries.filter(
    ([code, , level]) =>
      level === 3 &&
      code.startsWith(prefix) &&
      (cityEntry ? code.startsWith(cityEntry[0].slice(0, 4)) : !cityCodes.has(code.slice(0, 4)))
  );
  if (!counties.length && cityEntry)
    return [{ code: cityEntry[0], name: cityEntry[1], wholeCity: true }];
  return counties.map(([code, name]) => ({ code, name }));
}

export function validateAccountAreas(areas: Area[], existing: Area[] = []): string {
  for (const area of areas) {
    if (
      existing.some(
        (old) =>
          old.areaLevel === area.areaLevel &&
          old.province === area.province &&
          old.city === area.city &&
          old.county === area.county
      )
    )
      continue;
    if (area.areaLevel === 'national') continue;
    if (!PROVINCES.some((name) => name === area.province)) return '请选择有效省份。';
    if (area.areaLevel === 'province') continue;
    if (!getAccountCities(area.province).includes(area.city))
      return '请从所选省份的下拉框中选择城市。';
    if (
      area.areaLevel === 'county' &&
      !getAccountCounties(area.province, area.city).some((county) => county.name === area.county)
    )
      return '请从所选城市的下拉框中选择区县。';
  }
  return '';
}
