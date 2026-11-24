// 保留历史外键所需的用户行，使用注册表单不允许的字符标识已删除账号。
export const removedAccountUsernamePrefix = 'deleted:';
export const removedAccountUsernamePattern = `${removedAccountUsernamePrefix}%`;
