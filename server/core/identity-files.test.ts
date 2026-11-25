import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
const bundledPython = `${process.env.HOME ?? ''}/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`;
const python = process.env.JINGJI_FILE_CLEANUP_PYTHON ?? (existsSync(bundledPython) ? bundledPython : 'python3');
const hasOpenpyxl = spawnSync(python, ['-B', '-c', 'import openpyxl']).status === 0;
if (!hasOpenpyxl) console.warn('未找到 openpyxl：跳过 XLSX 合成测试；未安装新依赖。');
const script = resolve('scripts/remove-identity-files.py');
describe('历史文件身份证清理', () => {
  it('拒绝混合键值日志且源内容不变', () => {
    const dir = mkdtempSync(join(tmpdir(), 'identity-files-'));
    try {
      const file = join(dir, 'mixed.log');
      const source = 'identityNumber: SYNTHETIC, birthDate: 2000-01-01, score: 42';
      writeFileSync(file, source);
      const result = spawnSync(python, ['-B', script, '--file', file, '--apply', '--confirmed', '--backup-dir', join(dir, 'backup')], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('SYNTHETIC');
      expect(readFileSync(file, 'utf8')).toBe(source);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('删除二维JSON身份证列并递归清理剩余单元格', () => {
    const dir = mkdtempSync(join(tmpdir(), 'identity-files-'));
    try {
      const file = join(dir, 'matrix.json');
      writeFileSync(file, JSON.stringify([['身份证号', '结果'], ['SYNTHETIC', { identityNumber: 'SYNTHETIC', score: 3 }]]));
      const result = spawnSync(python, ['-B', script, '--file', file, '--apply', '--confirmed', '--backup-dir', join(dir, 'backup')], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).hits).toBe(2);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([['结果'], [{ score: 3 }]]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.skipIf(!hasOpenpyxl)('删除工作簿列但保留生日性别、样式与其它工作表，拒绝公式并保护原子失败源文件', () => {
    const result = spawnSync(python, ['-B', '-c', `
import importlib.util, tempfile, pathlib, os
from unittest.mock import patch
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
spec=importlib.util.spec_from_file_location('cleanup', ${JSON.stringify(script)})
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as directory:
 p=pathlib.Path(directory)/'sample.xlsx'
 w=Workbook(); s=w.active
 s.append(['姓名','身份证号','生日','性别']); s.append(['合成人','SYNTHETIC','2000-01-01','男'])
 s['C2'].font=Font(bold=True); w.create_sheet('其它')['A1']='保留'
 w.save(p)
 content,hits=m.transform(p); assert hits==1
 m.apply(p,content,pathlib.Path(directory)/'backup')
 clean=load_workbook(p); assert clean.active['B2'].value=='2000-01-01'
 assert clean.active['C2'].value=='男' and clean.active['B2'].font.bold
 assert clean['其它']['A1'].value=='保留'
 original=p.read_bytes()
 with patch.object(m.os,'replace',side_effect=OSError('synthetic')):
  try: m.apply(p,b'broken',pathlib.Path(directory)/'backup2')
  except OSError: pass
 assert p.read_bytes()==original
 w=Workbook(); s=w.active
 from openpyxl.worksheet.datavalidation import DataValidation
 from datetime import datetime
 s.merge_cells('A1:F1'); s['A1']='合成标题'
 s.append(['姓名','身份证号','生日','性别','手机号','成绩'])
 s.append(['合成人','SYNTHETIC',datetime(2000,1,1),'女','001234',42])
 s['C3'].number_format='yyyy-mm-dd'; s['E3'].number_format='@'; s['E3'].font=Font(bold=True)
 s.column_dimensions['E'].width=24
 gender=DataValidation(type='list',formula1='"男,女"'); gender.add('D3:D100'); s.add_data_validation(gender)
 date=DataValidation(type='date',operator='between',formula1='1',formula2='60000'); date.add('C3:C100'); s.add_data_validation(date)
 w.save(p); content,hits=m.transform(p); assert hits==1
 m.apply(p,content,pathlib.Path(directory)/'backup3')
 clean=load_workbook(p); s=clean.active
 assert str(next(iter(s.merged_cells.ranges)))=='A1:E1'
 assert [s.cell(3,i).value for i in range(1,6)]==['合成人',datetime(2000,1,1),'女','001234',42]
 assert s['B3'].number_format=='yyyy-mm-dd' and s['D3'].number_format=='@' and s['D3'].font.bold
 assert s.column_dimensions['D'].width==24
 assert [str(rule.sqref) for rule in s.data_validations.dataValidation]==['C3:C100','B3:B100']
 s['A5']='训练备注：专项训练完成；身份证仅用于旧说明'
 clean.save(p)
 before=p.read_bytes()
 try: m.transform(p); raise AssertionError('mixed note accepted')
 except ValueError: pass
 assert p.read_bytes()==before
 s['A5']='训练备注：专项训练完成'; s['A6']='身份证为18位，末位可为X'; clean.save(p)
 content,hits=m.transform(p)
 from io import BytesIO
 preserved=load_workbook(BytesIO(content))
 assert preserved.active['A5'].value=='训练备注：专项训练完成'
 assert preserved.active['A6'].value=='生日和性别请独立填写'
 clean.active['D2']='=1+1'; clean.save(p)
 try: m.transform(p); raise AssertionError('formula accepted')
 except ValueError: pass
 c=pathlib.Path(directory)/'sample.csv'; c.write_text('姓名,身份证号,生日,性别\\n合成人,SYNTHETIC,2000-01-01,男\\n')
 output,hits=m.transform(c); assert hits==1 and b'SYNTHETIC' not in output and '生日' in output.decode()
`], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
  it('预览不泄露数据，确认后保留嵌套业务字段并限制备份权限', () => {
    const dir = mkdtempSync(join(tmpdir(), 'identity-files-'));
    try {
      const file = join(dir, 'sample.json');
      writeFileSync(file, JSON.stringify({ nested: { idCard: 'SECRET', birthday: '2000-01-01', gender: '男' } }));
      const preview = spawnSync(python, ['-B', script, '--file', file], { encoding: 'utf8' });
      expect(preview.status).toBe(0);
      expect(preview.stdout).not.toContain('SECRET');
      expect(readFileSync(file, 'utf8')).toContain('SECRET');
      const backup = join(dir, 'backup');
      expect(spawnSync(python, ['-B', script, '--file', file, '--apply', '--confirmed', '--backup-dir', backup]).status).toBe(0);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ nested: { birthday: '2000-01-01', gender: '男' } });
      expect(statSync(backup).mode & 0o777).toBe(0o700);
      expect(statSync(join(backup, 'sample.json')).mode & 0o777).toBe(0o600);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
