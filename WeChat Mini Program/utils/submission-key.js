const { sameForm } = require('./form-draft');

function storageKey(userId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('登录信息已失效，请重新登录。');
  return `jingji-mini-training-submission:${userId}`;
}

function readSubmission(storage, userId) {
  try {
    const value = storage.getStorageSync(storageKey(userId));
    return value && typeof value.key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value.key)
      && value.form && typeof value.form === 'object' ? value : null;
  } catch {
    throw new Error('无法读取本地提交凭据，请检查存储空间后重试。');
  }
}

function writeSubmission(storage, userId, value) {
  try {
    // 保留表单快照，避免页面继续修改表单时改变已发送请求的内容。
    storage.setStorageSync(storageKey(userId), JSON.parse(JSON.stringify(value)));
  } catch {
    // 写请求必须在编号持久保存之后发送，避免退出页面后重试失去防重依据。
    throw new Error('无法保存本地提交凭据，请检查存储空间后重试。');
  }
}

function submissionKey(storage, userId, form) {
  const existing = readSubmission(storage, userId);
  if (existing && existing.completed !== true && sameForm(existing.form, form)) return existing.key;
  // 请求编号只用于区分提交，不作为认证凭证；时间与随机段共同降低跨启动碰撞概率。
  const random = Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')).join('');
  const key = `training_${Date.now().toString(36)}_${random}`;
  writeSubmission(storage, userId, { key, form, completed: false });
  return key;
}

function completeSubmission(storage, userId, key) {
  const existing = readSubmission(storage, userId);
  if (existing && existing.key === key) writeSubmission(storage, userId, { ...existing, completed: true });
}

function isCompletedSubmission(storage, userId, form) {
  const existing = readSubmission(storage, userId);
  return Boolean(existing && existing.completed === true && sameForm(existing.form, form));
}

module.exports = { submissionKey, completeSubmission, isCompletedSubmission };
