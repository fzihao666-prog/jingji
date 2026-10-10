import type { AreaLevel } from './access.js';

type Area = { areaLevel: AreaLevel; province: string; city: string; county: string };

export function athleteAccountAreaComplete(areas: readonly Area[]): boolean {
  const area = areas[0];
  return (
    areas.length === 1 &&
    area.areaLevel === 'county' &&
    Boolean(area.province.trim() && area.city.trim() && area.county.trim())
  );
}

export function athleteAccountAreaForEdit(areas: readonly Area[]): Area {
  const area = areas[0];
  return {
    areaLevel: 'county',
    province: area?.areaLevel === 'national' ? '' : area?.province || '',
    city: area?.areaLevel === 'national' ? '' : area?.city || '',
    county: area?.areaLevel === 'county' ? area.county : '',
  };
}
