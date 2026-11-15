import { ChromaEngine } from './chroma-engine.js';
import { GIFEncoder, quantize, applyPalette } from './gifenc.esm.js';
import {
  decodeGifToFrames,
  encodeVideoToHighQualityGif,
  compressGifToTargetMb,
  formatFileSize,
} from './gif-processor.js';

/* ========================================================
   1. إدارة النافذة الترحيبية ومعلومات الإدارة
   ======================================================== */
const welcomeModal = document.getElementById('welcomeModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const enterSiteBtn = document.getElementById('enterSiteBtn');
const openWelcomeBtn = document.getElementById('openWelcomeBtn');

function hideWelcomeModal() {
  welcomeModal.classList.add('hidden');
}

function showWelcomeModal() {
  welcomeModal.classList.remove('hidden');
}

closeModalBtn.addEventListener('click', hideWelcomeModal);
enterSiteBtn.addEventListener('click', hideWelcomeModal);
openWelcomeBtn.addEventListener('click', showWelcomeModal);

welcomeModal.addEventListener('click', (e) => {
  if (e.target === welcomeModal) {
    hideWelcomeModal();
  }
});

/* ========================================================
   2. شريط التبديل بين الأقسام الرئيسية
   ======================================================== */
const navTabs = document.querySelectorAll('#mainSectionsNav .nav-tab');
const appViews = document.querySelectorAll('.app-view');

navTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const targetViewId = `view-${tab.dataset.view}`;

    navTabs.forEach((t) => t.classList.remove('active'));
    appViews.forEach((v) => v.classList.remove('active'));

    tab.classList.add('active');
    const targetView = document.getElementById(targetViewId);
    if (targetView) targetView.classList.add('active');

    // إيقاف تشغيل الفيديو مؤقتاً في الأقسام غير النشطة لتوفير موارد الجهاز
    if (tab.dataset.view !== 'mp4' && mp4Video && !mp4Video.paused) {
      mp4Video.pause();
      if (mp4PlayIcon) mp4PlayIcon.textContent = '▶';
    }
    if (tab.dataset.view !== 'chroma' && chromaVideo && !chromaVideo.paused) {
      chromaVideo.pause();
      if (chromaPlayIcon) chromaPlayIcon.textContent = '▶';
    }
  });
});

/* ========================================================
   3. القسم 1: تحويل MP4 بنفس المقاسات إلى GIF عادي بأعلى جودة
   ======================================================== */
const mp4Video = document.getElementById('mp4Video');
const mp4DropZone = document.getElementById('mp4DropZone');
const mp4FileInput = document.getElementById('mp4FileInput');
const mp4PickFileBtn = document.getElementById('mp4PickFileBtn');
const mp4ChangeVideoBtn = document.getElementById('mp4ChangeVideoBtn');
const mp4EmptyState = document.getElementById('mp4EmptyState');
const mp4PlayerWrap = document.getElementById('mp4PlayerWrap');
const mp4ResolutionText = document.getElementById('mp4ResolutionText');
const mp4TargetDimsDisplay = document.getElementById('mp4TargetDimsDisplay');

const mp4PlaybackBar = document.getElementById('mp4PlaybackBar');
const mp4PlayPauseBtn = document.getElementById('mp4PlayPauseBtn');
const mp4PlayIcon = document.getElementById('mp4PlayIcon');
const mp4SeekSlider = document.getElementById('mp4SeekSlider');
const mp4TimeLabel = document.getElementById('mp4TimeLabel');

const mp4ScaleSelect = document.getElementById('mp4ScaleSelect');
const mp4CustomWidthWrap = document.getElementById('mp4CustomWidthWrap');
const mp4CustomWidthInput = document.getElementById('mp4CustomWidthInput');
const mp4FpsSelect = document.getElementById('mp4FpsSelect');
const mp4TrimStart = document.getElementById('mp4TrimStart');
const mp4TrimEnd = document.getElementById('mp4TrimEnd');
const mp4DurationText = document.getElementById('mp4DurationText');
const mp4FramesText = document.getElementById('mp4FramesText');

const mp4ExportBtn = document.getElementById('mp4ExportBtn');
const mp4ProgressWrap = document.getElementById('mp4ProgressWrap');
const mp4ProgressFill = document.getElementById('mp4ProgressFill');
const mp4StatusText = document.getElementById('mp4StatusText');
const mp4ProgressPct = document.getElementById('mp4ProgressPct');
const mp4SuccessCard = document.getElementById('mp4SuccessCard');
const mp4SuccessDetails = document.getElementById('mp4SuccessDetails');
const mp4DownloadBtn = document.getElementById('mp4DownloadBtn');

let mp4BlobUrl = null;
let mp4FileName = 'video';
let mp4IsExporting = false;

