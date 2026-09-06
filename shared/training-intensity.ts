/**
 * 训练强度体系的唯一字典。不同体系只共享同名区间，不代表可相互换算。
 */
export const INTENSITY_ZONE_SYSTEMS = [
  {
    code: 'U_SYSTEM', label: 'U3/U2/U1/AT/TPT/AN/ATP',
    zones: ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP']
  },
  {
    code: 'UT_SYSTEM', label: 'UT2/UT1/TR/AT/AN/REC',
    zones: ['UT2', 'UT1', 'TR', 'AT', 'AN', 'REC']
  }
] as const;

export const PRIMARY_INTENSITY_ZONE_CODES = INTENSITY_ZONE_SYSTEMS[0].zones;

export function intensityZoneSystem(zone: string) {
  return INTENSITY_ZONE_SYSTEMS.find((system) => system.zones.includes(zone as never))?.code || '';
}
