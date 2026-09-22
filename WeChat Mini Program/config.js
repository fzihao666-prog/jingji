const API_BASE_URL = 'https://www.jingjity.xin';

const TOKEN_KEY = 'jingji-mini-token';
const USER_KEY = 'jingji-mini-user';
const PROJECT_KEY = 'jingji-mini-project';

function getApiBaseUrl() {
  const stored = wx.getStorageSync('jingji-mini-api-base-url');
  return String(stored || API_BASE_URL).replace(/\/$/, '');
  console.log('当前 API 地址：', url);
}

module.exports = {
  API_BASE_URL,
  TOKEN_KEY,
  USER_KEY,
  PROJECT_KEY,
  getApiBaseUrl
};
