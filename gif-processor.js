import { GifReader } from './omggif.esm.js';
import { GIFEncoder, quantize, applyPalette, prequantize } from './gifenc.esm.js';

/**
 * دالة مساعدة لتنسيق البايتات إلى صيغة مقروءة (B, KB, MB)
 */
export function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * فك تشفير وتجميع إطارات ملف GIF بالكامل مع مراعاة الشفافية وطرق التخلص (Disposal)
 * @param {ArrayBuffer|Uint8Array} buffer 
 * @returns {Promise<{width: number, height: number, numFrames: number, isTransparent: boolean, frames: Array}>}
 */
export async function decodeGifToFrames(buffer) {
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const reader = new GifReader(uint8);
  const numFrames = reader.numFrames();
  const width = reader.width;
  const height = reader.height;

  // كانفاس التجميع الرئيسي للإطارات
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // كانفاس لحفظ الحالة السابقة عند وجود disposal = 3 (restore previous)
  const prevCanvas = document.createElement('canvas');
  prevCanvas.width = width;
  prevCanvas.height = height;
  const prevCtx = prevCanvas.getContext('2d', { willReadFrequently: true });

  const frames = [];
  let isTransparent = false;

  // حاوية البكسلات لقراءة الإطار من GifReader
  const framePixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < numFrames; i++) {
    const info = reader.frameInfo(i);
    // التأخير بالميللي ثانية (الحد الأدنى 20ms لتجنب المشاكل في المتصفحات)
    const delay = Math.max(20, (info.delay || 10) * 10);

    if (info.disposal === 3) {
      prevCtx.clearRect(0, 0, width, height);
      prevCtx.drawImage(canvas, 0, 0);
    }

    // فك تشفير الإطار الحالي
    reader.decodeAndBlitFrameRGBA(i, framePixels);

    if (info.transparent_index !== null) {
      isTransparent = true;
    }

    // رسم الإطار على كانفاس فرعي مؤقت
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    const tempImgData = new ImageData(new Uint8ClampedArray(framePixels), width, height);
    tempCtx.putImageData(tempImgData, 0, 0);

    // تجميع الإطار فوق الكانفاس الرئيسي
    ctx.drawImage(tempCanvas, 0, 0);

    // أخذ لقطة من الإطار المجمع بالكامل
    const compositedImgData = ctx.getImageData(0, 0, width, height);

    // التحقق من وجود شفافية فعلية في بكسلات الإطار
    if (!isTransparent) {
      const data = compositedImgData.data;
      const step = Math.max(4, Math.floor(data.length / 500) * 4);
      for (let p = 3; p < data.length; p += step) {
        if (data[p] < 250) {
          isTransparent = true;
          break;
        }
      }
    }

    frames.push({
      index: i,
      delay,
      width,
      height,
      imageData: compositedImgData,
      disposal: info.disposal,
    });

    // معالجة طريقة التخلص للإطار التالي
    if (info.disposal === 2) {
      // restore to background
      ctx.clearRect(info.x, info.y, info.width, info.height);
    } else if (info.disposal === 3) {
      // restore to previous
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(prevCanvas, 0, 0);
    }
  }

  return {
    width,
    height,
    numFrames,
    isTransparent,
    frames,
  };
}

/**
 * تحويل مقطع MP4 إلى GIF عادي بنفس المقاسات المستوردة بالكامل مع أعلى جودة
 * @param {HTMLVideoElement} video 
 * @param {Object} options 
 * @returns {Promise<Uint8Array>}
 */
