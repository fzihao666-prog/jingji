import * as XLSX from '@e965/xlsx';
import { readFileSync } from 'node:fs';

const files = [
  'E:/Code_Project/sport/文档/data/国家赛艇队力量素质测试数据对比表.2026.2.13-2025.12.17（20260215）(1).xlsx',
  'E:/Code_Project/sport/文档/data/国家赛艇队力量素质测试数据对比表.2026.2.13-2025.12.17（20260215）.xlsx',
  'E:/Code_Project/sport/文档/data/国家赛艇队力量素质测试数据对比表.2026.2.13-2025.12.17（20260215两次测试数据对比）.xlsx',
  'E:/Code_Project/sport/文档/data/国家赛艇队力量素质测试数据统计表.xlsx',
  'E:/Code_Project/sport/文档/data/国家赛艇队力量素质测试数据统计表20260214.xlsx'
];

for (const file of files) {
  const wb = XLSX.read(readFileSync(file), { type: 'buffer', cellDates: true });
  console.log(`\nFILE: ${file.split('/').at(-1)} | sheets=${wb.SheetNames.join(', ')}`);
  for (const name of wb.SheetNames.slice(0, 12)) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    console.log(`SHEET: ${name} | rows=${rows.length}`);
    console.log(JSON.stringify(rows.slice(0, 6).map((row) => row.slice(0, 25))));
  }
}
