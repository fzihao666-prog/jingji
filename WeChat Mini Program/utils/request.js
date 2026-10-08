const { NETWORK_DEBUG, API_ENVIRONMENT, TOKEN_KEY, getApiBaseUrl } = require('../config');
const { networkErrorMessage } = require('./network-error');

let redirecting = false;
let traceSequence = 0;
let networkEnvironmentReported = false;

function runtimeVersion() {
  try {
    return typeof wx.getAccountInfoSync === 'function' ? wx.getAccountInfoSync().miniProgram.envVersion : 'unknown';
  } catch {
    return 'unknown';
  }
}

function networkDebugEnabled() {
  return NETWORK_DEBUG || ['develop', 'trial'].includes(runtimeVersion());
}

function traceNetwork(stage, detail) {
  try {
    if (!networkDebugEnabled()) return;
    console.log(`[网络追踪] ${stage}`, { time: new Date().toISOString(), ...detail });
  } catch {
    // 诊断失败不得中断启动、登录或网络请求。
  }
}

function nextTraceId() {
  traceSequence += 1;
  return `network-${Date.now()}-${traceSequence}`;
}

function durationMs(startedAt) {
  return Date.now() - startedAt;
}

function summarizeUrl(url) {
  const queryIndex = url.indexOf('?');
  const address = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const redactedPath = address.replace(/\/\d+(?=\/|$)/g, '/:id');
  return queryIndex === -1 ? redactedPath : `${redactedPath}?<redacted>`;
}

function summarizePayload(data) {
  if (data === null || data === undefined) return { type: 'empty' };
  if (Array.isArray(data)) return { type: 'array', length: data.length };
  if (typeof data === 'object') return { type: 'object', fields: Object.keys(data).slice(0, 20) };
  return { type: typeof data, length: String(data).length };
}

function summarizeHeaders(headers) {
  const normalized = headers || {};
  return {
    contentType: String(normalized['content-type'] || normalized['Content-Type'] || '').match(/^(?:application\/json|text\/html|text\/plain|application\/octet-stream)(?=;|$)/i)?.[0] || 'other',
    hasRequestId: !!(normalized['x-request-id'] || normalized['X-Request-Id']),
  };
}

function responseMessage(data) {
  if (!data || typeof data.message !== 'string') return '';
  return '[服务端消息已省略，请查看页面错误提示]';
}

function safeErrorMessage(error) {
  const message = String((error && error.errMsg) || '');
  // 只保留网络错误标识，避免原始错误内的 URL、查询参数或服务端文本泄漏。
  const markers = message.match(/ERR_[A-Z0-9_]+|cronet_error_code:\s*-?\d+|url not in domain list|timeout|certificate|handshake|ssl|connection reset|fail|ok/gi);
  return markers ? markers.slice(0, 8).join(' · ') : '[原始错误已省略]';
}

function summarizeError(error) {
  const code = String((error && error.errCode) || '');
  return {
    errCode: /^-?\d{1,10}$/.test(code) ? code : '',
    errMsg: safeErrorMessage(error),
  };
}

function classifyNetworkFailure(error, lifecycle) {
  const errMsg = String((error && error.errMsg) || 'unknown error');
  const receivedResponseHeaders = lifecycle.receivedResponseHeaders;
  const base = {
    receivedResponseHeaders,
    receivedHttpResponse: lifecycle.receivedHttpResponse,
    failureBoundary: receivedResponseHeaders ? '已收到服务端响应头之后' : '收到服务端响应头之前',
  };

  if (/ERR_CONNECTION_RESET|cronet_error_code:-101/i.test(errMsg)) {
    return {
      ...base,
      category: '连接被重置',
      likelyLocation: receivedResponseHeaders
        ? '服务端响应后或客户端读取响应时'
        : '客户端、网络链路或 TLS/HTTP 建连阶段',
      nextCheck: receivedResponseHeaders
        ? '检查 Nginx access/error 日志及响应体读取'
        : '检查真机网络、TLS 握手抓包和微信服务器域名配置',
    };
  }
  if (/url not in domain list|合法域名/i.test(errMsg)) {
    return {
      ...base,
      category: '微信服务器域名校验失败',
      likelyLocation: '微信客户端请求策略',
      nextCheck: '核对当前 AppID 下 request/uploadFile/downloadFile 的精确域名',
    };
  }
  if (/ssl|certificate|handshake/i.test(errMsg)) {
    return {
      ...base,
      category: 'TLS 证书或握手失败',
      likelyLocation: '客户端与 HTTPS 服务之间',
      nextCheck: '检查证书链、SAN、有效期、TLS 版本和 Nginx TLS 日志',
    };
  }
  if (/timeout/i.test(errMsg)) {
    return {
      ...base,
      category: '网络超时',
      likelyLocation: receivedResponseHeaders ? '服务端响应处理' : 'DNS、建连或上游网络',
      nextCheck: '比较 Wi-Fi/移动网络，并检查服务器访问日志和上游耗时',
    };
  }
  return {
    ...base,
    category: '未分类网络错误',
    likelyLocation: '需要结合 errMsg 与服务器日志判断',
    nextCheck: '保留同一 traceId 的全部网络追踪记录',
  };
}

