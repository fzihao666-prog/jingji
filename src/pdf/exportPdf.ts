export async function exportPdfSheets(container: HTMLElement, fileName: string, watermark: string) {
  await document.fonts.ready;
  await Promise.all(
    Array.from(container.querySelectorAll<HTMLImageElement>('img')).map((image) => {
      if (image.complete && image.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => reject(new Error(`报告图片加载失败：${image.src}`)), { once: true });
      });
    })
  );
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf')
  ]);
  const sheets = Array.from(container.querySelectorAll<HTMLElement>('.personal-pdf-sheet'));
  if (!sheets.length) throw new Error('没有可导出的报告页面。');

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  for (let index = 0; index < sheets.length; index += 1) {
    if (index) pdf.addPage();
    const canvas = await html2canvas(sheets[index], {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false
    });
    drawWatermark(canvas, watermark);
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  }
  pdf.save(`${safeFileName(fileName)}.pdf`);
}

function drawWatermark(canvas: HTMLCanvasElement, text: string) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 0.075;
  context.fillStyle = '#176f73';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `800 ${Math.max(62, Math.round(canvas.width / 12))}px "Microsoft YaHei", "PingFang SC", sans-serif`;
  const gapX = canvas.width / 2.15;
  const gapY = canvas.height / 4.4;
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const x = canvas.width / 7 + column * gapX + (row % 2 ? gapX / 2 : 0);
      const y = canvas.height / 9 + row * gapY;
      context.save();
      context.translate(x, y);
      context.rotate(-Math.PI / 7);
      context.fillText(text, 0, 0);
      context.restore();
    }
  }
  context.restore();
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '_').slice(0, 120);
}
