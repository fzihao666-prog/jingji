// 表单弱网草稿：填写内容本地暂存，保存成功后清除，进入页面时提示是否恢复。
// 只暂存表单内容本身，不写入任何凭证或身份信息。

const DRAFT_PREFIX = 'jingji-mini-draft:';

function draftKey(formName, identity) {
  return `${DRAFT_PREFIX}${formName}:${identity || 'default'}`;
}

// 教练代填按目标运动员区分草稿，本人填报固定为 me，避免串稿。
function draftIdentity(isCoach, athleteId) {
  return isCoach ? `athlete:${Number(athleteId) || 0}` : 'me';
}

function stable(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stable(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function sameForm(a, b) {
  return JSON.stringify(stable(a || {})) === JSON.stringify(stable(b || {}));
}

// 与默认空表单一致视为“没有填写过”，不需要提示恢复。
function isMeaningfulDraft(form, defaults) {
  return !sameForm(form, defaults);
}

function loadFormDraft(storage, formName, identity) {
  try {
    const raw = storage.getStorageSync(draftKey(formName, identity));
    return raw && raw.data ? raw.data : null;
  } catch {
    return null;
  }
}

function saveFormDraft(storage, formName, identity, form, defaults) {
  const key = draftKey(formName, identity);
  try {
    if (!isMeaningfulDraft(form, defaults)) {
      storage.removeStorageSync(key);
      return false;
    }
    storage.setStorageSync(key, { savedAt: Date.now(), data: form });
    return true;
  } catch {
    // 本地存储失败不影响正常填写与提交。
    return false;
  }
}

function clearFormDraft(storage, formName, identity) {
  try {
    storage.removeStorageSync(draftKey(formName, identity));
  } catch {
    // 忽略清理失败。
  }
}

module.exports = {
  DRAFT_PREFIX,
  draftKey,
  draftIdentity,
  sameForm,
  isMeaningfulDraft,
  loadFormDraft,
  saveFormDraft,
  clearFormDraft,
};
