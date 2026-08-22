import provinceData from 'province-city-china/dist/province.json' with { type: 'json' };
import cityData from 'province-city-china/dist/city.json' with { type: 'json' };

export const REGION_GROUPS = [
  { name: '华北', regions: ['北京', '天津', '河北', '山西', '内蒙古'] },
  { name: '东北', regions: ['辽宁', '吉林', '黑龙江'] },
  { name: '华东', regions: ['上海', '江苏', '浙江', '安徽', '福建', '江西', '山东'] },
  { name: '华中', regions: ['河南', '湖北', '湖南'] },
  { name: '华南', regions: ['广东', '广西', '海南'] },
  { name: '西南', regions: ['重庆', '四川', '贵州', '云南', '西藏'] },
  { name: '西北', regions: ['陕西', '甘肃', '青海', '宁夏', '新疆'] },
  { name: '港澳台', regions: ['香港', '澳门', '台湾'] }
] as const;

export const PROVINCES = REGION_GROUPS.flatMap((group) => [...group.regions]);
export type Province = (typeof REGION_GROUPS)[number]['regions'][number];

const provinceCodes = new Map(
  provinceData.map((item) => [PROVINCES.find((province) => item.name.startsWith(province)), item.province])
);

export const PROVINCE_CITIES: Record<string, string[]> = Object.fromEntries(
  PROVINCES.map((province) => {
    const provinceCode = provinceCodes.get(province);
    const cities = cityData.filter((item) => item.province === provinceCode).map((item) => item.name);
    const provinceLevelName = provinceData.find((item) => item.province === provinceCode)?.name;
    return [province, cities.length ? cities : provinceLevelName ? [provinceLevelName] : []];
  })
);
