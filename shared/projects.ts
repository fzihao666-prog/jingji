export type ProjectCapability = 'rowing' | 'canoe' | 'slalom' | null;

type ProjectDefinition = { code: string; nameZh: string; nameEn: string; sort: number; capability: ProjectCapability; color: string; accent: string };

const catalog: readonly ProjectDefinition[] = [
  ['SWIMMING', '游泳', 'Swimming'], ['MARATHON_SWIMMING', '马拉松游泳', 'Marathon Swimming'], ['ARTISTIC_SWIMMING', '花样游泳', 'Artistic Swimming'], ['DIVING', '跳水', 'Diving'], ['WATER_POLO', '水球', 'Water Polo'],
  ['ARCHERY', '射箭', 'Archery'], ['ATHLETICS', '田径', 'Athletics'], ['BADMINTON', '羽毛球', 'Badminton'], ['BASEBALL', '棒球', 'Baseball'], ['SOFTBALL', '垒球', 'Softball'],
  ['BASKETBALL', '篮球', 'Basketball'], ['BASKETBALL_3X3', '三人篮球', '3×3 Basketball'], ['BOXING', '拳击', 'Boxing'], ['CANOE_SLALOM', '激流', 'Canoe Slalom'], ['CANOE_SPRINT', '皮划艇', 'Canoe Sprint'],
  ['CYCLING_ROAD', '公路自行车', 'Cycling Road'], ['CYCLING_TRACK', '场地自行车', 'Cycling Track'], ['CYCLING_MOUNTAIN_BIKE', '山地自行车', 'Cycling Mountain Bike'], ['BMX_RACING', '小轮车竞速', 'BMX Racing'], ['BMX_FREESTYLE', '小轮车自由式', 'BMX Freestyle'],
  ['EQUESTRIAN_DRESSAGE', '马术盛装舞步', 'Equestrian Dressage'], ['EQUESTRIAN_EVENTING', '马术三项赛', 'Equestrian Eventing'], ['EQUESTRIAN_JUMPING', '马术场地障碍', 'Equestrian Jumping'], ['FENCING', '击剑', 'Fencing'], ['FOOTBALL', '足球', 'Football'],
  ['GOLF', '高尔夫', 'Golf'], ['ARTISTIC_GYMNASTICS', '竞技体操', 'Artistic Gymnastics'], ['RHYTHMIC_GYMNASTICS', '艺术体操', 'Rhythmic Gymnastics'], ['TRAMPOLINE', '蹦床', 'Trampoline'], ['HANDBALL', '手球', 'Handball'],
  ['HOCKEY', '曲棍球', 'Hockey'], ['JUDO', '柔道', 'Judo'], ['KARATE_KATA', '空手道“型”', 'Karate Kata'], ['KARATE_KUMITE', '空手道“组手”', 'Karate Kumite'], ['MODERN_PENTATHLON', '现代五项', 'Modern Pentathlon'],
  ['ROWING', '赛艇', 'Rowing'], ['RUGBY_SEVENS', '七人制橄榄球', 'Rugby Sevens'], ['SAILING', '帆船', 'Sailing'], ['SHOOTING', '射击', 'Shooting'], ['SKATEBOARDING', '滑板', 'Skateboarding'],
  ['SPORT_CLIMBING', '运动攀岩', 'Sport Climbing'], ['SURFING', '冲浪', 'Surfing'], ['TABLE_TENNIS', '乒乓球', 'Table Tennis'], ['TAEKWONDO', '跆拳道', 'Taekwondo'], ['TENNIS', '网球', 'Tennis'],
  ['TRIATHLON', '铁人三项', 'Triathlon'], ['VOLLEYBALL', '排球', 'Volleyball'], ['BEACH_VOLLEYBALL', '沙滩排球', 'Beach Volleyball'], ['WEIGHTLIFTING', '举重', 'Weightlifting'], ['WRESTLING', '摔跤', 'Wrestling']
].map(([code, nameZh, nameEn], index) => ({
  code, nameZh, nameEn, sort: index + 1,
  capability: code === 'ROWING' ? 'rowing' : code === 'CANOE_SPRINT' ? 'canoe' : code === 'CANOE_SLALOM' ? 'slalom' : null,
  color: ['#4e9cb1', '#5f87c9', '#7c76bd', '#a277b8', '#bf7595'][index % 5], accent: ['#176e84', '#2f5fa3', '#5d4e9e', '#7f4d8b', '#9a405e'][index % 5]
}));

export const PROJECT_DEFINITIONS = catalog;
export type Project = (typeof PROJECT_DEFINITIONS)[number]['code'];
export const PROJECTS = PROJECT_DEFINITIONS.map((item) => item.code) as Project[];
export const DEFAULT_PROJECT: Project = 'ROWING';
export const PROJECT_BY_CODE = Object.fromEntries(PROJECT_DEFINITIONS.map((item) => [item.code, item])) as Record<Project, ProjectDefinition>;
const legacyProjectCodes: Record<string, Project> = { '赛艇': 'ROWING', '皮划艇': 'CANOE_SPRINT', '激流': 'CANOE_SLALOM' };

export function isProject(value: unknown): boolean { return typeof value === 'string' && value in PROJECT_BY_CODE; }
export function normalizeProject(value: unknown): Project | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (isProject(candidate)) return candidate;
  const legacy = legacyProjectCodes[candidate];
  if (legacy) return legacy;
  const normalized = candidate.toLocaleLowerCase();
  return PROJECT_DEFINITIONS.find((item) => item.nameZh === candidate || item.nameEn.toLocaleLowerCase() === normalized)?.code || null;
}
export function projectDefinition(project: Project | string) { return isProject(project) ? PROJECT_BY_CODE[project] : null; }
export function projectLabel(project: Project | string): string { return projectDefinition(project)?.nameZh || String(project || '未设置'); }
export function projectEnglish(project: Project | string): string { return projectDefinition(project)?.nameEn || ''; }
export function projectCapability(project: Project | string): ProjectCapability { return projectDefinition(project)?.capability || null; }
export function hasSpecialAnalysis(project: Project | string): boolean { return projectCapability(project) !== null; }
export const PROJECT_META: Record<Project, { english: string; report: string; code: string; key: string; color: string; accent: string }> = Object.fromEntries(PROJECT_DEFINITIONS.map((item) => [item.code, { english: item.nameEn, report: `${item.nameEn.toUpperCase()} PERFORMANCE REPORT`, code: item.code, key: item.code.toLowerCase(), color: item.color, accent: item.accent }])) as Record<Project, { english: string; report: string; code: string; key: string; color: string; accent: string }>;
export function projectKey(project: Project | string): string { return isProject(project) ? PROJECT_META[project].key : 'unknown'; }
export function projectColor(project: Project | string): string { return isProject(project) ? PROJECT_META[project].color : '#9aa8ab'; }
export function projectAccent(project: Project | string): string { return isProject(project) ? PROJECT_META[project].accent : '#74888f'; }
