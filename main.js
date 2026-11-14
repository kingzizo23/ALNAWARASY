import { ChromaEngine } from './chroma-engine.js';
import { GIFEncoder, quantize, applyPalette } from './gifenc.esm.js';

// عناصر الواجهة الرئيسية
const video = document.getElementById('sourceVideo');
const glCanvas = document.getElementById('glCanvas');
const canvasWrap = document.getElementById('canvasWrap');
const dropZone = document.getElementById('dropZone');
const emptyState = document.getElementById('emptyState');
const videoInput = document.getElementById('videoInput');
const pickFileBtn = document.getElementById('pickFileBtn');
const changeVideoBtn = document.getElementById('changeVideoBtn');

// شريط التشغيل
const playbackBar = document.getElementById('playbackBar');
const playPauseBtn = document.getElementById('playPauseBtn');
const playIcon = document.getElementById('playIcon');
const seekSlider = document.getElementById('seekSlider');
const timeLabel = document.getElementById('timeLabel');

// أزرار التصدير والتقدم
const exportBtn = document.getElementById('exportBtn');
const mobileExportBtn = document.getElementById('mobileExportBtn');
const exportProgressWrap = document.getElementById('exportProgressWrap');
const exportProgressFill = document.getElementById('exportProgressFill');
const exportStatus = document.getElementById('exportStatus');
const exportPct = document.getElementById('exportPct');

// أدوات الكروما
const keyColorInput = document.getElementById('keyColor');
const eyedropperBtn = document.getElementById('eyedropperBtn');
const eyedropperTip = document.getElementById('eyedropperTip');
const similarityInput = document.getElementById('similarity');
const smoothnessInput = document.getElementById('smoothness');
const spillInput = document.getElementById('spill');
const similarityVal = document.getElementById('similarityVal');
const smoothnessVal = document.getElementById('smoothnessVal');
const spillVal = document.getElementById('spillVal');

// أدوات القص والتصدير
const trimStartInput = document.getElementById('trimStart');
const trimEndInput = document.getElementById('trimEnd');
const selectedDurationEl = document.getElementById('selectedDuration');
const estimatedFramesEl = document.getElementById('estimatedFrames');
const memoryWarning = document.getElementById('memoryWarning');
const exportWidthSelect = document.getElementById('exportWidth');
const exportFpsSelect = document.getElementById('exportFps');
const mobileResWarning = document.getElementById('mobileResWarning');
const fileInfo = document.getElementById('fileInfo');
const fileNameEl = document.getElementById('fileName');

// تهيئة محرك WebGL2
let engine;
try {
  engine = new ChromaEngine(glCanvas);
} catch (err) {
  alert('خطأ في تشغيل محرك الكروما: ' + err.message);
  console.error(err);
}

// حالة التطبيق (State)
const state = {
  keyColor: [0, 1, 0], // RGB [0..1]
  similarity: 0.35,
  smoothness: 0.10,
  spill: 0.20,
  trimStart: 0,
  trimEnd: 5,
  pickingColor: false,
  exporting: false,
  loopRunning: false,
  currentBlobUrl: null,
};

// تحويل HEX إلى RGB طبيعي [0..1]
function hexToRgbNorm(hex) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
  ];
}

// تحويل ثوانٍ إلى صيغة mm:ss
function formatTime(sec) {
  if (isNaN(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 1. نظام تبويبات الهاتف
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn, .tab-panel').forEach((el) => el.classList.remove('active'));
    btn.classList.add('active');
    const targetPanel = document.getElementById(`tab-${btn.dataset.tab}`);
    if (targetPanel) targetPanel.classList.add('active');
  });
});