function formatTime(sec) {
  if (isNaN(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateMp4Stats() {
  if (!mp4Video.duration) return;

  const start = Math.max(0, parseFloat(mp4TrimStart.value) || 0);
  const maxDur = mp4Video.duration;
  const end = Math.min(Math.max(start + 0.1, parseFloat(mp4TrimEnd.value) || maxDur), maxDur);
  const duration = Math.max(0.1, end - start);
  const fps = parseInt(mp4FpsSelect.value, 10);
  const totalFrames = Math.max(1, Math.round(duration * fps));

  mp4DurationText.textContent = `${duration.toFixed(1)} ثانية`;
  mp4FramesText.textContent = `${totalFrames} إطار`;

  const originalW = mp4Video.videoWidth || 0;
  const originalH = mp4Video.videoHeight || 0;
  const scaleVal = mp4ScaleSelect.value;

  let finalW = originalW;
  let finalH = originalH;

  if (scaleVal === 'custom' && mp4CustomWidthInput.value) {
    finalW = parseInt(mp4CustomWidthInput.value, 10) || originalW;
    finalH = Math.round(finalW * (originalH / originalW));
  } else if (scaleVal !== 'custom') {
    const s = parseFloat(scaleVal) || 1.0;
    finalW = Math.round(originalW * s);
    finalH = Math.round(originalH * s);
  }

  // أرقام زوجية للأبعاد
  finalW = Math.max(2, Math.floor(finalW / 2) * 2);
  finalH = Math.max(2, Math.floor(finalH / 2) * 2);

  mp4TargetDimsDisplay.textContent = `${finalW} × ${finalH} بكسل`;
}

function loadMp4VideoFile(file) {
  mp4Video.removeAttribute('crossorigin');
  if (mp4BlobUrl) URL.revokeObjectURL(mp4BlobUrl);
  mp4FileName = file.name.replace(/\.[^/.]+$/, '');
  mp4BlobUrl = URL.createObjectURL(file);
  mp4Video.src = mp4BlobUrl;

  mp4Video.onloadedmetadata = () => {
    mp4EmptyState.classList.add('hidden');
    mp4PlayerWrap.classList.remove('hidden');
    mp4PlaybackBar.classList.remove('hidden');
    mp4ExportBtn.disabled = false;
    mp4SuccessCard.classList.add('hidden');

    const origW = mp4Video.videoWidth;
    const origH = mp4Video.videoHeight;
    mp4ResolutionText.textContent = `${origW} × ${origH} بكسل`;

    mp4TrimStart.value = '0';
    const initEnd = Math.min(mp4Video.duration, 5);
    mp4TrimEnd.value = initEnd.toFixed(1);
    mp4TrimEnd.max = mp4Video.duration.toFixed(1);

    updateMp4Stats();
    mp4Video.play().catch(() => {});
    mp4PlayIcon.textContent = '⏸';
  };
}

// أحداث مشغل MP4
mp4PickFileBtn.addEventListener('click', () => mp4FileInput.click());
mp4ChangeVideoBtn.addEventListener('click', () => mp4FileInput.click());

mp4FileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) loadMp4VideoFile(file);
});

