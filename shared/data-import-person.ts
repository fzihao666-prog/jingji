/** 暂存人员标识由服务端生成；旧批次仅以规范姓名读取，提交时须重新解析。 */
export function dataImportPersonKey(item: {
  rawAthleteName: string;
  payload: Record<string, unknown>;
}): string {
  return typeof item.payload.personKey === 'string'
    ? item.payload.personKey
    : normalizeImportPersonName(item.rawAthleteName);
}

export function normalizeImportPersonName(value: string): string {
  return value.trim().normalize('NFKC').replaceAll('⾬', '雨').replace(/[\s·•]/g, '');
}

/** 打开导入草稿时，以当前可访问的在册人员重新匹配；不凭过期建议或冲突编号关联。 */
export function automaticImportPersonLinks(
  candidates: readonly {
    id: number; name: string; project: string; team: string; status: string;
    excluded: boolean; matchedAthleteId: number | null;
    suggested: readonly { id: number; name: string }[];
  }[],
  athletes: readonly { id: number; name: string; project: string; team: string }[]
): Map<number, number> {
  const links = new Map<number, number>();
  for (const candidate of candidates) {
    if (candidate.status !== 'pending' || candidate.excluded || candidate.matchedAthleteId) continue;
    const name = normalizeImportPersonName(candidate.name);
    // 同批同名但不同身份不能仅凭姓名重新合并。
    if (candidates.filter(entry => !entry.excluded && entry.project === candidate.project
      && normalizeImportPersonName(entry.name) === name).length > 1) continue;
    const pool = athletes.filter(athlete => athlete.project === candidate.project
      && normalizeImportPersonName(athlete.name) === name);
    const sameTeam = pool.filter(athlete => athlete.team === candidate.team);
    const matches = sameTeam.length ? sameTeam : pool;
    if (matches.length !== 1) continue;
    // 编号指向不同姓名时不能自动忽略编号冲突。
    if (candidate.suggested.some(entry => normalizeImportPersonName(entry.name) !== name)) continue;
    links.set(candidate.id, matches[0].id);
  }
  return links;
}
