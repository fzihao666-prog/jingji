import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function createStorage() {
  const map = new Map();
  return {
    map,
    getStorageSync(key) { return map.has(key) ? map.get(key) : ''; },
    setStorageSync(key, value) { map.set(key, value); },
    removeStorageSync(key) { map.delete(key); },
  };
}

function load() {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('./form-draft.js', import.meta.url), 'utf8'), {
    module,
    exports: module.exports,
    require() { throw new Error('未预期的依赖'); },
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    JSON,
  });
  return module.exports;
}

const {
  draftKey,
  draftIdentity,
  sameForm,
  isMeaningfulDraft,
  loadFormDraft,
  saveFormDraft,
  clearFormDraft,
} = load();

describe('表单草稿键与身份', () => {
  it('草稿键按表单与身份隔离', () => {
    expect(draftKey('training-entry', 'me')).toBe('jingji-mini-draft:training-entry:me');
    expect(draftKey('training-entry', draftIdentity(true, 7))).toBe('jingji-mini-draft:training-entry:athlete:7');
    expect(draftIdentity(false, 7)).toBe('me');
    expect(draftIdentity(true, 0)).toBe('athlete:0');
  });
});

describe('草稿保存与恢复', () => {
  it('空表单不落草稿，且会清掉既有草稿', () => {
    const storage = createStorage();
    const defaults = { content: '', duration: '' };
    expect(saveFormDraft(storage, 'training-entry', 'me', { content: '', duration: '' }, defaults)).toBe(false);
    expect(storage.map.size).toBe(0);
    storage.setStorageSync(draftKey('training-entry', 'me'), { savedAt: 1, data: { content: '旧草稿', duration: '60' } });
    expect(saveFormDraft(storage, 'training-entry', 'me', { content: '', duration: '' }, defaults)).toBe(false);
    expect(loadFormDraft(storage, 'training-entry', 'me')).toBe(null);
  });

  it('有内容时保存并可读回，忽略字段顺序差异', () => {
    const storage = createStorage();
    const defaults = { content: '', duration: '' };
    const form = { content: '水上', duration: '90' };
    expect(saveFormDraft(storage, 'training-entry', 'me', form, defaults)).toBe(true);
    expect(loadFormDraft(storage, 'training-entry', 'me')).toEqual(form);
    // 字段顺序不同仍视为同一份草稿
    expect(sameForm({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(isMeaningfulDraft({ content: '水上', duration: '' }, defaults)).toBe(true);
  });

  it('身份之间不串稿，清除只影响指定草稿', () => {
    const storage = createStorage();
    const defaults = { content: '' };
    saveFormDraft(storage, 'training-entry', 'me', { content: '本人' }, defaults);
    saveFormDraft(storage, 'training-entry', 'athlete:7', { content: '代填' }, defaults);
    expect(loadFormDraft(storage, 'training-entry', 'me')).toEqual({ content: '本人' });
    expect(loadFormDraft(storage, 'training-entry', 'athlete:7')).toEqual({ content: '代填' });
    clearFormDraft(storage, 'training-entry', 'me');
    expect(loadFormDraft(storage, 'training-entry', 'me')).toBe(null);
    expect(loadFormDraft(storage, 'training-entry', 'athlete:7')).toEqual({ content: '代填' });
  });

  it('存储异常时静默降级，不影响填写流程', () => {
    const broken = {
      getStorageSync() { throw new Error('storage unavailable'); },
      setStorageSync() { throw new Error('storage unavailable'); },
      removeStorageSync() { throw new Error('storage unavailable'); },
    };
    expect(loadFormDraft(broken, 'training-entry', 'me')).toBe(null);
    expect(saveFormDraft(broken, 'training-entry', 'me', { content: 'x' }, { content: '' })).toBe(false);
    expect(() => clearFormDraft(broken, 'training-entry', 'me')).not.toThrow();
  });
});
