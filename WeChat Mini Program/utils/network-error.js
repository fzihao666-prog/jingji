function networkErrorMessage(error) {
  const message = String((error && error.errMsg) || '');
  if (/ERR_CONNECTION_RESET|cronet_error_code:-101/i.test(message)) {
    return '网络连接被重置，请切换 Wi-Fi/移动网络重试；若持续失败，请联系管理员检查服务器 HTTPS 接入和 TLS 配置。';
  }
  if (/url not in domain list|合法域名/i.test(message)) {
    return '请求域名未通过微信校验，请联系管理员检查小程序合法域名配置。';
  }
  if (/ssl|certificate|handshake/i.test(message)) {
    return 'HTTPS 安全连接失败，请联系管理员检查服务器证书和 TLS 配置。';
  }
  if (/timeout/i.test(message)) return '网络请求超时，请检查网络后重试。';
  return '网络请求失败，请检查网络连接；若持续失败，请联系管理员。';
}

module.exports = { networkErrorMessage };
