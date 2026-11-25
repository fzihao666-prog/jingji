import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { normalizeImportPersonName } from '../../shared/data-import-person.ts';
import type { EnodePreview } from '../../shared/enode.ts';
import { validatePersonName } from '../core/utils.ts';
import { importEnodeFile, parseEnodeFile } from './enode.ts';

export const enodeDecisions = z.record(
  z.string(),
  z.discriminatedUnion('action', [
    z.object({ action: z.literal('link'), athleteId: z.number().int().positive() }),
    z.object({ action: z.literal('create'), team: z.string().min(1) }),
    z.object({ action: z.literal('skip') }),
  ])
);
export class EnodeDecisionError extends Error {}

type Candidate = EnodePreview['people'][number]['candidates'][number];
export function previewEnodePeople(
  files: Express.Multer.File[],
  candidates: Candidate[],
  teams: Set<string>
) {
  const people = new Map<string, EnodePreview['people'][number]>();
  const parsedFiles = files.map((file) => {
    try {
      return { file, parsed: parseEnodeFile(file.buffer) };
    } catch {
      return { file, error: '无法识别此文件，请检查 Enode CSV 格式。' };
    }
  });
  const candidatesByName = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = normalizeImportPersonName(candidate.name);
    const list = candidatesByName.get(key) ?? [];
    list.push(candidate);
    candidatesByName.set(key, list);
  }
  for (const { parsed } of parsedFiles) {
    if (!parsed) continue;
    for (const row of parsed.rows) {
      if (row.error) continue;
      const key = normalizeImportPersonName(row.name);
      const person = people.get(key) ?? {
        key,
        name: row.name,
        counts: {},
        candidates: candidatesByName.get(key) ?? [],
      };
      person.counts[parsed.kind] = (person.counts[parsed.kind] ?? 0) + 1;
      people.set(key, person);
    }
  }
  const preview: EnodePreview = {
    people: [...people.values()],
    teams: [...teams],
    files: parsedFiles.map(({ file, error }) => ({ filename: file.originalname, error })),
  };
  return { preview, parsedFiles };
}

export function commitEnodePeople(
  db: DatabaseSync,
  input: {
    batch: ReturnType<typeof previewEnodePeople>;
    choices: z.infer<typeof enodeDecisions>;
    project: string;
    userId: number;
    teams: Set<string>;
    area: { region: string; city: string; county: string };
  }
) {
  const { batch, choices, project, userId, teams, area } = input;
  const decisions = new Map<string, number | null>();
  const summary = { linked: 0, created: 0, skipped: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    const allNames = db.prepare('SELECT name FROM athletes WHERE project=?').all(project);
    const existingNames = new Set(
      allNames.map((row) => normalizeImportPersonName(String(row.name)))
    );
    for (const person of batch.preview.people) {
      const choice = Object.hasOwn(choices, person.key) ? choices[person.key] : undefined;
      if (choice?.action === 'skip') {
        decisions.set(person.key, null);
        summary.skipped++;
      } else if (
        choice?.action === 'link' &&
        person.candidates.some((candidate) => candidate.id === choice.athleteId)
      ) {
        decisions.set(person.key, choice.athleteId);
        summary.linked++;
      } else if (
        choice?.action === 'create' &&
        teams.has(choice.team) &&
        !existingNames.has(person.key)
      ) {
        const { name, error } = validatePersonName(person.name);
        if (error) throw new EnodeDecisionError(error);
        const team = db
          .prepare('SELECT id FROM project_teams WHERE project=? AND name=? AND active=1')
          .get(project, choice.team);
        if (!team) throw new EnodeDecisionError('所选队伍已不可用，请重新选择文件。');
        const id = Number(
          db
            .prepare(
              `INSERT INTO athletes(name,project,team,team_id,region,city,county,profile_status,source)
          VALUES(?,?,?,?,?,?,?,'incomplete','file_import')`
            )
            .run(name, project, choice.team, Number(team.id), area.region, area.city, area.county)
            .lastInsertRowid
        );
        db.prepare(
          `INSERT INTO athlete_origins(athlete_id,province,city,county,source,quality,is_demo)
          VALUES(?,?,?,?,'file_import','valid',0)`
        ).run(id, area.region, area.city, area.county);
        db.prepare('INSERT INTO athlete_profiles(athlete_id) VALUES(?)').run(id);
        db.prepare(
          "INSERT INTO audit_logs(user_id,action,entity_type,entity_id) VALUES(?,'CREATE_ATHLETE_FROM_ENODE','athlete',?)"
        ).run(userId, id);
        decisions.set(person.key, id);
        existingNames.add(person.key);
        summary.created++;
      } else {
        throw new EnodeDecisionError(
          `“${person.name}”的关联或建档选择已无效，请重新选择文件或本次跳过。`
        );
      }
    }
    const results = batch.parsedFiles.map(({ file, parsed, error }) =>
      parsed
        ? importEnodeFile(db, {
            buffer: file.buffer,
            filename: file.originalname,
            project,
            userId,
            candidates: [],
            decisions,
            parsed,
          })
        : {
            filename: file.originalname,
            kind: null,
            inserted: 0,
            skipped: 0,
            failed: 1,
            unresolvedNames: [],
            issues: [{ row: 0, message: error ?? '文件无法读取。' }],
          }
    );
    db.exec('COMMIT');
    return { results, summary };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