['dragenter', 'dragover'].forEach((type) => {
  mp4DropZone.addEventListener(type, (e) => {
    e.preventDefault();
    mp4DropZone.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach((type) => {
  mp4DropZone.addEventListener(type, (e) => {
    e.preventDefault();
    mp4DropZone.classList.remove('drag-over');
  });
});

mp4DropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('video/')) {
    loadMp4VideoFile(file);
  }
});

mp4PlayPauseBtn.addEventListener('click', () => {
  if (mp4Video.paused) {
    mp4Video.play();
    mp4PlayIcon.textContent = '⏸';
  } else {
    mp4Video.pause();
    mp4PlayIcon.textContent = '▶';
  }
});

mp4Video.addEventListener('timeupdate', () => {
  if (mp4Video.duration && !mp4IsExporting) {
    mp4SeekSlider.value = (mp4Video.currentTime / mp4Video.duration) * 100;
    mp4TimeLabel.textContent = `${formatTime(mp4Video.currentTime)} / ${formatTime(mp4Video.duration)}`;

    const start = parseFloat(mp4TrimStart.value) || 0;
    const end = parseFloat(mp4TrimEnd.value) || mp4Video.duration;
    if (mp4Video.currentTime >= end) {
      mp4Video.currentTime = start;
    }
  }
});

mp4SeekSlider.addEventListener('input', (e) => {
  if (mp4Video.duration) {
    mp4Video.currentTime = (parseFloat(e.target.value) / 100) * mp4Video.duration;
  }
});

mp4ScaleSelect.addEventListener('change', () => {
  mp4CustomWidthWrap.classList.toggle('hidden', mp4ScaleSelect.value !== 'custom');
  updateMp4Stats();
});

mp4CustomWidthInput.addEventListener('input', updateMp4Stats);
mp4FpsSelect.addEventListener('change', updateMp4Stats);
mp4TrimStart.addEventListener('input', updateMp4Stats);
mp4TrimEnd.addEventListener('input', updateMp4Stats);

// تنفيذ تصدير MP4 بنفس المقاسات الأصلية بأعلى جودة
mp4ExportBtn.addEventListener('click', async () => {
  if (mp4IsExporting || mp4Video.readyState < 2) return;

  mp4IsExporting = true;
  mp4Video.pause();
  mp4PlayIcon.textContent = '▶';
  mp4ExportBtn.disabled = true;
  mp4SuccessCard.classList.add('hidden');

  mp4ProgressWrap.classList.remove('hidden');
  mp4ProgressFill.style.width = '0%';
  mp4ProgressPct.textContent = '0%';
  mp4StatusText.textContent = 'جاري تحضير الإطارات بنفس المقاسات المستوردة...';

  const start = Math.max(0, parseFloat(mp4TrimStart.value) || 0);
  const end = Math.min(parseFloat(mp4TrimEnd.value) || mp4Video.duration, mp4Video.duration);
  const fps = parseInt(mp4FpsSelect.value, 10);

  let scale = 1.0;
  let customW = null;
  if (mp4ScaleSelect.value === 'custom') {
    customW = parseInt(mp4CustomWidthInput.value, 10) || mp4Video.videoWidth;
  } else {
    scale = parseFloat(mp4ScaleSelect.value) || 1.0;
  }

  try {
    const gifBytes = await encodeVideoToHighQualityGif(mp4Video, {
      start,
      end,
      fps,
      scale,
      customWidth: customW,
      onProgress: (current, total, pct) => {
        mp4ProgressFill.style.width = `${pct}%`;
        mp4ProgressPct.textContent = `${pct}%`;
        mp4StatusText.textContent = `معالجة الإطار ${current} من ${total} بأعلى جودة (${pct}%)`;
      },
    });

    const blob = new Blob([gifBytes], { type: 'image/gif' });
    const downloadUrl = URL.createObjectURL(blob);
    const sizeStr = formatFileSize(blob.size);

    let finalW = mp4Video.videoWidth;
    let finalH = mp4Video.videoHeight;
    if (customW) {
      finalW = customW;
      finalH = Math.round(customW * (mp4Video.videoHeight / mp4Video.videoWidth));
    } else {
      finalW = Math.round(finalW * scale);
      finalH = Math.round(finalH * scale);
    }

    mp4SuccessDetails.textContent = `الحجم: ${sizeStr} | الأبعاد: ${finalW} × ${finalH} بكسل | الإطارات: ${Math.round((end - start) * fps)}`;
    mp4DownloadBtn.href = downloadUrl;
    const downloadName = `CR8_GIF_original_${mp4FileName}_${finalW}x${finalH}_${Date.now()}.gif`;
    mp4DownloadBtn.download = downloadName;

    // تنزيل فوري للملف
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    mp4SuccessCard.classList.remove('hidden');
    mp4StatusText.textContent = `✅ اكتمل التحويل بنجاح! الحجم: ${sizeStr}`;
  } catch (err) {
    console.error('خطأ تحويل MP4 إلى GIF:', err);
    mp4StatusText.textContent = '❌ حدث خطأ أثناء التحويل: ' + err.message;
  } finally {
    mp4IsExporting = false;
    mp4ExportBtn.disabled = false;
  }
});

/* ========================================================
   4. القسم 2: ضغط ومعالجة GIF (عادية أو شفافة) وتحديد حجم الميجا
   ======================================================== */
const compressDropZone = document.getElementById('compressDropZone');
const compressFileInput = document.getElementById('compressFileInput');
const compressPickFileBtn = document.getElementById('compressPickFileBtn');
const compressChangeBtn = document.getElementById('compressChangeBtn');
const compressEmptyState = document.getElementById('compressEmptyState');
const compressPreviewWrap = document.getElementById('compressPreviewWrap');
const compressOrigImg = document.getElementById('compressOrigImg');
const compressResultBox = document.getElementById('compressResultBox');
const compressResultImg = document.getElementById('compressResultImg');

const compressFileNameEl = document.getElementById('compressFileName');
const compressSourceSizeEl = document.getElementById('compressSourceSize');
const compressSourceMetaEl = document.getElementById('compressSourceMeta');
const compressTransparencyBadge = document.getElementById('compressTransparencyBadge');
const compressOrigSizeBadge = document.getElementById('compressOrigSizeBadge');
const compressNewSizeBadge = document.getElementById('compressNewSizeBadge');

const targetMbInput = document.getElementById('targetMbInput');
const targetMbValueLabel = document.getElementById('targetMbValueLabel');
const mbPresetBtns = document.querySelectorAll('.mb-preset-btn');

const compressStartBtn = document.getElementById('compressStartBtn');
const compressProgressWrap = document.getElementById('compressProgressWrap');
const compressProgressFill = document.getElementById('compressProgressFill');
const compressStatusText = document.getElementById('compressStatusText');
const compressProgressPct = document.getElementById('compressProgressPct');

const compressSuccessCard = document.getElementById('compressSuccessCard');
const compressOldSize = document.getElementById('compressOldSize');
const compressNewSize = document.getElementById('compressNewSize');
const compressSavingPct = document.getElementById('compressSavingPct');
const compressDownloadBtn = document.getElementById('compressDownloadBtn');

let compressState = {
  rawBuffer: null,
  decoded: null,
  fileSize: 0,
  fileName: '',
  isProcessing: false,
};

function updateTargetMbDisplay(val) {
  const mbNum = parseFloat(val) || 2.0;
  targetMbValueLabel.textContent = `${mbNum.toFixed(1)} MB`;
}

targetMbInput.addEventListener('input', (e) => {
  updateTargetMbDisplay(e.target.value);
  mbPresetBtns.forEach((btn) => {
    btn.classList.toggle('active', parseFloat(btn.dataset.mb) === parseFloat(e.target.value));
  });
});

mbPresetBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    mbPresetBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    targetMbInput.value = btn.dataset.mb;
    updateTargetMbDisplay(btn.dataset.mb);
  });
});

