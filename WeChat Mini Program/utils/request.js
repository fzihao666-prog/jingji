const { TOKEN_KEY, getApiBaseUrl } = require('../config');

let redirecting = false;

function redirectToLogin() {
  if (redirecting) return;
  redirecting = true;
  wx.removeStorageSync(TOKEN_KEY);
  const app = getApp();
  if (app && app.clearSession) app.clearSession();
  wx.reLaunch({
    url: '/pages/login/login',
    complete() {
      setTimeout(() => { redirecting = false; }, 400);
    }
  });
}

function request(path, options = {}) {
  const token = wx.getStorageSync(TOKEN_KEY);
  const headers = Object.assign({}, options.header || {});
  if (token && options.auth !== false) headers.Authorization = `Bearer ${token}`;
  if (options.data && options.method !== 'GET' && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getApiBaseUrl()}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header: headers,
      timeout: options.timeout || 30000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        if (response.statusCode === 401 && options.auth !== false) redirectToLogin();
        const message = response.data && response.data.message
          ? response.data.message
          : `请求失败（${response.statusCode}）`;
        reject(new Error(message));
      },
      fail(error) {
        const message = error && error.errMsg && error.errMsg.includes('timeout')
          ? '连接服务器超时，请检查网络和服务器地址。'
          : '无法连接服务器，请检查服务器地址、HTTPS 和域名配置。';
        reject(new Error(message));
      }
    });
  });
}

function uploadFile(path, filePath, name = 'photo') {
  const token = wx.getStorageSync(TOKEN_KEY);
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${getApiBaseUrl()}${path}`,
      filePath,
      name,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 30000,
      success(response) {
        let data = {};
        try { data = JSON.parse(response.data || '{}'); } catch { data = {}; }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(data);
          return;
        }
        if (response.statusCode === 401) redirectToLogin();
        reject(new Error(data.message || `上传失败（${response.statusCode}）`));
      },
      fail(error) {
        const message = error && error.errMsg && error.errMsg.includes('timeout')
          ? '上传超时，请检查网络和服务器地址。'
          : '照片上传失败，请检查网络和服务器配置。';
        reject(new Error(message));
      }
    });
  });
}

function assetUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

module.exports = { request, uploadFile, assetUrl };
