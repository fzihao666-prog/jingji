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