export async function encodeVideoToHighQualityGif(video, options = {}) {
  const {
    start = 0,
    end = video.duration || 5,
    fps = 20,
    scale = 1.0, // 1.0 تعني 100% نفس المقاسات الأصلية المستوردة
    customWidth = null,
    onProgress = null,
  } = options;

  const originalW = video.videoWidth;
  const originalH = video.videoHeight;

  let targetW = originalW;
  let targetH = originalH;

  if (customWidth) {
    targetW = Math.round(customWidth);
    targetH = Math.round(targetW * (originalH / originalW));
  } else if (scale && scale !== 1.0) {
    targetW = Math.round(originalW * scale);
    targetH = Math.round(originalH * scale);
  }

  // ضمان أرقام زوجية للأبعاد لتوافق ممتاز
  targetW = Math.max(2, Math.floor(targetW / 2) * 2);
  targetH = Math.max(2, Math.floor(targetH / 2) * 2);

  const duration = Math.max(0.1, end - start);
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const delay = Math.round(1000 / fps);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const gif = GIFEncoder();

  for (let i = 0; i < totalFrames; i++) {
    const frameTime = start + (i / fps);

    // انتقال دقيق للوقت المطلوب
    await new Promise((resolve) => {
      let done = false;
      const onSeeked = () => {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = Math.min(frameTime, end);
      setTimeout(onSeeked, 400);
    });

    // رسم الإطار من الفيديو مباشرة على الكانفاس بالأبعاد المحددة
    ctx.drawImage(video, 0, 0, targetW, targetH);
    const imgData = ctx.getImageData(0, 0, targetW, targetH);
    const data = imgData.data;

    // GIF عادي بأعلى جودة: استخدام 256 لون لكل إطار (Local Palette) بدون ضغط شفاف
    const palette = quantize(data, 256, { format: 'rgb565' });
    const index = applyPalette(data, palette, 'rgb565');

    gif.writeFrame(index, targetW, targetH, {
      palette,
      delay,
      repeat: 0,
    });

    if (onProgress) {
      onProgress(i + 1, totalFrames, Math.round(((i + 1) / totalFrames) * 100));
    }
  }

  gif.finish();
  return gif.bytes();
}

/**
 * ضغط ومعالجة GIF (عادي أو شفاف) لتلبية الحجم المطلوب بالميجابايت مع أفضل جودة ممكنة
 * @param {Array} sourceFrames مصفوفة الإطارات المفككة
 * @param {number} sourceWidth 
 * @param {number} sourceHeight 
 * @param {boolean} isTransparent هل يحتوي الـ GIF الأصلي على شفافية
 * @param {number} targetBytes الحد الأقصى للحجم بالبايت
 * @param {Function} onProgress 
 * @returns {Promise<{bytes: Uint8Array, width: number, height: number, framesCount: number, sizeBytes: number}>}
 */
export async function compressGifToTargetMb(
  sourceFrames,
  sourceWidth,
  sourceHeight,
  isTransparent,
  targetBytes,
  onProgress = null
) {
  const numFrames = sourceFrames.length;
  if (!numFrames) throw new Error('لا توجد إطارات للضغط');

  // حساب الحجم الخام التقديري
  const rawBytesEstimate = numFrames * sourceWidth * sourceHeight * (isTransparent ? 0.35 : 0.45);
  
  // استراتيجية الضغط الأولية للوصول لأفضل جودة ضمن الميزانية المطلوبة
  let frameStep = 1;
  // إذا كان عدد الإطارات كبيراً جداً والميزانية ضيقة، نقوم بدمج الإطارات الزوجية
  if (numFrames > 35 && targetBytes < rawBytesEstimate * 0.4) {
    frameStep = 2;
  }

  // حساب مقياس الأبعاد المناسب للبدء
  let scale = 1.0;
  if (rawBytesEstimate > targetBytes * 1.1) {
    const ratio = (targetBytes * 0.95) / (rawBytesEstimate / frameStep);
    scale = Math.min(1.0, Math.max(0.35, Math.sqrt(Math.max(0.1, ratio))));
  }

  // جولات الضغط التكيفية (حتى 3 محاولات لضمان عدم تجاوز الحجم مع أفضل جودة)
  let bestResult = null;
  const maxPasses = 3;

  for (let pass = 1; pass <= maxPasses; pass++) {
    let currentW = Math.max(48, Math.floor((sourceWidth * scale) / 2) * 2);
    let currentH = Math.max(48, Math.floor((sourceHeight * scale) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = currentW;
    canvas.height = currentH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const gif = GIFEncoder();
    const activeFrames = [];

    // اختيار الإطارات بناء على frameStep
    for (let f = 0; f < numFrames; f += frameStep) {
      let combinedDelay = sourceFrames[f].delay;
      for (let s = 1; s < frameStep && (f + s) < numFrames; s++) {
        combinedDelay += sourceFrames[f + s].delay;
      }
      activeFrames.push({
        sourceFrame: sourceFrames[f],
        delay: combinedDelay,
      });
    }

    const totalActive = activeFrames.length;

    // تحديد درجة تكميم الألوان ومستوى prequantize لتقليل الحجم مع الحفاظ على الحدة
    const roundVal = pass === 1 ? (scale < 0.8 ? 6 : 4) : (pass === 2 ? 8 : 12);
    const maxColors = isTransparent ? 256 : (pass > 2 ? 192 : 256);

    for (let idx = 0; idx < totalActive; idx++) {
      const item = activeFrames[idx];
      const srcImg = item.sourceFrame.imageData;

      // رسم الإطار بحجمه الجديد
      ctx.clearRect(0, 0, currentW, currentH);

      // رسم عبر كانفاس وسيط لتحجيم عالي الدقة
      const tempC = document.createElement('canvas');
      tempC.width = srcImg.width;
      tempC.height = srcImg.height;
      const tCtx = tempC.getContext('2d');
      tCtx.putImageData(srcImg, 0, 0);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tempC, 0, 0, currentW, currentH);

      const frameData = ctx.getImageData(0, 0, currentW, currentH);
      const data = frameData.data;

      // تطبيق prequantize الذكي لتقليل أحجام سلاسل LZW بدون تشويه ملحوظ
      prequantize(data, {
        roundRGB: roundVal,
        roundAlpha: isTransparent ? 12 : 0,
        oneBitAlpha: isTransparent,
      });

      if (isTransparent) {
        const palette = quantize(data, maxColors, {
          format: 'rgba4444',
          oneBitAlpha: true,
          clearAlpha: true,
          clearAlphaThreshold: 30,
        });
        const index = applyPalette(data, palette, 'rgba4444');
        const transIdx = palette.findIndex((c) => c[3] === 0);

        gif.writeFrame(index, currentW, currentH, {
          palette,
          delay: item.delay,
          transparent: transIdx !== -1,
          transparentIndex: transIdx !== -1 ? transIdx : 0,
          repeat: 0,
        });
      } else {
        const palette = quantize(data, maxColors, { format: 'rgb565' });
        const index = applyPalette(data, palette, 'rgb565');

        gif.writeFrame(index, currentW, currentH, {
          palette,
          delay: item.delay,
          repeat: 0,
        });
      }

      if (onProgress) {
        const passOffset = (pass - 1) * 33;
        const currentProgress = passOffset + Math.round(((idx + 1) / totalActive) * 33);
        onProgress(idx + 1, totalActive, Math.min(99, currentProgress), pass);
      }
    }

    gif.finish();
    const resultBytes = gif.bytes();
    const resultSize = resultBytes.length;

    bestResult = {
      bytes: resultBytes,
      width: currentW,
      height: currentH,
      framesCount: totalActive,
      sizeBytes: resultSize,
    };

    // هل تم استيفاء شرط الحجم المطلوب؟
    if (resultSize <= targetBytes) {
      break;
    }

    // إذا تجاوز الحجم الهدف، نقوم بحساب نسبة التصغير الدقيقة للجولة التالية
    const overflowRatio = targetBytes / resultSize;
    scale = Math.max(0.3, scale * Math.sqrt(overflowRatio) * 0.96);
    if (pass === 1 && totalActive > 24 && frameStep === 1) {
      frameStep = 2;
    }
  }

  if (onProgress) {
    onProgress(bestResult.framesCount, bestResult.framesCount, 100, maxPasses);
  }

  return bestResult;
}