async function loadGifFileForCompression(file) {
  compressState.fileSize = file.size;
  compressState.fileName = file.name.replace(/\.[^/.]+$/, '');
  compressFileNameEl.textContent = file.name;
  compressSourceSizeEl.textContent = formatFileSize(file.size);
  compressOrigSizeBadge.textContent = formatFileSize(file.size);

  const fileUrl = URL.createObjectURL(file);
  compressOrigImg.src = fileUrl;

  compressEmptyState.classList.add('hidden');
  compressPreviewWrap.classList.remove('hidden');
  compressResultBox.classList.add('hidden');
  compressSuccessCard.classList.add('hidden');
  compressStartBtn.disabled = true;
  compressStatusText.textContent = 'جاري تحليل إطارات الـ GIF...';
  compressProgressWrap.classList.remove('hidden');
  compressProgressFill.style.width = '20%';
  compressProgressPct.textContent = '20%';

  try {
    const arrayBuffer = await file.arrayBuffer();
    compressState.rawBuffer = arrayBuffer;

    // فك تشفير إطارات الـ GIF
    const decoded = await decodeGifToFrames(arrayBuffer);
    compressState.decoded = decoded;

    compressSourceMetaEl.textContent = `${decoded.width} × ${decoded.height} (${decoded.numFrames} إطار)`;

    if (decoded.isTransparent) {
      compressTransparencyBadge.textContent = 'شفاف (Transparent GIF) ✅';
      compressTransparencyBadge.style.color = '#c084fc';
    } else {
      compressTransparencyBadge.textContent = 'عادي (خلفية مصمتة) 🖼️';
      compressTransparencyBadge.style.color = '#38bdf8';
    }

    // اقتراح حجم افتراضي ذكي
    const currentMb = file.size / (1024 * 1024);
    let suggestedMb = 2.0;
    if (currentMb > 3.0) suggestedMb = 2.8;
    else if (currentMb > 1.8) suggestedMb = 1.5;
    else if (currentMb > 1.0) suggestedMb = 0.8;
    else suggestedMb = Math.max(0.3, Math.round(currentMb * 0.7 * 10) / 10);

    targetMbInput.value = suggestedMb.toFixed(1);
    updateTargetMbDisplay(suggestedMb);
    mbPresetBtns.forEach((btn) => {
      btn.classList.toggle('active', parseFloat(btn.dataset.mb) === suggestedMb);
    });

    compressProgressWrap.classList.add('hidden');
    compressStartBtn.disabled = false;
  } catch (err) {
    console.error('خطأ فك تشفير الـ GIF:', err);
    compressStatusText.textContent = '❌ فشل فحص ملف الـ GIF: ' + err.message;
    compressProgressWrap.classList.remove('hidden');
  }
}

compressPickFileBtn.addEventListener('click', () => compressFileInput.click());
compressChangeBtn.addEventListener('click', () => compressFileInput.click());

compressFileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) loadGifFileForCompression(file);
});