// 2. معالجة سحب وإفلات واختيار ملفات الفيديو
function setupFileLoading() {
  pickFileBtn.addEventListener('click', () => videoInput.click());
  changeVideoBtn.addEventListener('click', () => videoInput.click());

  videoInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadVideoFile(file);
  });

  // أحداث السحب والإفلات على منطقة المعاينة
  ['dragenter', 'dragover'].forEach((type) => {
    dropZone.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((type) => {
    dropZone.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('video/')) {
      loadVideoFile(file);
    }
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

function loadVideoFile(file) {
  if (state.currentBlobUrl) {
    URL.revokeObjectURL(state.currentBlobUrl);
  }

  state.currentBlobUrl = URL.createObjectURL(file);
  video.src = state.currentBlobUrl;

  fileNameEl.textContent = file.name;
  fileInfo.classList.remove('hidden');

  video.onloadedmetadata = () => {
    emptyState.classList.add('hidden');
    canvasWrap.classList.remove('hidden');
    playbackBar.classList.remove('hidden');
    exportBtn.disabled = false;
    mobileExportBtn.disabled = false;

    // ضبط القص الافتراضي (بحد أقصى 6 ثوانٍ كبداية سريعة)
    state.trimStart = 0;
    state.trimEnd = Math.min(video.duration, 6);
    trimStartInput.value = '0';
    trimEndInput.max = video.duration.toFixed(1);
    trimEndInput.value = state.trimEnd.toFixed(1);

    updateTrimStats();
    video.play().catch(() => {});
    playIcon.textContent = '⏸';

    if (!state.loopRunning) {
      state.loopRunning = true;
      requestAnimationFrame(renderLoop);
    }
  };
}

// 3. حلقة العرض والرندر في الوقت الفعلي (Render Loop)
function renderLoop() {
  if (!state.exporting && video.readyState >= 2) {
    // تكرار التشغيل تلقائياً داخل حدود القص المحددة
    if (video.currentTime >= state.trimEnd) {
      video.currentTime = state.trimStart;
    } else if (video.currentTime < state.trimStart) {
      video.currentTime = state.trimStart;
    }

    // رندر الإطار الحالي عبر WebGL2
    engine.render(video, state);

    // تحديث شريط التقديم
    if (video.duration) {
      seekSlider.value = (video.currentTime / video.duration) * 100;
      timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    }
  }

  requestAnimationFrame(renderLoop);
}

// 4. التحكم في التشغيل وشريط التقديم
playPauseBtn.addEventListener('click', () => {
  if (video.paused) {
    video.play();
    playIcon.textContent = '⏸';
  } else {
    video.pause();
    playIcon.textContent = '▶';
  }
});

seekSlider.addEventListener('input', (e) => {
  if (video.duration) {
    const targetTime = (parseFloat(e.target.value) / 100) * video.duration;
    video.currentTime = targetTime;
  }
});

// 5. أدوات الكروما وحساسية العزل
function setKeyColor(hex) {
  keyColorInput.value = hex;
  state.keyColor = hexToRgbNorm(hex);
  document.querySelectorAll('.chip-btn[data-color]').forEach((b) => {
    b.classList.toggle('active', b.dataset.color.toLowerCase() === hex.toLowerCase());
  });
}

keyColorInput.addEventListener('input', (e) => setKeyColor(e.target.value));

document.querySelectorAll('.chip-btn[data-color]').forEach((btn) => {
  btn.addEventListener('click', () => setKeyColor(btn.dataset.color));
});

[
  { el: similarityInput, key: 'similarity', valEl: similarityVal },
  { el: smoothnessInput, key: 'smoothness', valEl: smoothnessVal },
  { el: spillInput, key: 'spill', valEl: spillVal },
].forEach(({ el, key, valEl }) => {
  el.addEventListener('input', () => {
    state[key] = parseFloat(el.value);
    valEl.textContent = Number(el.value).toFixed(2);
  });
});

// 6. ميزة القطارة الذكية (من الفيديو مباشرة أو عبر EyeDropper API)
function toggleEyedropper(active) {
  state.pickingColor = typeof active === 'boolean' ? active : !state.pickingColor;
  eyedropperBtn.classList.toggle('active-picker', state.pickingColor);
  canvasWrap.classList.toggle('picking-active', state.pickingColor);
  eyedropperTip.classList.toggle('hidden', !state.pickingColor);
}

eyedropperBtn.addEventListener('click', async () => {
  // تجربة EyeDropper API المتصفح المدمج أولاً إن وُجد
  if (window.EyeDropper) {
    try {
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();
      if (result?.sRGBHex) {
        setKeyColor(result.sRGBHex);
        return;
      }
    } catch {
      // إذا أغلق المستخدم النافذة أو ألغى، نفعّل وضع النقر على الفيديو
    }
  }
  toggleEyedropper();
});

// التقاط اللون بالنقر على لوحة الفيديو
glCanvas.addEventListener('click', (e) => {
  if (!state.pickingColor || video.readyState < 2) return;

  const rect = glCanvas.getBoundingClientRect();
  const scaleX = video.videoWidth / rect.width;
  const scaleY = video.videoHeight / rect.height;
  const px = Math.floor((e.clientX - rect.left) * scaleX);
  const py = Math.floor((e.clientY - rect.top) * scaleY);

  // قراءة البكسل الأصلي من الفيديو الخام عبر Canvas ثنائي الأبعاد
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 1;
  sampleCanvas.height = 1;
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, px, py, 1, 1, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;

  const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  setKeyColor(hex);
  toggleEyedropper(false);
});

// 7. إدارة القص وحساب الإحصائيات وتحذيرات الذاكرة
function updateTrimStats() {
  const start = Math.max(0, parseFloat(trimStartInput.value) || 0);
  const maxDur = video.duration || 60;
  const end = Math.min(Math.max(start + 0.2, parseFloat(trimEndInput.value) || maxDur), maxDur);

  state.trimStart = start;
  state.trimEnd = end;

  const dur = Math.max(0.1, end - start);
  const fps = parseInt(exportFpsSelect.value, 10);
  const frames = Math.round(dur * fps);

  selectedDurationEl.textContent = `${dur.toFixed(1)} ثانية`;
  estimatedFramesEl.textContent = `${frames} إطار`;

  // تحذير الذاكرة إذا زادت المدة عن 15 ثانية
  memoryWarning.classList.toggle('hidden', dur <= 15);

  // تحذير دقة الهاتف
  const isMobile = window.innerWidth < 900;
  const widthVal = parseInt(exportWidthSelect.value, 10);
  mobileResWarning.classList.toggle('hidden', !isMobile || widthVal <= 480);
}

trimStartInput.addEventListener('input', updateTrimStats);
trimEndInput.addEventListener('input', updateTrimStats);
exportFpsSelect.addEventListener('change', updateTrimStats);
exportWidthSelect.addEventListener('change', updateTrimStats);
window.addEventListener('resize', updateTrimStats);

// 8. تصدير ملف GIF الشفاف عبر gifenc
async function exportTransparentGif() {
  if (state.exporting || video.readyState < 2) return;

  state.exporting = true;
  video.pause();
  playIcon.textContent = '▶';

  exportBtn.disabled = true;
  mobileExportBtn.disabled = true;
  exportProgressWrap.classList.remove('hidden');
  exportProgressFill.style.width = '0%';
  exportPct.textContent = '0%';
  exportStatus.textContent = 'جاري تحضير الإطارات والمعالجة...';

  const start = state.trimStart;
  const end = state.trimEnd;
  const fps = parseInt(exportFpsSelect.value, 10);
  const targetW = parseInt(exportWidthSelect.value, 10);
  const targetH = Math.round((video.videoHeight / video.videoWidth) * targetW);

  // Canvas ثنائي الأبعاد لقراءة بيانات البكسلات
  const offCanvas = document.createElement('canvas');
  offCanvas.width = targetW;
  offCanvas.height = targetH;
  const ctx = offCanvas.getContext('2d', { willReadFrequently: true });

  const totalFrames = Math.max(1, Math.round((end - start) * fps));
  const delay = Math.round(1000 / fps);
  const gif = GIFEncoder();

  try {
    for (let i = 0; i < totalFrames; i++) {
      const frameTime = start + i / fps;

      // انتقال زمني آمن ودقيق لكل إطار
      await new Promise((resolve) => {
        let finished = false;
        const onSeeked = () => {
          if (finished) return;
          finished = true;
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = frameTime;
        setTimeout(onSeeked, 400); // مهلة احتياطية للأجهزة البطيئة
      });

      // رندر الإطار في محرك الكروما
      engine.render(video, state);

      // رسم الإطار على الكانفاس الثنائي للحصول على بيانات RGBA بالأبعاد المطلوبة
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(glCanvas, 0, 0, targetW, targetH);
      const { data } = ctx.getImageData(0, 0, targetW, targetH);

      // تحويل الألوان والشفافية (1-bit alpha شفافية GIF)
      const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
      const index = applyPalette(data, palette, 'rgba4444');
      const transparentIndex = palette.findIndex((c) => c[3] === 0);

      // كتابة الإطار داخل ملف الـ GIF
      gif.writeFrame(index, targetW, targetH, {
        palette,
        delay,
        transparent: transparentIndex !== -1,
        transparentIndex: transparentIndex !== -1 ? transparentIndex : 0,
      });

      const pct = Math.round(((i + 1) / totalFrames) * 100);
      exportProgressFill.style.width = `${pct}%`;
      exportPct.textContent = `${pct}%`;
      exportStatus.textContent = `معالجة الإطار ${i + 1} من ${totalFrames} (${pct}%)`;
    }

    exportStatus.textContent = 'جاري تجميع الملف وتحميله...';
    gif.finish();

    // إنشاء وتنزيل ملف الـ GIF
    const blob = new Blob([gif.bytes()], { type: 'image/gif' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    const cleanBase = (fileNameEl.textContent || 'alnawara').replace(/\.[^/.]+$/, '');
    a.download = `ALNAWARA_${cleanBase}_${Date.now()}.gif`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);

    exportStatus.textContent = '✅ تم التصدير والتحميل بنجاح!';
  } catch (err) {
    console.error('فشل تصدير GIF:', err);
    exportStatus.textContent = '❌ حدث خطأ أثناء التصدير: ' + err.message;
  } finally {
    state.exporting = false;
    exportBtn.disabled = false;
    mobileExportBtn.disabled = false;
    video.currentTime = state.trimStart;
    video.play().catch(() => {});
    playIcon.textContent = '⏸';
  }
}

exportBtn.addEventListener('click', exportTransparentGif);
mobileExportBtn.addEventListener('click', exportTransparentGif);

// بدء الاستماع للملفات عند تحميل الصفحة
setupFileLoading();
