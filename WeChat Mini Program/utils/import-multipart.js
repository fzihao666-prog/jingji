const MiB = 1024 * 1024;

function utf8(value) {
  return Uint8Array.from(encodeURIComponent(value).match(/%[\dA-F]{2}|./g) || [], (token) =>
    token.length === 3 ? parseInt(token.slice(1), 16) : token.charCodeAt(0)
  );
}

function readFile(filePath) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({
    filePath,
    success: ({ data }) => resolve(new Uint8Array(data)),
    fail: () => reject(new Error('无法读取所选文件，请重新选择。'))
  }));
}

async function importMultipart(fields, files, fileField) {
  const boundary = `jingji-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const fieldParts = Object.entries(fields).map(([name, value]) =>
    utf8(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
  );
  const fileParts = files.map((file) => {
    const filename = file.name.replace(/["\\/\u0000-\u001f\u007f]/g, '_');
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16)}`
    );
    return utf8(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"; filename*=UTF-8''${encoded}\r\nContent-Type: application/octet-stream\r\n\r\n`);
  });
  const newline = utf8('\r\n');
  const end = utf8(`--${boundary}--\r\n`);
  const sum = (parts) => parts.reduce((total, part) => total + part.length, 0);
  const totalSize = sum(fieldParts) + sum(fileParts) + end.length
    + files.reduce((total, file) => total + file.size + newline.length, 0);
  if (!Number.isSafeInteger(totalSize) || totalSize > 85 * MiB)
    throw new Error('本次文件总大小超过上传限制，请分批处理。');
  const body = new Uint8Array(totalSize);
  let offset = 0;
  function append(part) {
    body.set(part, offset);
    offset += part.length;
  }
  fieldParts.forEach(append);
  for (let index = 0; index < files.length; index++) {
    append(fileParts[index]);
    const bytes = await readFile(files[index].path);
    if (bytes.length !== files[index].size) throw new Error('所选文件已变化，请重新选择。');
    append(bytes);
    append(newline);
  }
  append(end);
  return { data: body.buffer, header: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

module.exports = { importMultipart };
