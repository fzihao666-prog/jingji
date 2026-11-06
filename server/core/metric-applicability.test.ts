import { DatabaseSync } from 'node:sqlite';
import { expect,it } from 'vitest';
import { initializeDatabase } from './db-initialize.ts';
import { metricAppliesToProject } from '../../shared/import-metric-choice.ts';
it('通用指标对六项目适用，专项指标使用代码，重复初始化不覆盖修订范围',()=>{
 const db=new DatabaseSync(':memory:');
 try {
 const options={databasePath:':memory:',databaseExistedBeforeStartup:true};initializeDatabase(db,options);
 const row=db.prepare("SELECT projects_json AS projects FROM metric_definitions WHERE code='body_fat_pct'").get() as {projects:string};
 for(const project of ['ROWING','CANOE_SPRINT','CANOE_SLALOM','CYCLING_ROAD','CYCLING_TRACK','VOLLEYBALL'])expect(metricAppliesToProject({projects:JSON.parse(row.projects)},project)).toBe(true);
 expect(JSON.parse((db.prepare("SELECT projects_json AS p FROM metric_definitions WHERE code='erg_2k_sec'").get() as {p:string}).p)).toEqual(['ROWING']);
 db.exec(`UPDATE metric_definitions SET projects_json='["VOLLEYBALL"]' WHERE code='body_fat_pct'`);initializeDatabase(db,options);
 expect(db.prepare("SELECT projects_json AS p FROM metric_definitions WHERE code='body_fat_pct'").get()).toEqual({p:'["VOLLEYBALL"]'});
 expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});

it('基础体能模板更新旧默认范围，保留自定义范围和停用状态', () => {
  const db = new DatabaseSync(':memory:');
  const options = { databasePath: ':memory:', databaseExistedBeforeStartup: true };
  try {
    initializeDatabase(db, options);
    db.exec(`
      DELETE FROM app_metadata WHERE key='compact_athlete_common_metric_scope_v1';
      UPDATE metric_definitions SET projects_json='["ROWING","CANOE_SPRINT","CANOE_SLALOM"]'
        WHERE code IN ('bench_press_kg','clean_kg');
      UPDATE metric_definitions SET projects_json='["ROWING"]' WHERE code='bench_pull_kg';
      UPDATE metric_definitions SET active=0 WHERE code='clean_kg';
    `);
    initializeDatabase(db, options);
    const scope = db.prepare('SELECT projects_json AS projects,active FROM metric_definitions WHERE code=?');
    expect(scope.get('bench_press_kg')).toEqual({ projects: '["*"]', active: 1 });
    expect(scope.get('bench_pull_kg')).toEqual({ projects: '["ROWING"]', active: 1 });
    expect(scope.get('clean_kg')).toEqual({ projects: '["ROWING","CANOE_SPRINT","CANOE_SLALOM"]', active: 0 });
    db.exec(`UPDATE metric_definitions SET projects_json='["ROWING","CANOE_SPRINT","CANOE_SLALOM"]'
      WHERE code='bench_press_kg'`);
    initializeDatabase(db, options);
    expect(scope.get('bench_press_kg')).toEqual({ projects: '["ROWING","CANOE_SPRINT","CANOE_SLALOM"]', active: 1 });
  } finally {
    db.close();
  }
});
