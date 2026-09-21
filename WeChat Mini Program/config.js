const API_BASE_URL = 'http://127.0.0.1:8787';

const TOKEN_KEY = 'jingji-mini-token';
const USER_KEY = 'jingji-mini-user';
const PROJECT_KEY = 'jingji-mini-project';

function getApiBaseUrl() {
  const stored = wx.getStorageSync('jingji-mini-api-base-url');
  return String(stored || API_BASE_URL).replace(/\/$/, '');
}

module.exports = {
  API_BASE_URL,
  TOKEN_KEY,
  USER_KEY,
  PROJECT_KEY,
  getApiBaseUrl
};