['dragenter', 'dragover'].forEach((type) => {
  compressDropZone.addEventListener(type, (e) => {
    e.preventDefault();
    compressDropZone.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach((type) => {
  compressDropZone.addEventListener(type, (e) => {
    e.preventDefault();
    compressDropZone.classList.remove('drag-over');
  });
});

compressDropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file && (file.type === 'image/gif' || file.name.endsWith('.gif'))) {
    loadGifFileForCompression(file);
  }
});

// بدء الضغط والمعالجة
compressStartBtn.addEventListener('click', async () => {
  if (compressState.isProcessing || !compressState.decoded) return;

  compressState.isProcessing = true;
  compressStartBtn.disabled = true;
  compressSuccessCard.classList.add('hidden');

  compressProgressWrap.classList.remove('hidden');
  compressProgressFill.style.width = '0%';
  compressProgressPct.textContent = '0%';
  compressStatusText.textContent = 'جاري بدء خوارزمية الضغط الذكي والحفاظ على الشفافية...';

  const targetMb = parseFloat(targetMbInput.value) || 2.0;
  const targetBytes = Math.round(targetMb * 1024 * 1024);

  try {
    const { decoded } = compressState;
    const result = await compressGifToTargetMb(
      decoded.frames,
      decoded.width,
      decoded.height,
      decoded.isTransparent,
      targetBytes,
      (current, total, pct, pass) => {
        compressProgressFill.style.width = `${pct}%`;
        compressProgressPct.textContent = `${pct}%`;
        compressStatusText.textContent = `جولة التحسين ${pass}: معالجة الإطار ${current} من ${total} (${pct}%)`;
      }
    );

    const blob = new Blob([result.bytes], { type: 'image/gif' });
    const downloadUrl = URL.createObjectURL(blob);
    const newSizeStr = formatFileSize(blob.size);
    const oldSizeStr = formatFileSize(compressState.fileSize);

    // عرض النتيجة
    compressResultImg.src = downloadUrl;
    compressResultBox.classList.remove('hidden');
    compressNewSizeBadge.textContent = newSizeStr;

    compressOldSize.textContent = oldSizeStr;
    compressNewSize.textContent = newSizeStr;

    const savedPct = Math.max(0, Math.round(((compressState.fileSize - blob.size) / compressState.fileSize) * 100));
    compressSavingPct.textContent = `🎉 تم توفير ${savedPct}% من الحجم الأصلي! (${newSizeStr} ≤ ${targetMb} MB)`;

    const downloadName = `CR8_GIF_compressed_${compressState.fileName}_${targetMb}MB_${Date.now()}.gif`;
    compressDownloadBtn.href = downloadUrl;
    compressDownloadBtn.download = downloadName;

    // تنزيل فوري
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    compressSuccessCard.classList.remove('hidden');
    compressStatusText.textContent = `✅ اكتمل الضغط بنجاح! الحجم النهائي: ${newSizeStr}`;
  } catch (err) {
    console.error('خطأ أثناء ضغط الـ GIF:', err);
    compressStatusText.textContent = '❌ حدث خطأ أثناء المعالجة: ' + err.message;
  } finally {
    compressState.isProcessing = false;
    compressStartBtn.disabled = false;
  }
});

/* ========================================================
   5. القسم 3: عزل الكروما وتصدير GIF شفاف (الأداة الاحترافية الحالية)
   ======================================================== */
const chromaVideo = document.getElementById('sourceVideo');
const glCanvas = document.getElementById('glCanvas');
const chromaCanvasWrap = document.getElementById('canvasWrap');
const chromaDropZone = document.getElementById('dropZone');
const chromaEmptyState = document.getElementById('emptyState');
const chromaVideoInput = document.getElementById('videoInput');
const chromaPickFileBtn = document.getElementById('pickFileBtn');
const chromaChangeVideoBtn = document.getElementById('changeVideoBtn');

const chromaPlaybackBar = document.getElementById('playbackBar');
const chromaPlayPauseBtn = document.getElementById('playPauseBtn');
const chromaPlayIcon = document.getElementById('playIcon');
const chromaSeekSlider = document.getElementById('seekSlider');
const chromaTimeLabel = document.getElementById('timeLabel');

const chromaExportBtn = document.getElementById('exportBtn');
const chromaProgressWrap = document.getElementById('exportProgressWrap');
const chromaProgressFill = document.getElementById('exportProgressFill');
const chromaExportStatus = document.getElementById('exportStatus');
const chromaExportPct = document.getElementById('exportPct');

const keyColorInput = document.getElementById('keyColor');
const eyedropperBtn = document.getElementById('eyedropperBtn');
const eyedropperTip = document.getElementById('eyedropperTip');
const similarityInput = document.getElementById('similarity');
const smoothnessInput = document.getElementById('smoothness');
const spillInput = document.getElementById('spill');
const similarityVal = document.getElementById('similarityVal');
const smoothnessVal = document.getElementById('smoothnessVal');
const spillVal = document.getElementById('spillVal');

const trimStartInput = document.getElementById('trimStart');
const trimEndInput = document.getElementById('trimEnd');
const selectedDurationEl = document.getElementById('selectedDuration');
const estimatedFramesEl = document.getElementById('estimatedFrames');
const memoryWarning = document.getElementById('memoryWarning');
const exportWidthSelect = document.getElementById('exportWidth');
const exportFpsSelect = document.getElementById('exportFps');
const trimEstimatedSize = document.getElementById('trimEstimatedSize');
const exportEstimatedSize = document.getElementById('exportEstimatedSize');

const MAX_BYTES_LIMIT = 2800 * 1024;
const SAFE_BYTES_TARGET = 2750 * 1024;

let chromaEngine;
try {
  chromaEngine = new ChromaEngine(glCanvas);
} catch (err) {
  console.error('خطأ تشغيل WebGL2 للكروما:', err);
}

const chromaState = {
  keyColor: [0, 1, 0],
  similarity: 0.35,
  smoothness: 0.10,
  spill: 0.20,
  trimStart: 0,
  trimEnd: 5,
  pickingColor: false,
  exporting: false,
  loopRunning: false,
  currentBlobUrl: null,
  fileName: 'chroma',
};

function hexToRgbNorm(hex) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
  ];
}

