// 发布前必须保持为 production；本地开发者工具联调时才改为 development。
const API_ENVIRONMENT = 'production';
const LOCAL_API_BASE_URL = 'http://127.0.0.1:8787';
const API_BASE_URL = 'https://jingjity.xin';
// 正式版默认关闭追踪；开发版、体验版自动启用脱敏诊断，人工排查开关保持 false。
const NETWORK_DEBUG = false;

const TOKEN_KEY = 'jingji-mini-token';
const USER_KEY = 'jingji-mini-user';
const PROJECT_KEY = 'jingji-mini-project';

/** @param {string} environment @param {string} [productionBaseUrl] */
function resolveApiBaseUrl(environment, productionBaseUrl = API_BASE_URL) {
  if (!['development', 'production'].includes(environment)) {
    throw new Error('API 环境必须是 development 或 production。');
  }

  const baseUrl = environment === 'development' ? LOCAL_API_BASE_URL : productionBaseUrl;
  const normalized = String(baseUrl || '').replace(/\/$/, '');

  if (!normalized) throw new Error('API 地址不能为空。');
  if (environment === 'production' && !/^https:\/\//i.test(normalized)) {
    throw new Error('生产 API 地址必须使用 HTTPS。');
  }

  return normalized;
}

function getApiBaseUrl() {
  return resolveApiBaseUrl(API_ENVIRONMENT);
}

module.exports = {
  API_BASE_URL,
  API_ENVIRONMENT,
  LOCAL_API_BASE_URL,
  NETWORK_DEBUG,
  TOKEN_KEY,
  USER_KEY,
  PROJECT_KEY,
  resolveApiBaseUrl,
  getApiBaseUrl
};