function attachHeadersTrace(task, traceId, startedAt, lifecycle) {
  if (!task || typeof task.onHeadersReceived !== 'function') {
    traceNetwork('响应头追踪不可用', { traceId });
    return;
  }
  try {
    task.onHeadersReceived((result) => {
      lifecycle.receivedResponseHeaders = true;
      traceNetwork('响应头已收到', {
        traceId,
        durationMs: durationMs(startedAt),
        headers: summarizeHeaders(result.header),
      });
    });
  } catch {
    traceNetwork('响应头追踪注册失败', { traceId });
  }
}

function traceNetworkEnvironment() {
  if (!networkDebugEnabled() || networkEnvironmentReported || typeof wx.getNetworkType !== 'function') return;
  networkEnvironmentReported = true;
  let appInfo = {};
  try {
    appInfo = typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : {};
  } catch {
    // 基础信息获取失败不阻断登录请求。
  }
  traceNetwork('网络环境检查开始', {
    apiEnvironment: API_ENVIRONMENT,
    baseUrl: summarizeUrl(getApiBaseUrl()),
    envVersion: runtimeVersion(),
    SDKVersion: appInfo.SDKVersion || 'unknown',
    wechatVersion: appInfo.version || 'unknown'
  });
  try {
    wx.getNetworkType({
      success(result) {
        traceNetwork('网络环境检查成功', { networkType: result.networkType || 'unknown' });
      },
      fail(error) {
        traceNetwork('网络环境检查失败', summarizeError(error));
      },
    });
  } catch {
    traceNetwork('网络环境检查不可用', {});
  }
}

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