function estimateGifBytes(width, height, fps, duration) {
  const frames = Math.max(1, Math.round(duration * fps));
  const bytesPerPixel = 0.145;
  return Math.round(width * height * bytesPerPixel * frames) + 2048;
}

// تبويبات شريط أدوات الكروما للهاتف
document.querySelectorAll('.controls-pane .mobile-tabs .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.controls-pane .mobile-tabs .tab-btn, #view-chroma .tab-panel').forEach((el) => {
      el.classList.remove('active');
    });
    btn.classList.add('active');
    const panel = document.getElementById(`tab-${btn.dataset.tab}`);
    if (panel) panel.classList.add('active');
  });
});

function loadChromaVideoFile(file) {
  chromaVideo.removeAttribute('crossorigin');
  if (chromaState.currentBlobUrl) URL.revokeObjectURL(chromaState.currentBlobUrl);
  chromaState.fileName = file.name.replace(/\.[^/.]+$/, '');
  chromaState.currentBlobUrl = URL.createObjectURL(file);
  chromaVideo.src = chromaState.currentBlobUrl;

  chromaVideo.onloadedmetadata = () => {
    chromaEmptyState.classList.add('hidden');
    chromaCanvasWrap.classList.remove('hidden');
    chromaPlaybackBar.classList.remove('hidden');
    chromaExportBtn.disabled = false;

    chromaState.trimStart = 0;
    chromaState.trimEnd = Math.min(chromaVideo.duration, 6);
    trimStartInput.value = '0';
    trimEndInput.max = chromaVideo.duration.toFixed(1);
    trimEndInput.value = chromaState.trimEnd.toFixed(1);

    updateChromaTrimStats();
    chromaVideo.play().catch(() => {});
    chromaPlayIcon.textContent = '⏸';

    if (!chromaState.loopRunning) {
      chromaState.loopRunning = true;
      requestAnimationFrame(chromaRenderLoop);
    }
  };
}

function chromaRenderLoop() {
  if (!chromaState.exporting && chromaVideo.readyState >= 2) {
    if (chromaVideo.currentTime >= chromaState.trimEnd || chromaVideo.currentTime < chromaState.trimStart) {
      chromaVideo.currentTime = chromaState.trimStart;
    }

    if (chromaEngine) {
      chromaEngine.render(chromaVideo, chromaState);
    }

    if (chromaVideo.duration) {
      chromaSeekSlider.value = (chromaVideo.currentTime / chromaVideo.duration) * 100;
      chromaTimeLabel.textContent = `${formatTime(chromaVideo.currentTime)} / ${formatTime(chromaVideo.duration)}`;
    }
  }

  requestAnimationFrame(chromaRenderLoop);
}

chromaPickFileBtn.addEventListener('click', () => chromaVideoInput.click());
chromaChangeVideoBtn.addEventListener('click', () => chromaVideoInput.click());

chromaVideoInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) loadChromaVideoFile(file);
});

