import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ProjectNameCatalogPanel } from './ProjectNameCatalogPanel';

it('目录只保留训练项目、测试项目和名称映射类别', () => {
  const markup = renderToStaticMarkup(
    createElement(ProjectNameCatalogPanel, { editable: true, revision: 0 })
  );
  expect([...markup.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map((match) => match[1])).toEqual([
    '训练项目',
    '测试项目',
    '名称映射',
  ]);
});
