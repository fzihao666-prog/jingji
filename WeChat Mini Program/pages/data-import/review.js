const PAGE_SIZE = 8;

function isActive(item) {
  return item.resolution !== 'skip' && item.quality !== 'skipped' && !item.payload.valueAutoMerged;
}

function importPersonKey(item) {
  return typeof item.payload.personKey === 'string' ? item.payload.personKey :
    (item.rawAthleteName || '').trim().normalize('NFKC').replace(/⾬/g, '雨').replace(/[\s·•]/g, '');
}

function activePersonKeys(items) {
  return new Set(items.filter((item) => isActive(item) &&
    item.itemType !== 'invalid_row' && item.itemType !== 'scoring_rule').map(importPersonKey));
}

function reviewPeople(batch) {
  const active = activePersonKeys(batch.items);
  return batch.athleteCandidates.flatMap((person) => {
    if (person.excluded || !active.has(person.normalizedName)) return [];
    const pending = person.status === 'pending' && !person.confirmed && !person.matchedAthleteId;
    const candidates = person.suggested.filter((entry) => !person.team || entry.team === person.team);
    const identityProblem = person.messages.some((message) =>
      /系统运动员编号|档案已停用/.test(message)
    );
    const needsTeam = pending && !person.team;
    const needsMatch = pending && !needsTeam && (identityProblem || candidates.length > 0);
    return [{
      id: person.id, name: person.name, team: person.team, needsTeam, needsMatch,
      isNew: person.status === 'pending' && !needsTeam && !needsMatch && !person.matchedAthleteId,
      needsConfirmation: person.status === 'pending' && !person.confirmed,
      candidates: candidates.map((entry) => ({
        id: entry.id, label: `${entry.name} · ${entry.team} · 编号 ${entry.id}`
      })),
      message: needsTeam || needsMatch ? (person.messages[0] || '') : ''
    }];
  });
}

function reviewIssues(batch) {
  return batch.items.filter((item) => isActive(item) &&
    (item.quality === 'error' || item.itemType === 'invalid_row'));
}

function sourceFields(item) {
  const row = item.payload.sourceRow;
  if (!row || item.payload.sourceRowOutdated || item.payload.valueReviewDecision ||
    item.payload.valueMergedInto || item.payload.valueReviewMemberOf) return [];
  return (row.columns || []).map(([name, column]) => ({
    name, value: String(row.values[column] ?? ''),
    date: /^(?:测量|测试|发生|评估|训练|出生|复查)?日期/.test(name)
  }));
}

function issuePreview(item) {
  return {
    id: item.id, source: `${item.sourceSheet} · ${item.sourceAddress}`,
    title: [item.athleteName || item.rawAthleteName, item.metricLabel || item.exerciseName || item.sessionLabel, item.eventDate]
      .filter(Boolean).join(' · ') || '原始记录',
    value: item.valueNum == null ? '' : `${item.valueNum} ${item.unit || ''}`.trim(),
    messages: item.messages.filter((message) => !message.includes('原日期缺失，已使用')),
    canEdit: sourceFields(item).length > 0 || (item.payload.sessionChoices || []).length > 0
  };
}

module.exports = { PAGE_SIZE, reviewPeople, reviewIssues, issuePreview, sourceFields };
