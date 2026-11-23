import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImportSourceRowEditor } from './ImportSourceRowEditor';

type EditorItem = ComponentProps<typeof ImportSourceRowEditor>['item'];

function renderEditor(item: EditorItem) {
  return renderToStaticMarkup(createElement(ImportSourceRowEditor, {
    item, disabled: false, metrics: [], describedBy: 'row-error',
    onChange: () => {}, onSave: () => {},
  }));
}

describe('导入校对的在线修改入口', () => {
  it('按 Excel 单元格定位存在错误的字段，保留原值供修改', () => {
    const html = renderEditor({
      itemType: 'body_measurement',
      sourceSheet: '运动员基础档案',
      messages: ['错误：运动员基础档案!AA10 身体测量日期无效或缺失'],
      payload: {
        sourceRow: {
          columns: [['姓名', 0], ['身体测量日期', 26]],
          values: [...Array<string>(26).fill(''), '2024/02/30'],
        },
      },
    });

    expect(html).toContain('身体测量日期');
    expect(html).toContain('value="2024/02/30"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="row-error"');
    expect(html).toContain('保存并校验');
    expect(html).toContain('修改其他字段');
    expect(html).not.toContain('姓名');
  });

  it('在没有可编辑来源时提示如何处理', () => {
    const html = renderEditor({
      itemType: 'invalid_row',
      sourceSheet: '训练记录',
      messages: ['错误：该行缺少姓名'],
      payload: {},
    });

    expect(html).toContain('请在 Excel 修正后重新上传');
    expect(html).not.toContain('<input');
  });
});
