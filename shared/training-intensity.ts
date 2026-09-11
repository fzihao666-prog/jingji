/**
 * 训练强度体系的唯一字典。不同体系只共享同名区间，不代表可相互换算。
 */
export const INTENSITY_ZONE_SYSTEMS = [
  {
    code: 'U_SYSTEM', label: 'U3/U2/U1/AT/TPT/AN/ATP',
    zones: ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP']
  },
  {
    code: 'UT_SYSTEM', label: 'UT3/UT2/UT1/TR/AT/AN/REC',
    zones: ['UT3', 'UT2', 'UT1', 'TR', 'AT', 'AN', 'REC']
  }
] as const;

export const PRIMARY_INTENSITY_ZONE_CODES = INTENSITY_ZONE_SYSTEMS[0].zones;

// 仅定义专项训练看板的展示顺序，不在不同强度体系间进行换算。
export const SPECIAL_TRAINING_INTENSITY_ZONE_ORDER = ['UT3', 'UT2', 'UT1', 'U3', 'U2', 'U1', 'AT', 'TR', 'TPT', 'AN', 'ATP', 'REC'] as const;
export const SPECIAL_TRAINING_PINNED_INTENSITY_ZONES = ['UT3', 'AN'] as const;

export function intensityZoneSystem(zone: string) {
  return INTENSITY_ZONE_SYSTEMS.find((system) => system.zones.includes(zone as never))?.code || '';
}