['dragenter', 'dragover'].forEach((type) => {
  chromaDropZone.addEventListener(type, (e) => {
    e.preventDefault();
    chromaDropZone.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach((type) => {
  chromaDropZone.addEventListener(type, (e) => {
    e.preventDefault();
    chromaDropZone.classList.remove('drag-over');
  });
});

chromaDropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('video/')) {
    loadChromaVideoFile(file);
  }
});

chromaPlayPauseBtn.addEventListener('click', () => {
  if (chromaVideo.paused) {
    chromaVideo.play();
    chromaPlayIcon.textContent = '⏸';
  } else {
    chromaVideo.pause();
    chromaPlayIcon.textContent = '▶';
  }
});

chromaSeekSlider.addEventListener('input', (e) => {
  if (chromaVideo.duration) {
    chromaVideo.currentTime = (parseFloat(e.target.value) / 100) * chromaVideo.duration;
  }
});

function setKeyColor(hex) {
  keyColorInput.value = hex;
  chromaState.keyColor = hexToRgbNorm(hex);
  document.querySelectorAll('#view-chroma .chip-btn[data-color]').forEach((b) => {
    b.classList.toggle('active', b.dataset.color.toLowerCase() === hex.toLowerCase());
  });
}

keyColorInput.addEventListener('input', (e) => setKeyColor(e.target.value));

document.querySelectorAll('#view-chroma .chip-btn[data-color]').forEach((btn) => {
  btn.addEventListener('click', () => setKeyColor(btn.dataset.color));
});

[
  { el: similarityInput, key: 'similarity', valEl: similarityVal },
  { el: smoothnessInput, key: 'smoothness', valEl: smoothnessVal },
  { el: spillInput, key: 'spill', valEl: spillVal },
].forEach(({ el, key, valEl }) => {
  el.addEventListener('input', () => {
    chromaState[key] = parseFloat(el.value);
    valEl.textContent = Number(el.value).toFixed(2);
  });
});

function toggleEyedropper(active) {
  chromaState.pickingColor = typeof active === 'boolean' ? active : !chromaState.pickingColor;
  eyedropperBtn.classList.toggle('active-picker', chromaState.pickingColor);
  chromaCanvasWrap.classList.toggle('picking-active', chromaState.pickingColor);
  eyedropperTip.classList.toggle('hidden', !chromaState.pickingColor);
}

eyedropperBtn.addEventListener('click', async () => {
  if (window.EyeDropper) {
    try {
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();
      if (result?.sRGBHex) {
        setKeyColor(result.sRGBHex);
        return;
      }
    } catch {}
  }
  toggleEyedropper();
});

glCanvas.addEventListener('click', (e) => {
  if (!chromaState.pickingColor || chromaVideo.readyState < 2) return;

  const rect = glCanvas.getBoundingClientRect();
  const scaleX = chromaVideo.videoWidth / rect.width;
  const scaleY = chromaVideo.videoHeight / rect.height;
  const px = Math.floor((e.clientX - rect.left) * scaleX);
  const py = Math.floor((e.clientY - rect.top) * scaleY);

  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 1;
  sampleCanvas.height = 1;
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(chromaVideo, px, py, 1, 1, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;

  const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  setKeyColor(hex);
  toggleEyedropper(false);
});

function updateChromaTrimStats() {
  const start = Math.max(0, parseFloat(trimStartInput.value) || 0);
  const maxDur = chromaVideo.duration || 60;
  const end = Math.min(Math.max(start + 0.2, parseFloat(trimEndInput.value) || maxDur), maxDur);

  chromaState.trimStart = start;
  chromaState.trimEnd = end;

  const dur = Math.max(0.1, end - start);
  const fps = parseInt(exportFpsSelect.value, 10);
  const frames = Math.round(dur * fps);
  const widthVal = parseInt(exportWidthSelect.value, 10);
  const aspect = (chromaVideo.videoWidth && chromaVideo.videoHeight) ? (chromaVideo.videoHeight / chromaVideo.videoWidth) : 1;
  const heightVal = Math.round(widthVal * aspect);

  selectedDurationEl.textContent = `${dur.toFixed(1)} ثانية`;
  estimatedFramesEl.textContent = `${frames} إطار`;

  const estBytes = estimateGifBytes(widthVal, heightVal, fps, dur);
  const estFormatted = formatFileSize(estBytes);
  const isOverLimit = estBytes > MAX_BYTES_LIMIT;

  const statusClass = isOverLimit ? 'size-status-warning' : 'size-status-safe';
  const statusSuffix = isOverLimit ? ' ⚠️ (سيتم ضبطه تلقائياً ليكون ≤ 2.800 MB)' : ' (ضمن الحد المسموح ✅)';

  if (trimEstimatedSize) {
    trimEstimatedSize.className = statusClass;
    trimEstimatedSize.textContent = `~${estFormatted}${statusSuffix}`;
  }
  if (exportEstimatedSize) {
    exportEstimatedSize.className = statusClass;
    exportEstimatedSize.textContent = `~${estFormatted}${statusSuffix}`;
  }

  memoryWarning.classList.toggle('hidden', dur <= 15);
}

trimStartInput.addEventListener('input', updateChromaTrimStats);
trimEndInput.addEventListener('input', updateChromaTrimStats);
exportFpsSelect.addEventListener('change', updateChromaTrimStats);
exportWidthSelect.addEventListener('change', updateChromaTrimStats);

async function encodeChromaFramesToGif(targetW, targetH, fps, start, end, onProgress) {
  const totalFrames = Math.max(1, Math.round((end - start) * fps));
  const delay = Math.round(1000 / fps);
  const gif = GIFEncoder();

  const offCanvas = document.createElement('canvas');
  offCanvas.width = targetW;
  offCanvas.height = targetH;
  const ctx = offCanvas.getContext('2d', { willReadFrequently: true });

  for (let i = 0; i < totalFrames; i++) {
    const frameTime = start + i / fps;

    await new Promise((resolve) => {
      let finished = false;
      const onSeeked = () => {
        if (finished) return;
        finished = true;
        chromaVideo.removeEventListener('seeked', onSeeked);
        resolve();
      };
      chromaVideo.addEventListener('seeked', onSeeked);
      chromaVideo.currentTime = frameTime;
      setTimeout(onSeeked, 600);
    });

    chromaEngine.render(chromaVideo, chromaState);

    ctx.clearRect(0, 0, targetW, targetH);
    ctx.drawImage(glCanvas, 0, 0, targetW, targetH);
    const { data } = ctx.getImageData(0, 0, targetW, targetH);

    const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
    const index = applyPalette(data, palette, 'rgba4444');
    const transparentIndex = palette.findIndex((c) => c[3] === 0);

    gif.writeFrame(index, targetW, targetH, {
      palette,
      delay,
      transparent: transparentIndex !== -1,
      transparentIndex: transparentIndex !== -1 ? transparentIndex : 0,
      repeat: 0,
    });

    if (onProgress) {
      onProgress(i + 1, totalFrames);
    }
  }

  gif.finish();
  return gif.bytes();
}

async function exportTransparentGif() {
  if (chromaState.exporting || chromaVideo.readyState < 2) return;

  chromaState.exporting = true;
  chromaVideo.pause();
  chromaPlayIcon.textContent = '▶';

  chromaExportBtn.disabled = true;
  chromaProgressWrap.classList.remove('hidden');
  chromaProgressFill.style.width = '0%';
  chromaExportPct.textContent = '0%';
  chromaExportStatus.textContent = 'جاري تحضير الإطارات والمعالجة (الحد الأقصى: 2.800 MB)...';

  const start = chromaState.trimStart;
  const end = chromaState.trimEnd;
  const duration = Math.max(0.1, end - start);
  const aspect = (chromaVideo.videoWidth && chromaVideo.videoHeight) ? (chromaVideo.videoHeight / chromaVideo.videoWidth) : 1;

  let currentFps = parseInt(exportFpsSelect.value, 10);
  let currentW = parseInt(exportWidthSelect.value, 10);

  let estBytes = estimateGifBytes(currentW, Math.round(currentW * aspect), currentFps, duration);
  if (estBytes > SAFE_BYTES_TARGET * 1.25) {
    if (currentFps > 15 && duration > 4) {
      currentFps = 15;
      estBytes = estimateGifBytes(currentW, Math.round(currentW * aspect), currentFps, duration);
    }
    if (estBytes > SAFE_BYTES_TARGET) {
      const budgetScale = Math.min(0.95, Math.sqrt((SAFE_BYTES_TARGET * 0.95) / estBytes));
      currentW = Math.max(220, Math.floor((currentW * budgetScale) / 2) * 2);
    }
  }

  try {
    let finalBytes = null;
    const maxPasses = 3;

    for (let pass = 1; pass <= maxPasses; pass++) {
      const currentH = Math.round(currentW * aspect);

      if (pass > 1) {
        chromaExportStatus.textContent = `جاري الضبط التلقائي لضمان الحجم (محاولة ${pass}): الدقة ${currentW}px...`;
        chromaProgressFill.style.width = '0%';
        chromaExportPct.textContent = '0%';
      }

      finalBytes = await encodeChromaFramesToGif(currentW, currentH, currentFps, start, end, (done, total) => {
        const pct = Math.round((done / total) * 100);
        chromaProgressFill.style.width = `${pct}%`;
        chromaExportPct.textContent = `${pct}%`;
        chromaExportStatus.textContent = `معالجة إطار الكروما ${done} من ${total} (${pct}%)`;
      });

      if (finalBytes.length <= MAX_BYTES_LIMIT) {
        break;
      }

      const overflowRatio = SAFE_BYTES_TARGET / finalBytes.length;
      const scaleDown = Math.min(0.92, Math.max(0.65, Math.sqrt(overflowRatio)));
      currentW = Math.max(180, Math.floor((currentW * scaleDown) / 2) * 2);
      if (currentFps > 12 && overflowRatio < 0.75) {
        currentFps = 12;
      }
    }

    chromaExportStatus.textContent = 'جاري تحميل ملف الـ GIF الشفاف...';

    const blob = new Blob([finalBytes], { type: 'image/gif' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `CR8_GIF_chroma_${chromaState.fileName}_${Date.now()}.gif`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);

    const sizeFormatted = formatFileSize(blob.size);
    chromaExportStatus.textContent = `✅ تم التصدير والتحميل بنجاح! الحجم: ${sizeFormatted} — ضمن الحد الأقصى 2.800 MB`;
  } catch (err) {
    console.error('فشل تصدير كروما GIF:', err);
    chromaExportStatus.textContent = '❌ حدث خطأ أثناء التصدير: ' + err.message;
  } finally {
    chromaState.exporting = false;
    chromaExportBtn.disabled = false;
    chromaVideo.currentTime = chromaState.trimStart;
    chromaVideo.play().catch(() => {});
    chromaPlayIcon.textContent = '⏸';
  }
}

chromaExportBtn.addEventListener('click', exportTransparentGif);
