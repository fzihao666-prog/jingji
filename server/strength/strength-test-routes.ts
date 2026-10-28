import { strengthReadScope } from './strength-read-scope.ts';
import { findTestSession, saveTestSession } from '../core/test-session-store.ts';
import { z } from 'zod';
import type { Express } from 'express';
import { db } from '../core/db.ts';
import { accessibleAthleteIds, hasAthleteAccess } from '../core/permissions.ts';
import { cleanString, isValidIsoDate } from '../core/utils.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { STRENGTH_METRICS, type StrengthMetricValues } from '../../shared/strength-model.ts';
import { strengthMetricCode, strengthMetricKeyByCode } from './strength-metrics.ts';
import {
  adviceTestById,
  buildAiAdvice,
  latestAdvice,
  normalizeAdviceContent,
  parseStrengthValues,
} from './strength-advice.ts';

export function registerStrengthTestRoutes(app: Express) {
  app.get('/api/strength-tests', requireAuth, (req, res) => {
    const user = req.authUser!;
    const scope = strengthReadScope(req.query, user.athleteId || 0);
    if (!scope) return res.status(400).json({ message: '运动员或日期范围无效。' });
    const allowedIds = new Set(accessibleAthleteIds(user));
    if (scope.ids.some(id => !allowedIds.has(id)))
      return res.status(403).json({ message: '无权查看所选运动员的力量测试档案。' });
    const sessions = db
      .prepare(
        `SELECT id, athlete_id AS athleteId, test_date AS testDate, protocol, protocol_version AS protocolVersion, context_key AS contextKey, attempt_order AS attemptOrder, created_at AS updatedAt FROM test_sessions WHERE athlete_id IN (${scope.ids.map(() => '?').join(',')}) ${scope.from ? 'AND test_date BETWEEN ? AND ?' : ''} AND test_type = '力量素质测试' AND (project_code IS NULL OR project_code=(SELECT project FROM athletes WHERE athletes.id=test_sessions.athlete_id)) ORDER BY test_date DESC, id DESC`
      )
      .all(...scope.ids, ...(scope.from ? [scope.from, scope.to!] : [])) as Array<{
      id: number;
      athleteId: number;
      testDate: string;
      protocol: string;
      updatedAt: string;
    }>;
    const measurements = sessions.length ? db.prepare(
      `SELECT tm.test_session_id AS sessionId, tm.metric_code AS metricCode, tm.value_num AS valueNum, tm.target_value AS targetValue
       FROM test_measurements tm JOIN test_sessions ts ON ts.id=tm.test_session_id
       WHERE ts.athlete_id IN (${scope.ids.map(() => '?').join(',')})
       ${scope.from ? 'AND ts.test_date BETWEEN ? AND ?' : ''} AND ts.test_type='力量素质测试'
       AND (ts.project_code IS NULL OR ts.project_code=(SELECT project FROM athletes WHERE athletes.id=ts.athlete_id))`
    ).all(...scope.ids, ...(scope.from ? [scope.from, scope.to!] : [])) as Array<{
      sessionId: number; metricCode: string; valueNum: number; targetValue: number | null;
    }> : [];
    const bySession = new Map<number, typeof measurements>();
    for (const measurement of measurements) {
      const rows = bySession.get(measurement.sessionId) ?? [];
      rows.push(measurement);
      bySession.set(measurement.sessionId, rows);
    }
    res.json({
      tests: sessions.map((session) => {
        const metrics: StrengthMetricValues = {};
        const targets: StrengthMetricValues = {};
        for (const measurement of bySession.get(session.id) ?? []) {
          const key = strengthMetricKeyByCode.get(measurement.metricCode);
          if (!key) continue;
          metrics[key] = Number(measurement.valueNum);
          if (measurement.targetValue !== null) targets[key] = Number(measurement.targetValue);
        }
        return { ...session, notes: session.protocol, updatedBy: '', metrics, targets };
      }),
    });
  });

  app.post(
    '/api/strength-tests',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const user = req.authUser!;
      const athleteId = Number(req.body?.athleteId || 0);
      const testDate = cleanString(req.body?.testDate);
      const notes = cleanString(req.body?.notes);
      if (!athleteId || !hasAthleteAccess(user, athleteId)) {
        return res.status(403).json({ message: '无权维护该运动员的力量测试档案。' });
      }
      if (!isValidIsoDate(testDate)) {
        return res.status(400).json({ message: '请选择有效的测试日期。' });
      }
      if (notes.length > 500) return res.status(400).json({ message: '备注不能超过500个字符。' });
      const context = z.object({
        protocol: z.string().trim().max(500).optional(),
        protocolVersion: z.string().trim().max(100).optional(),
        contextKey: z.string().trim().max(500).optional(),
        attemptOrder: z.number().int().min(1).max(10000).optional(),
      }).safeParse(req.body);
      if (!context.success) return res.status(400).json({ message: '测试协议、版本、条件或试次格式无效。' });
      const metricsResult = parseStrengthValues(req.body?.metrics);
      const targetsResult = parseStrengthValues(req.body?.targets, true);
      const errors = [...metricsResult.errors, ...targetsResult.errors];
      if (!Object.keys(metricsResult.values).length) errors.push('至少填写一项实测数据');
      if (errors.length) return res.status(400).json({ message: [...new Set(errors)].join('；') });

      const identity = { athleteId, date: testDate, type: '力量素质测试', protocol: context.data.protocol ?? notes,
        protocolVersion: context.data.protocolVersion, context: context.data.contextKey, attempt: context.data.attemptOrder };
      db.exec('BEGIN IMMEDIATE');
      try {
      const existing = findTestSession(db, identity);
      const saved = saveTestSession(db, { ...identity, source: 'manual', createdBy: user.id });
      const definition = db.prepare(
        `INSERT INTO metric_definitions (code, label, domain, unit, direction, frequency, minimum, maximum) VALUES (?, ?, 'strength', ?, 'higher_better', 'phase', ?, ?) ON CONFLICT(code) DO NOTHING`
      );
      const measurement = db.prepare(
        `INSERT INTO test_measurements (test_session_id, metric_code, value_num, target_value, unit, side, quality, source, is_demo) VALUES (?, ?, ?, ?, ?, 'center', 'valid', 'manual', 0) ON CONFLICT(test_session_id, metric_code, side) DO UPDATE SET value_num = excluded.value_num, target_value = excluded.target_value, unit = excluded.unit, source = 'manual', quality = 'valid'`
      );
      for (const metric of STRENGTH_METRICS) {
        const value = metricsResult.values[metric.key];
        if (value === undefined) continue;
        const code = strengthMetricCode(metric.key);
        definition.run(code, metric.label, metric.unit, metric.min, metric.max);
        measurement.run(
          saved.id,
          code,
          value,
          targetsResult.values[metric.key] ?? null,
          metric.unit
        );
      }
      db.prepare(
        `
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail)
      VALUES (?, ?, 'test_session', ?, ?)
    `
      ).run(
        user.id,
        existing ? 'UPDATE_STRENGTH_TEST' : 'CREATE_STRENGTH_TEST',
        saved.id,
        JSON.stringify({ athleteId, testDate })
      );
      db.exec('COMMIT');
      res.json({
        message: existing ? '力量测试档案已更新。' : '力量测试档案已保存。',
        id: saved.id,
      });
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    }
  );

  app.get('/api/strength-tests/:id/advice', requireAuth, (req, res) => {
    const user = req.authUser!;
    const strengthTestId = Number(req.params.id || 0);
    const test = adviceTestById(strengthTestId);
    if (!test) return res.status(404).json({ message: '力量测试不存在。' });
    if (!hasAthleteAccess(user, test.athleteId)) {
      return res.status(403).json({ message: '无权查看该运动员的训练建议。' });
    }
    res.json({ advice: latestAdvice(strengthTestId, user.role === 'ATL') });
  });

  app.post(
    '/api/strength-tests/:id/advice/generate',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    async (req, res, next) => {
      try {
        const user = req.authUser!;
        const strengthTestId = Number(req.params.id || 0);
        const test = adviceTestById(strengthTestId);
        if (!test) return res.status(404).json({ message: '力量测试不存在。' });
        if (!hasAthleteAccess(user, test.athleteId)) {
          return res.status(403).json({ message: '无权为该运动员生成训练建议。' });
        }
        const generated = await buildAiAdvice(test);
        const nextVersion = Number(
          (
            db
              .prepare(
                `
          SELECT COALESCE(MAX(version), 0) + 1 AS version
          FROM strength_ai_advice WHERE test_session_id = ?
        `
              )
              .get(strengthTestId) as { version: number }
          ).version
        );
        const result = db
          .prepare(
            `
          INSERT INTO strength_ai_advice
            (test_session_id, version, content_json, source, model, status, generated_by)
          VALUES (?, ?, ?, ?, ?, 'draft', ?)
        `
          )
          .run(
            strengthTestId,
            nextVersion,
            JSON.stringify(generated.content),
            generated.source,
            generated.model,
            user.id
          );
        const adviceId = Number(result.lastInsertRowid);
        db.prepare(
          `
          INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail)
          VALUES (?, 'GENERATE_STRENGTH_ADVICE', 'strength_ai_advice', ?, ?)
        `
        ).run(
          user.id,
          adviceId,
          JSON.stringify({
            strengthTestId,
            version: nextVersion,
            source: generated.source,
            model: generated.model,
          })
        );
        res.json({
          message:
            generated.source === 'ai'
              ? 'AI训练建议草案已生成。'
              : 'fallbackReason' in generated
                ? 'AI服务暂时不可用，已自动生成规则兜底草案。'
                : '尚未配置AI API，已根据现有规则生成训练建议草案。',
          advice: latestAdvice(strengthTestId),
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.put(
    '/api/strength-tests/:id/advice/:adviceId',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const user = req.authUser!;
      const strengthTestId = Number(req.params.id || 0);
      const adviceId = Number(req.params.adviceId || 0);
      const test = adviceTestById(strengthTestId);
      if (!test) return res.status(404).json({ message: '力量测试不存在。' });
      if (!hasAthleteAccess(user, test.athleteId)) {
        return res.status(403).json({ message: '无权编辑该运动员的训练建议。' });
      }
      const exists = db
        .prepare(
          `
        SELECT id FROM strength_ai_advice WHERE id = ? AND test_session_id = ?
      `
        )
        .get(adviceId, strengthTestId);
      if (!exists) return res.status(404).json({ message: '训练建议不存在。' });
      const content = normalizeAdviceContent(req.body?.content);
      db.prepare(
        `
        UPDATE strength_ai_advice
        SET content_json = ?, status = 'draft', reviewed_by = NULL, reviewed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND test_session_id = ?
      `
      ).run(JSON.stringify(content), adviceId, strengthTestId);
      db.prepare(
        `
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail)
        VALUES (?, 'UPDATE_STRENGTH_ADVICE', 'strength_ai_advice', ?, ?)
      `
      ).run(user.id, adviceId, JSON.stringify({ strengthTestId }));
      res.json({
        message: '训练建议草案已保存，需重新确认。',
        advice: latestAdvice(strengthTestId),
      });
    }
  );

  app.post(
    '/api/strength-tests/:id/advice/:adviceId/approve',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const user = req.authUser!;
      const strengthTestId = Number(req.params.id || 0);
      const adviceId = Number(req.params.adviceId || 0);
      const test = adviceTestById(strengthTestId);
      if (!test) return res.status(404).json({ message: '力量测试不存在。' });
      if (!hasAthleteAccess(user, test.athleteId)) {
        return res.status(403).json({ message: '无权确认该运动员的训练建议。' });
      }
      const result = db
        .prepare(
          `
        UPDATE strength_ai_advice
        SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND test_session_id = ?
      `
        )
        .run(user.id, adviceId, strengthTestId);
      if (!result.changes) return res.status(404).json({ message: '训练建议不存在。' });
      db.prepare(
        `
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail)
        VALUES (?, 'APPROVE_STRENGTH_ADVICE', 'strength_ai_advice', ?, ?)
      `
      ).run(user.id, adviceId, JSON.stringify({ strengthTestId }));
      res.json({
        message: '训练建议已由教练确认，运动员现在可以查看和下载。',
        advice: latestAdvice(strengthTestId),
      });
    }
  );
}