function buildRequestUrl(baseUrl, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

function request(path, options = {}) {
  const traceId = options.traceId || nextTraceId();
  const startedAt = Date.now();
  const lifecycle = { receivedResponseHeaders: false, receivedHttpResponse: false };
  const token = wx.getStorageSync(TOKEN_KEY);
  const headers = Object.assign({}, options.header || {});
  if (token && options.auth !== false) headers.Authorization = `Bearer ${token}`;
  if (options.data && options.method !== 'GET' && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  const url = buildRequestUrl(getApiBaseUrl(), path);
  traceNetworkEnvironment();
  traceNetwork('请求开始', {
    traceId,
    transport: 'wx.request',
    method: options.method || 'GET',
    url: summarizeUrl(url),
    timeoutMs: options.timeout || 30000,
    hasAuthorization: Boolean(headers.Authorization),
    requestBody: summarizePayload(options.data),
  });
  return new Promise((resolve, reject) => {
    const task = wx.request({
      url,
      method: options.method || 'GET',
      data: options.data,
      header: headers,
      timeout: options.timeout || 30000,
      success(response) {
        lifecycle.receivedHttpResponse = true;
        const responseDetail = {
          traceId,
          statusCode: response.statusCode,
          durationMs: durationMs(startedAt),
          headers: summarizeHeaders(response.header),
          responseBody: summarizePayload(response.data),
          message: responseMessage(response.data),
        };
        traceNetwork(response.statusCode >= 200 && response.statusCode < 300 ? '响应成功' : '响应异常', responseDetail);
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
        traceNetwork('请求失败', {
          traceId,
          durationMs: durationMs(startedAt),
          ...summarizeError(error),
          diagnosis: classifyNetworkFailure(error, lifecycle),
        });

        reject(new Error(networkErrorMessage(error)));
      },
      complete(result) {
        traceNetwork('请求完成', {
          traceId,
          durationMs: durationMs(startedAt),
          statusCode: result.statusCode || 0,
          errMsg: safeErrorMessage(result),
          receivedResponseHeaders: lifecycle.receivedResponseHeaders,
          receivedHttpResponse: lifecycle.receivedHttpResponse,
        });
      },
    });
    traceNetwork('请求已派发', { traceId, transport: 'wx.request' });
    attachHeadersTrace(task, traceId, startedAt, lifecycle);
  });
}

function uploadFile(path, filePath, name = 'photo') {
  const traceId = nextTraceId();
  const startedAt = Date.now();
  const lifecycle = { receivedResponseHeaders: false, receivedHttpResponse: false };
  const token = wx.getStorageSync(TOKEN_KEY);
  const url = buildRequestUrl(getApiBaseUrl(), path);
  traceNetworkEnvironment();
  traceNetwork('请求开始', {
    traceId,
    transport: 'wx.uploadFile',
    method: 'POST',
    url: summarizeUrl(url),
    timeoutMs: 30000,
    hasAuthorization: Boolean(token),
    uploadField: name,
    hasLocalFile: Boolean(filePath),
  });
  return new Promise((resolve, reject) => {
    const task = wx.uploadFile({
      url,
      filePath,
      name,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 30000,
      success(response) {
        lifecycle.receivedHttpResponse = true;
        let data;
        try { data = JSON.parse(response.data || '{}'); } catch { data = {}; }
        traceNetwork(response.statusCode >= 200 && response.statusCode < 300 ? '响应成功' : '响应异常', {
          traceId,
          statusCode: response.statusCode,
          durationMs: durationMs(startedAt),
          responseBody: summarizePayload(data),
        });
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(data);
          return;
        }
        if (response.statusCode === 401) redirectToLogin();
        reject(new Error(data.message || `上传失败（${response.statusCode}）`));
      },
      fail(error) {
        traceNetwork('请求失败', {
          traceId,
          durationMs: durationMs(startedAt),
          ...summarizeError(error),
          diagnosis: classifyNetworkFailure(error, lifecycle),
        });
        reject(new Error(networkErrorMessage(error)));
      },
      complete(result) {
        traceNetwork('请求完成', {
          traceId,
          durationMs: durationMs(startedAt),
          statusCode: result.statusCode || 0,
          errMsg: safeErrorMessage(result),
          receivedResponseHeaders: lifecycle.receivedResponseHeaders,
          receivedHttpResponse: lifecycle.receivedHttpResponse,
        });
      },
    });
    traceNetwork('请求已派发', { traceId, transport: 'wx.uploadFile' });
    attachHeadersTrace(task, traceId, startedAt, lifecycle);
  });
}

function downloadFile(path) {
  const traceId = nextTraceId();
  const startedAt = Date.now();
  const token = wx.getStorageSync(TOKEN_KEY);
  const url = buildRequestUrl(getApiBaseUrl(), path);
  traceNetwork('下载开始', {
    traceId,
    transport: 'wx.downloadFile',
    url: summarizeUrl(url),
    hasAuthorization: Boolean(token),
  });
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 30000,
      success(response) {
        traceNetwork('下载完成', {
          traceId,
          statusCode: response.statusCode,
          durationMs: durationMs(startedAt),
        });
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.tempFilePath);
          return;
        }
        if (response.statusCode === 401) redirectToLogin();
        reject(new Error(`下载失败（${response.statusCode}）`));
      },
      fail(error) {
        traceNetwork('下载失败', { traceId, ...summarizeError(error) });
        reject(new Error(networkErrorMessage(error)));
      },
    });
  });
}

function assetUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return buildRequestUrl(getApiBaseUrl(), path);
}

module.exports = { request, uploadFile, downloadFile, assetUrl, buildRequestUrl, traceNetwork, nextTraceId, traceNetworkEnvironment };
