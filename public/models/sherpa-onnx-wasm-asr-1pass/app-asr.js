// This file copies and modifies code
// from https://mdn.github.io/web-dictaphone/scripts/app.js
// and https://gist.github.com/meziantou/edb7217fddfbb70e899e

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const soundClips = document.getElementById('sound-clips');

let textArea = document.getElementById('results');
const twoPassToggle = document.getElementById('twoPassToggle');
const twoPassStatusPill = document.getElementById('twoPassStatusPill');
const twoPassBackendSelect = document.getElementById('twoPassBackend');
const translationToggle = document.getElementById('translationToggle');
const translationDirectionSelect = document.getElementById('translationDirection');
const translationStatusPill = document.getElementById('translationStatusPill');
const tabButtons = document.querySelectorAll('[data-tab-target]');
const tabPanels = document.querySelectorAll('[data-tab-panel]');
const fileDropzone = document.getElementById('fileDropzone');
const fileBrowseBtn = document.getElementById('fileBrowseBtn');
const filePicker = document.getElementById('filePicker');
const fileTaskList = document.getElementById('fileTaskList');
const fileStatusLabel = document.getElementById('fileStatusLabel');
const fileClearBtn = document.getElementById('fileClearBtn');
const vadModeInputs = document.querySelectorAll('input[name="vadMode"]');
const vadModeStatusPill = document.getElementById('vadModeStatus');
const vadAssetHint = document.getElementById('vadAssetHint');
const onlineModelInputs = document.querySelectorAll('input[name="onlineModel"]');
const onlineModelStatusPill = document.getElementById('onlineModelStatus');
const onlineModelAssetHint = document.getElementById('onlineModelAssetHint');
let fileEmptyHint = document.getElementById('fileEmptyHint');
const clipboardAvailable = typeof navigator !== 'undefined' &&
    navigator.clipboard && typeof navigator.clipboard.writeText === 'function';
let activeWorkspaceTab = 'realtime';
const saveRecordingToggle = document.getElementById('saveRecordingToggle');
const mobileNoticeMask = document.getElementById('mobileNoticeMask');
const mobileNoticeClose = document.getElementById('mobileNoticeClose');
const sidebarToggle = document.getElementById('sidebarToggle');

let lastResult = '';
let lastRawResult = '';
let lastPunctuatedResult = '';
let resultList = [];
let offlineWorker = null;
let offlineWorkerReady = null;
let offlineWorkerReadyResolve = null;
let offlineWorkerReadyReject = null;
let offlineWorkerReadyResolved = false;
let offlineJobCounter = 0;
const offlinePendingJobs = new Map();
const offlineDispatchQueue = [];
let twoPassRuntime = 'wasm';
let currentSegmentSamples = [];
let currentSegmentSampleCount = 0;
let transcriptCounter = 0;
const segmentOverlapSeconds = 0.30;  // keep ~300 ms for the next segment
const offlineSegmentPolicy = {
  minSeconds: 2.4,      // SenseVoice is more stable with >2 s of audio
  maxSeconds: 18,       // keep latency bounded
  maxBufferAgeMs: 6000  // force flush if silence lasts ~6s
};
let pendingOfflineSegment = null;
let pendingOfflineFlushTimer = null;
let pendingSegmentCarry = null;
let vadDetector = null;
let vadBuffer = null;
let vadEnabled = false;
let vadConfig = null;
const vadAvailability = {silero : false, ten : false};
let preferredVadMode = 'silero';
let activeVadMode = 'off';
let punctuationEngine = null;
let punctuationReady = false;
let punctuationInitAttempted = false;
let punctuationAssetsMissing = false;
const silenceParagraphThresholdMs = 5000;
const vadParagraphLimit = 10;
let lastSegmentTimestampMs = null;
let lastSpeechActivityMs = null;
let vadSegmentsSinceBreak = 0;
let lastParagraphBreakReason = null;  // 记录最后一次换行的原因
const translationEntryQueue = [];
let translationEntryActive = false;
const translationAbortControllers = new Set();
let lastTranslatedWordCount = 0;  // 记录上次触发翻译时的单词数
const translationWordThreshold = 15;  // 每增加15个单词触发翻译
const webgpuAvailable = typeof navigator !== 'undefined' &&
    typeof navigator.gpu !== 'undefined';
const twoPassConfig = {
  enabled: twoPassToggle ? twoPassToggle.checked : true,
  backend: twoPassBackendSelect ? twoPassBackendSelect.value : 'wasm',
};
const translationConfig = {
  endpoint: 'http://localhost:8080/v1/chat/completions',
  apiKey: 'rtk_iJ1THfYXI2XldOCHRLIGnvjVilikIju7',
  model: 'deepseek-v3.1',
  enabled: translationToggle ? translationToggle.checked : false,
  direction: translationDirectionSelect ? translationDirectionSelect.value : 'en-zh',
  activeJobs: 0,
  lastError: '',
};
const onlineModelSpecs = {
  zipformer: {
    label: 'Zipformer',
    type: 'transducer',
    assets: [
      {slot: 'encoder', paths: [ 'encoder.onnx' ], label: 'encoder.onnx'},
      {slot: 'decoder', paths: [ 'decoder.onnx' ], label: 'decoder.onnx'},
      {slot: 'joiner', paths: [ 'joiner.onnx' ], label: 'joiner.onnx'},
      {slot: 'tokens', paths: [ 'tokens.txt' ], label: 'tokens.txt'},
    ],
    tokens: './tokens.txt',
    hint: '使用 encoder/decoder/joiner（Zipformer）',
  },
  paraformer: {
    label: 'Paraformer',
    type: 'paraformer',
    assets: [
      {
        slot: 'encoder',
        paths: [ 'paraformer-encoder.int8.onnx', 'paraformer-encoder.onnx' ],
        label: 'paraformer-encoder(.int8).onnx',
      },
      {
        slot: 'decoder',
        paths: [ 'paraformer-decoder.int8.onnx', 'paraformer-decoder.onnx' ],
        label: 'paraformer-decoder(.int8).onnx',
      },
      {
        slot: 'tokens',
        paths: [ 'paraformer-tokens.txt' ],
        label: 'paraformer-tokens.txt',
      },
    ],
    tokens: './paraformer-tokens.txt',
    hint: '使用 paraformer-encoder/decoder.int8 + paraformer-tokens.txt',
  },
};
const onlineModelAvailability = {zipformer : false, paraformer : false};
const onlineModelMissing = {zipformer : [], paraformer : []};
const resolvedOnlineModelPaths = {
  zipformer: {
    encoder: './encoder.onnx',
    decoder: './decoder.onnx',
    joiner: './joiner.onnx',
    tokens: './tokens.txt',
  },
  paraformer: {
    encoder: './paraformer-encoder.int8.onnx',
    decoder: './paraformer-decoder.int8.onnx',
    tokens: './paraformer-tokens.txt',
  },
};
let activeOnlineModel = 'zipformer';
const waveformCanvas = document.getElementById('waveformCanvas');
let waveformCtx = waveformCanvas ? waveformCanvas.getContext('2d') : null;
const hasWindow = typeof window !== 'undefined';
const canAnimateWaveform =
    hasWindow && typeof window.requestAnimationFrame === 'function' &&
    typeof window.cancelAnimationFrame === 'function';
const waveformRequestAnimationFrame =
    canAnimateWaveform ? window.requestAnimationFrame.bind(window) : null;
const waveformCancelAnimationFrame =
    canAnimateWaveform ? window.cancelAnimationFrame.bind(window) : null;
const waveformPoints = [];
const waveformWindowSeconds = 5;
const waveformMaxPoints = 1200;
let waveformAnimationHandle = null;
let waveformActive = false;
let waveformEnabled = false;
const waveformFallbackSize = {width: 240, height: 110};
const supportedFileExtensions =
    [ 'mp3', 'mp4', 'm4a', 'wav', 'aac', 'ogg', 'opus', 'webm', 'flac' ];
let fileJobs = [];
let fileJobSeq = 0;
let fileJobProcessing = false;
let decodingAudioContext = null;
let wasmRuntimeReady = false;
bootstrapWorkspaceUi();
function getModuleSafe() {
  return (typeof Module !== 'undefined') ? Module : null;
}
function getNowSeconds() {
  if (hasWindow && window.performance &&
      typeof window.performance.now === 'function') {
    return window.performance.now() / 1000;
  }
  return Date.now() / 1000;
}
function resizeWaveformCanvas() {
  if (!waveformCanvas) {
    return;
  }
  const rect = waveformCanvas.getBoundingClientRect();
  const targetWidth =
      rect.width > 0 ? rect.width : waveformFallbackSize.width;
  const targetHeight =
      rect.height > 0 ? rect.height : waveformFallbackSize.height;
  if (waveformCanvas.width !== targetWidth) {
    waveformCanvas.width = targetWidth;
  }
  if (waveformCanvas.height !== targetHeight) {
    waveformCanvas.height = targetHeight;
  }
}
function clearWaveformCanvas() {
  if (!waveformCanvas || !waveformCtx) {
    return;
  }
  resizeWaveformCanvas();
  const width = waveformCanvas.width || waveformFallbackSize.width;
  const height = waveformCanvas.height || waveformFallbackSize.height;
  waveformCtx.clearRect(0, 0, width, height);
  const mid = height / 2;
  waveformCtx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
  waveformCtx.lineWidth = 1;
  waveformCtx.beginPath();
  waveformCtx.moveTo(0, mid);
  waveformCtx.lineTo(width, mid);
  waveformCtx.stroke();
}
function renderWaveform() {
  waveformAnimationHandle = null;
  if (!waveformCanvas || !waveformCtx) {
    return;
  }
  resizeWaveformCanvas();
  const width = waveformCanvas.width || waveformFallbackSize.width;
  const height = waveformCanvas.height || waveformFallbackSize.height;
  waveformCtx.clearRect(0, 0, width, height);
  const mid = height / 2;
  waveformCtx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  waveformCtx.lineWidth = 1;
  waveformCtx.beginPath();
  waveformCtx.moveTo(0, mid);
  waveformCtx.lineTo(width, mid);
  waveformCtx.stroke();
  if (waveformPoints.length > 0) {
    const padding = Math.max(4, height * 0.15);
    const nowSeconds = getNowSeconds();
    const startTime = nowSeconds - waveformWindowSeconds;
    waveformCtx.lineWidth = 2;
    waveformCtx.strokeStyle = 'rgba(37, 99, 235, 0.8)';
    waveformCtx.beginPath();
    for (let i = 0; i < waveformPoints.length; ++i) {
      const point = waveformPoints[i];
      const normalizedTime =
          waveformWindowSeconds > 0 ?
              (point.time - startTime) / waveformWindowSeconds :
              0;
      const x = Math.max(0, Math.min(width, normalizedTime * width));
      const amplitude = Math.max(-1, Math.min(1, point.value));
      const y = mid - amplitude * (mid - padding);
      if (i === 0) {
        waveformCtx.moveTo(x, y);
      } else {
        waveformCtx.lineTo(x, y);
      }
    }
    waveformCtx.stroke();
  }
  if (waveformActive && canAnimateWaveform && waveformRequestAnimationFrame) {
    waveformAnimationHandle = waveformRequestAnimationFrame(renderWaveform);
  }
}
function scheduleWaveformRender() {
  if (!waveformActive || !waveformEnabled) {
    return;
  }
  if (waveformAnimationHandle) {
    return;
  }
  if (canAnimateWaveform && waveformRequestAnimationFrame) {
    waveformAnimationHandle = waveformRequestAnimationFrame(renderWaveform);
    return;
  }
  renderWaveform();
}
function pushWaveformSamples(samples) {
  if (!waveformEnabled || !waveformCanvas || !waveformCtx ||
      samples.length === 0) {
    return;
  }
  const nowSeconds = getNowSeconds();
  const chunkDuration = expectedSampleRate > 0 ?
      samples.length / expectedSampleRate :
      0;
  const startTime = nowSeconds - chunkDuration;
  const bucketCount = Math.min(64, samples.length);
  if (bucketCount === 0) {
    return;
  }
  const step = samples.length / bucketCount;
  for (let i = 0; i < bucketCount; ++i) {
    const idx = Math.min(samples.length - 1, Math.floor(i * step));
    const rawSample = samples[idx];
    const pointTime =
        bucketCount > 1 ?
            startTime + (i / (bucketCount - 1)) * chunkDuration :
            nowSeconds;
    waveformPoints.push(
       {value: Math.max(-1, Math.min(1, rawSample)), time: pointTime});
  }
  const oldestAllowed = nowSeconds - waveformWindowSeconds;
  while (waveformPoints.length > 0 &&
         (waveformPoints[0].time < oldestAllowed ||
          waveformPoints.length > waveformMaxPoints)) {
    waveformPoints.shift();
  }
  scheduleWaveformRender();
}
function startWaveformAnimation() {
  if (!waveformEnabled || !waveformCanvas || !waveformCtx) {
    return;
  }
  waveformActive = true;
  resetWaveformDisplay();
  resizeWaveformCanvas();
  scheduleWaveformRender();
}
function stopWaveformAnimation(options = {}) {
  if (!waveformCanvas || !waveformCtx) {
    return;
  }
  waveformActive = false;
  if (waveformAnimationHandle) {
    if (canAnimateWaveform && waveformCancelAnimationFrame) {
      waveformCancelAnimationFrame(waveformAnimationHandle);
    }
    waveformAnimationHandle = null;
  }
  if (options.clear) {
    resetWaveformDisplay();
  }
}
function resetWaveformDisplay() {
  waveformPoints.length = 0;
  clearWaveformCanvas();
}
if (hasWindow && waveformCanvas) {
  window.addEventListener('resize', () => {
    resizeWaveformCanvas();
    if (!waveformActive) {
      clearWaveformCanvas();
    }
  });
  clearWaveformCanvas();
}
const translationInitiallyEnabled = translationConfig.enabled;
translationConfig.enabled = false;
const streamingPreviewEntry = {
  id: 'streaming-preview',
  streaming: '',
  offline: '',
  reason: 'preview',
  paragraphBreak: false,
};
// 只匹配真正的句子结束标点：句号、感叹号、问号（去除逗号）
const streamingPunctuationRegex = /[。！？!?\.]+$/;
if (twoPassBackendSelect) {
  if (!webgpuAvailable) {
    const option = twoPassBackendSelect.querySelector('option[value="ort-webgpu"]');
    if (option) {
      option.disabled = true;
      option.textContent = 'WebGPU (not available)';
    }
  }
  twoPassBackendSelect.addEventListener('change', (event) => {
    const next = event.target.value || 'wasm';
    if (twoPassConfig.backend === next) {
      return;
    }
    twoPassConfig.backend = next;
    refreshTwoPassStatusPill();
    // Restart worker on backend switch
    if (offlineWorker) {
      resetOfflineWorkerState();
    }
    if (twoPassConfig.enabled) {
      initOfflineRecognizer();
    }
  });
}
if (twoPassToggle) {
  twoPassToggle.addEventListener('change', (event) => {
    twoPassConfig.enabled = event.target.checked;
    refreshTwoPassStatusPill();
    console.log(`[TwoPass] ${twoPassConfig.enabled ? 'Enabled' : 'Disabled'}`);

    // 关闭 two-pass 时释放 Worker 以节省内存
    if (!twoPassConfig.enabled && offlineWorker) {
      console.log('[TwoPass] Releasing offline worker to free memory...');
      resetOfflineWorkerState();
    }
  });
}
if (translationToggle) {
  translationToggle.addEventListener('change', (event) => {
    if (event.target.checked) {
      enableTranslation();
    } else {
      disableTranslation();
    }
  });
}
if (translationDirectionSelect) {
  translationDirectionSelect.addEventListener('change', (event) => {
    translationConfig.direction = event.target.value || 'en-zh';
    if (translationConfig.enabled) {
      translationConfig.lastError = '';
      refreshTranslationStatusPill();
      refreshAllEntryTranslations(true);
      refreshTranscript();
    }
  });
}
refreshTwoPassStatusPill();
if (translationInitiallyEnabled) {
  enableTranslation();
} else {
  refreshTranslationStatusPill();
}

const initiallyCheckedModel =
    Array.from(onlineModelInputs || []).find(
        (input) =>
            input && input.checked && onlineModelSpecs[input.value]);
if (initiallyCheckedModel) {
  activeOnlineModel = initiallyCheckedModel.value;
}
if (onlineModelInputs && onlineModelInputs.length > 0) {
  onlineModelInputs.forEach((input) => {
    input.addEventListener('change', (event) => {
      if (event.target.checked) {
        applyOnlineModelSelection(event.target.value);
      }
    });
  });
}
refreshOnlineModelStatus();

function refreshTranscript() {
  textArea.value = getDisplayResult();
  textArea.scrollTop = textArea.scrollHeight;
}

clearBtn.onclick = function() {
  resultList = [];
  resetStreamingPreview();
  resetTranslationState();
  resetSegmentSamples();
  transcriptCounter = 0;
  pendingSegmentCarry = null;
  resetPendingOfflineSegment();
  resetVadDetectors();
  lastSegmentTimestampMs = null;
  lastSpeechActivityMs = null;
  vadSegmentsSinceBreak = 0;
  lastTranslatedWordCount = 0;  // 重置翻译单词计数
  resetWaveformDisplay();
  refreshTranscript();
};

function getDisplayResult() {
  const lines = [];
  let paragraph = [];
  let paragraphReason = null;  // 当前段落的分隔理由（创建时确定，不可修改）
  // 下一个段落的分隔理由（由上一个 paragraphBreak 的 entry 提供）
  // 第一个段落使用 'start' 作为初始标签
  let nextParagraphReason = 'start';

  function pushParagraph() {
    if (paragraph.length === 0) {
      return;
    }
    // 合并段落内的所有文本为一行
    let paragraphText = paragraph.join('');
    // 如果有原因标签，在段落前面添加
    if (paragraphReason) {
      paragraphText = `[${paragraphReason}] ${paragraphText}`;
    }
    lines.push(paragraphText);
    lines.push('');  // 段落后空一行
    paragraph = [];
    paragraphReason = null;
  }

  for (let i = 0; i < resultList.length; ++i) {
    const item = resultList[i];
    if (!item) {
      continue;
    }
    const offlineText = (item.offline || '').trim();
    const streamingText = (item.streaming || '').trim();
    const text = offlineText.length > 0 ? offlineText : streamingText;
    if (text.length > 0) {
      // 如果是新段落的第一项，使用预设的分隔理由（创建时确定，不可修改）
      if (paragraph.length === 0) {
        paragraphReason = nextParagraphReason;
        nextParagraphReason = null;  // 已使用，清空
      }
      paragraph.push(text);
    }
    const translationLine = buildEntryTranslationLine(item);
    if (translationLine.length > 0) {
      paragraph.push(translationLine);
    }
    if (item.paragraphBreak) {
      // 记录这次换行的原因，作为下一个段落的分隔理由
      nextParagraphReason = item.reason;
      lastParagraphBreakReason = item.reason;
      pushParagraph();
    }
  }

  const preview = (lastResult || '').trim();
  if (preview.length > 0) {
    // 如果预览文本是新段落的开始，使用预设的分隔理由
    if (paragraph.length === 0) {
      paragraphReason = nextParagraphReason || lastParagraphBreakReason;
    }
    paragraph.push(preview);
    const previewTranslationLine = buildPreviewTranslationLine();
    if (previewTranslationLine.length > 0) {
      paragraph.push(previewTranslationLine);
    }
  }

  pushParagraph();
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n');
}

function buildEntryTranslationLine(entry) {
  if (!translationConfig.enabled) {
    return '';
  }
  const translationState = ensureEntryTranslationState(entry);
  if (!translationState) {
    return '';
  }
  if (translationState.text && translationState.text.length > 0) {
    return formatTranslationLine(translationState.text);
  }
  if (translationState.status === 'waiting-offline') {
    return ``//`等待2-pass结果以生成${getTranslationTargetLabel()}翻译…`;
  }
  if (translationState.status === 'offline-missing') {
    return `无法翻译：当前段落没有2-pass结果`;
  }
  if (translationState.status === 'offline-empty') {
    return `2-pass 没有输出文本，跳过${getTranslationTargetLabel()}翻译`;
  }
  if (translationState.status === 'translating' && translationState.source) {
    return ``//`Translating → ${getTranslationTargetLabel()}: ${translationState.source}`;
  }
  if (translationState.status === 'queued' && translationState.source) {
    return ``//`Queued for ${getTranslationTargetLabel()}: ${translationState.source}`;
  }
  if (translationState.status === 'error' && translationState.error) {
    return `Translation error (${getTranslationTargetLabel()}): ${translationState.error}`;
  }
  return '';
}

function buildPreviewTranslationLine() {
  if (!translationConfig.enabled) {
    return '';
  }
  const translationState = ensureEntryTranslationState(streamingPreviewEntry);
  if (!translationState || !translationState.source) {
    return '';
  }
  if (translationState.text && translationState.text.length > 0) {
    return formatTranslationLine(translationState.text);
  }
  if (translationState.status === 'translating' && translationState.source) {
    return ``//`Translating preview → ${getTranslationTargetLabel()}: ${translationState.source}`;
  }
  if (translationState.status === 'queued' && translationState.source) {
    return ``//`Queued preview ${getTranslationTargetLabel()}: ${translationState.source}`;
  }
  if (translationState.status === 'error' && translationState.error) {
    return `Preview translation error (${getTranslationTargetLabel()}): ${translationState.error}`;
  }
  return '';
}

function formatTranslationLine(text) {
  return text || '';
}

function snapshotPreviewTranslationState() {
  if (!translationConfig.enabled) {
    return null;
  }
  const state = streamingPreviewEntry.translation;
  if (!state) {
    return null;
  }
  return {
    text: state.text || '',
    source: state.source || '',
    status: state.status || 'idle',
    error: state.error || '',
  };
}

function applyPreviewTranslationSnapshot(entry, snapshot) {
  if (!translationConfig.enabled || !entry || !snapshot) {
    return;
  }
  const hasText = snapshot.text && snapshot.text.length > 0;
  const hasSource = snapshot.source && snapshot.source.length > 0;
  if (!hasText && !hasSource) {
    return;
  }
  const translationState = ensureEntryTranslationState(entry);
  translationState.text = snapshot.text || '';
  translationState.source = snapshot.source || '';
  translationState.status = hasText ? 'done' : snapshot.status || 'idle';
  translationState.error = snapshot.error || '';
}

function resetPreviewTranslationState() {
  const translationState = ensureEntryTranslationState(streamingPreviewEntry);
  if (!translationState) {
    return;
  }
  translationState.text = '';
  translationState.source = '';
  translationState.status = 'idle';
  translationState.error = '';
  translationState.seq += 1;
  translationState.pendingSource = '';
  translationState.pendingForce = false;
}

function refreshPreviewTranslation(force = false) {
  if (!translationConfig.enabled) {
    return;
  }
  const translationState = streamingPreviewEntry.translation;
  const source = translationState && translationState.source ? translationState.source.trim() : '';
  if (source.length === 0) {
    return;
  }
  scheduleEntryTranslation(streamingPreviewEntry, {force: force === true, sourceText: source});
}

function hasSentenceEndingPunctuation(text) {
  if (!text) {
    return false;
  }
  return streamingPunctuationRegex.test(text.trim());
}

function countWords(text) {
  if (!text || text.trim().length === 0) {
    return 0;
  }
  const trimmed = text.trim();
  // 中文字符数 + 英文单词数
  const cjkCount = (trimmed.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = trimmed.replace(/[\u4e00-\u9fa5]/g, ' ').trim();
  const englishCount = englishWords.length > 0 ? englishWords.split(/\s+/).filter(w => w.length > 0).length : 0;
  return cjkCount + englishCount;
}

function maybeTriggerStreamingTranslation(punctuatedText) {
  if (!translationConfig.enabled) {
    return;
  }
  const trimmed = (punctuatedText || '').trim();
  if (trimmed.length === 0) {
    return;
  }
  
  const currentWordCount = countWords(trimmed);
  const wordDelta = currentWordCount - lastTranslatedWordCount;
  
  // 策略：每增加5个单词触发翻译，或者遇到句子结束标点
  const hasSentenceEnd = false;//hasSentenceEndingPunctuation(trimmed);
  const hasEnoughNewWords = wordDelta >= translationWordThreshold;
  
  console.log('[Translation Trigger]', {
    text: trimmed.substring(0, 30) + '...',
    currentWords: currentWordCount,
    lastWords: lastTranslatedWordCount,
    wordDelta: wordDelta,
    hasSentenceEnd: hasSentenceEnd,
    hasEnoughNewWords: hasEnoughNewWords,
    willTrigger: hasSentenceEnd || hasEnoughNewWords
  });
  
  if (!hasSentenceEnd && !hasEnoughNewWords) {
    return;
  }
  
  const translationState = ensureEntryTranslationState(streamingPreviewEntry);
  if (!translationState) {
    return;
  }
  if (translationState.source === trimmed &&
      (translationState.status === 'done' ||
       translationState.status === 'translating' ||
       translationState.status === 'queued')) {
    console.log('[Translation Trigger] Skipped: already translating same text');
    return;
  }
  
  // 更新上次翻译的单词数
  lastTranslatedWordCount = currentWordCount;
  console.log('[Translation Trigger] ✓ Triggered translation');
  scheduleEntryTranslation(streamingPreviewEntry, {force: true, sourceText: trimmed});
}

function getTranslationTargetLabel() {
  if (translationConfig.direction === 'zh-en') {
    return 'English';
  }
  return '中文';
}

function determineEntrySourceText(entry) {
  if (!entry) {
    return '';
  }
  const offlineText = (entry.offline || '').trim();
  return offlineText;
}

function ensureEntryTranslationState(entry) {
  if (!entry) {
    return null;
  }
  if (!entry.translation) {
    entry.translation = {
      text: '',
      source: '',
      status: 'idle',
      error: '',
      seq: 0,
      controller: null,  // 添加 abort controller
      pendingSource: '',
      pendingForce: false,
    };
  }
  return entry.translation;
}

function scheduleEntryTranslation(entry, options = {}) {
  if (!entry) {
    return;
  }
  const translationState = ensureEntryTranslationState(entry);
  if (!translationState) {
    return;
  }
  const sourceOverride =
      typeof options.sourceText === 'string' ? options.sourceText : null;
  const sourceText =
      (sourceOverride !== null ? sourceOverride : determineEntrySourceText(entry)).trim();
  const force = options.force === true;

  if (!translationConfig.enabled) {
    translationState.source = sourceText;
    translationState.text = '';
    translationState.status = 'idle';
    translationState.error = '';
    translationState.pendingSource = '';
    translationState.pendingForce = false;
    refreshTranscript();
    return;
  }

  if (sourceText.length === 0) {
    translationState.source = '';
    translationState.text = '';
    translationState.status = translationConfig.enabled ? 'waiting-offline' : 'idle';
    translationState.error = '';
    translationState.pendingSource = '';
    translationState.pendingForce = false;
    refreshTranscript();
    return;
  }

  const isTranslating = translationState.status === 'translating';
  if (!force && translationState.source === sourceText &&
      (translationState.status === 'done' || isTranslating)) {
    return;
  }

  if (isTranslating) {
    translationState.pendingSource = sourceText;
    translationState.pendingForce = force;
    translationState.source = sourceText;
    translationState.error = '';
    return;
  }

  translationState.source = sourceText;
  translationState.seq += 1;
  translationState.status = 'queued';
  translationState.error = '';
  translationState.pendingSource = '';
  translationState.pendingForce = false;
  enqueueEntryTranslationJob(entry, sourceText, translationState.seq);
  refreshTranslationStatusPill();
}

function enqueueEntryTranslationJob(entry, text, seq) {
  // 智能去重：如果队列中已有同一 entry 的待处理任务，先移除旧的
  const existingIndex = translationEntryQueue.findIndex(job => job.entry === entry);
  if (existingIndex !== -1) {
    translationEntryQueue.splice(existingIndex, 1);
  }
  translationEntryQueue.push({entry, text, seq});
  processEntryTranslationQueue();
}

async function processEntryTranslationQueue() {
  if (translationEntryActive || !translationConfig.enabled) {
    return;
  }
  translationEntryActive = true;
  while (translationEntryQueue.length > 0 && translationConfig.enabled) {
    const job = translationEntryQueue.shift();
    if (!job || !job.entry) {
      continue;
    }
    await runEntryTranslationJob(job);
  }
  translationEntryActive = false;
}

async function runEntryTranslationJob(job) {
  const entry = job.entry;
  if (!translationConfig.enabled || !entry) {
    return;
  }
  const translationState = ensureEntryTranslationState(entry);
  if (!translationState || translationState.seq !== job.seq) {
    return;
  }
  translationState.status = 'translating';
  translationState.error = '';
  translationConfig.activeJobs += 1;
  refreshTranslationStatusPill();

  const controller = new AbortController();
  translationAbortControllers.add(controller);
  translationState.controller = controller;  // 保存到 state 中

  try {
    const rawTranslation =
        await translateText(job.text, translationConfig.direction, controller.signal);
    const translated =
        cleanTranslationOutput(rawTranslation, translationConfig.direction);
    if (!translationConfig.enabled) {
      return;
    }
    if (translationState.seq === job.seq) {
      translationState.text = translated;
      translationState.status = 'done';
      translationConfig.lastError = '';
    }
  } catch (err) {
    if (controller.signal.aborted) {
      translationState.status = 'idle';
      return;
    }
    const message = (err && err.message) ? err.message : 'Translation failed';
    translationState.status = 'error';
    translationState.error = message;
    translationConfig.lastError = message;
  } finally {
    translationAbortControllers.delete(controller);
    if (translationState.controller === controller) {
      translationState.controller = null;  // 清理
    }
    translationConfig.activeJobs = Math.max(0, translationConfig.activeJobs - 1);
    const pendingSource = translationState.pendingSource || '';
    const pendingForce = translationState.pendingForce === true;
    translationState.pendingSource = '';
    translationState.pendingForce = false;
    refreshTranscript();
    refreshTranslationStatusPill();
    if (pendingSource.length > 0 && translationConfig.enabled) {
      scheduleEntryTranslation(entry, {force: pendingForce, sourceText: pendingSource});
    }
  }
}

async function translateText(text, direction, signal = null) {
  const trimmed = clampTextForTranslation(text || '');
  if (trimmed.length === 0) {
    return '';
  }
  if (!translationConfig.apiKey) {
    throw new Error('Missing translation API key');
  }
  const prompt = buildTranslationPrompt(direction, trimmed);
  const payload = {
    model: translationConfig.model,
    messages: [
      {role: 'system', content: prompt.systemPrompt},
      {role: 'user', content: prompt.userContent},
    ],
    max_tokens: 512,
    temperature: 0.2,
    stream: false,
  };
  const response = await fetch(translationConfig.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${translationConfig.apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: signal || undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data && data.error && data.error.message) ?
        data.error.message : `Translation request failed (${response.status})`;
    throw new Error(message);
  }
  const choice = data && data.choices && data.choices[0];
  const translated = (choice && typeof choice.text === 'string') ?
      choice.text :
      (choice && choice.message && choice.message.content) || '';
  return (translated || '').trim();
}

function buildTranslationPrompt(direction, text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const baseInstruction =
      'You are a realtime interpreter. Reply with the translation only—no explanations.';
  if (direction === 'zh-en') {
    return {
      systemPrompt:
          `${baseInstruction} Translate Chinese speech into clear, modern English.`,
      userContent: `Transcript:\n${normalized}`,
    };
  }
  return {
    systemPrompt:
        `${baseInstruction} Translate English speech into concise, natural Chinese.`,
    userContent: `Transcript:\n${normalized}`,
  };
}

function cleanTranslationOutput(text, direction) {
  if (!text) {
    return '';
  }
  let cleaned = text.trim();

  const instructionRegex = /(you are a realtime interpreter[\s\S]*?)(中文:|English:)/i;
  cleaned = cleaned.replace(instructionRegex, '');

  const marker = direction === 'zh-en' ? 'English:' : '中文:';
  const markerIndex = cleaned.lastIndexOf(marker);
  if (markerIndex !== -1) {
    cleaned = cleaned.slice(markerIndex + marker.length).trim();
  }

  cleaned = cleaned.replace(/^(Translation|译文)\s*[:：]\s*/i, '');
  cleaned = cleaned.replace(/\s+\n/g, '\n').trim();

  return cleaned.length > 0 ? cleaned : text.trim();
}

function clampTextForTranslation(text) {
  const normalized = (text || '').trim();
  const limit = 1200;
  if (normalized.length <= limit) {
    return normalized;
  }
  return normalized.slice(normalized.length - limit);
}

function resetTranslationState() {
  translationEntryQueue.length = 0;
  translationEntryActive = false;
  translationAbortControllers.forEach((controller) => controller.abort());
  translationAbortControllers.clear();
  translationConfig.lastError = '';
  translationConfig.activeJobs = 0;
  for (let i = 0; i < resultList.length; ++i) {
    const entry = resultList[i];
    if (!entry) {
      continue;
    }
    const translationState = ensureEntryTranslationState(entry);
    translationState.text = '';
    translationState.source = '';
    translationState.status = 'idle';
    translationState.error = '';
    translationState.seq += 1;
    translationState.pendingSource = '';
    translationState.pendingForce = false;
  }
  resetPreviewTranslationState();
  refreshTranslationStatusPill();
  refreshTranscript();
}

function refreshAllEntryTranslations(force = false) {
  if (!translationConfig.enabled) {
    refreshTranscript();
    return;
  }
  for (let i = 0; i < resultList.length; ++i) {
    const entry = resultList[i];
    if (!entry) {
      continue;
    }
    scheduleEntryTranslation(entry, {force});
  }
  refreshPreviewTranslation(force);
}

function enableTranslation() {
  if (translationConfig.enabled) {
    return;
  }
  translationConfig.enabled = true;
  translationConfig.lastError = '';
  lastTranslatedWordCount = 0;  // 启用翻译时重置计数
  refreshTranslationStatusPill();
  refreshAllEntryTranslations(true);
  maybeTriggerStreamingTranslation(lastPunctuatedResult);
  refreshTranscript();
}

function disableTranslation() {
  if (!translationConfig.enabled) {
    return;
  }
  translationConfig.enabled = false;
  translationEntryQueue.length = 0;
  translationEntryActive = false;
  translationAbortControllers.forEach((controller) => controller.abort());
  translationAbortControllers.clear();
  translationConfig.activeJobs = 0;
  translationConfig.lastError = '';
  for (let i = 0; i < resultList.length; ++i) {
    const entry = resultList[i];
    if (!entry || !entry.translation) {
      continue;
    }
    entry.translation.text = '';
    entry.translation.source = '';
    entry.translation.status = 'idle';
    entry.translation.error = '';
    entry.translation.pendingSource = '';
    entry.translation.pendingForce = false;
  }
  resetPreviewTranslationState();
  refreshTranslationStatusPill();
  refreshTranscript();
}

function refreshTwoPassStatusPill() {
  if (!twoPassStatusPill) {
    return;
  }
  if (twoPassConfig.enabled) {
    const label = twoPassRuntime === 'ort-webgpu' ? 'WebGPU (ORT)' : 'WASM';
    twoPassStatusPill.textContent = `Enabled · ${label}`;
    twoPassStatusPill.className = 'status-pill active';
  } else {
    twoPassStatusPill.textContent = 'Disabled';
    twoPassStatusPill.className = 'status-pill muted';
  }
}

function refreshTranslationStatusPill() {
  if (!translationStatusPill) {
    return;
  }
  if (!translationConfig.enabled) {
    translationStatusPill.textContent = 'Translation off';
    translationStatusPill.className = 'status-pill muted';
    return;
  }
  const hasError = Boolean(translationConfig.lastError);
  const isBusy = translationConfig.activeJobs > 0 || translationEntryQueue.length > 0;
  if (hasError) {
    translationStatusPill.textContent = truncateStatusMessage(`Error: ${translationConfig.lastError}`);
    translationStatusPill.className = 'status-pill error';
    return;
  }
  if (isBusy) {
    translationStatusPill.textContent = 'Translating…';
    translationStatusPill.className = 'status-pill active';
  } else {
    translationStatusPill.textContent = 'Listening………';
    translationStatusPill.className = 'status-pill active';
  }
}

function truncateStatusMessage(message, maxLen = 48) {
  if (!message) {
    return '';
  }
  if (message.length <= maxLen) {
    return message;
  }
  return `${message.slice(0, maxLen - 1)}…`;
}

function isMobileDevice() {
  const uaData = navigator.userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') {
    return uaData.mobile;
  }
  const ua = navigator.userAgent || '';
  return /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(ua);
}

function setupMobileNotice() {
  if (!mobileNoticeMask || !mobileNoticeClose) {
    return;
  }
  const hide = () => mobileNoticeMask.classList.remove('show');
  mobileNoticeClose.addEventListener('click', hide);
  if (isMobileDevice()) {
    mobileNoticeMask.classList.add('show');
  }
}

function setupSidebarToggle() {
  if (!sidebarToggle) {
    return;
  }
  const sidebars = Array.from(document.querySelectorAll('.sidebar'));
  const setCollapsed = (collapsed) => {
    sidebarToggle.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    sidebars.forEach((sidebar) => {
      sidebar.classList.toggle('collapsed', collapsed);
    });
  };
  sidebarToggle.addEventListener('click', () => {
    const collapsed = sidebarToggle.getAttribute('aria-pressed') === 'true';
    setCollapsed(!collapsed);
  });
}

function bootstrapWorkspaceUi() {
  const init = () => {
    try {
      setupWorkspaceTabs();
      setupFileUploadUi();
      setupVadControls();
      setupMobileNotice();
      setupSidebarToggle();
    } catch (err) {
      console.error('[Workspace] Failed to init tabs/upload UI', err);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {once : true});
  } else {
    init();
  }
}

function setupWorkspaceTabs() {
  if (!tabButtons || tabButtons.length === 0 || !tabPanels ||
      tabPanels.length === 0) {
    return;
  }
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab-target');
      if (!target) {
        return;
      }
      activateWorkspaceTab(target);
    });
  });
  if (!activeWorkspaceTab) {
    const defaultTab =
        (document.querySelector('.tab-btn.active') || tabButtons[0])
            ?.getAttribute('data-tab-target');
    activateWorkspaceTab(defaultTab || 'realtime', true);
  } else {
    activateWorkspaceTab(activeWorkspaceTab, true);
  }
}

function activateWorkspaceTab(target, force = false) {
  if (!target) {
    return;
  }
  if (!force && activeWorkspaceTab === target) {
    return;
  }

  activeWorkspaceTab = target;
  tabButtons.forEach((btn) => {
    const btnTarget = btn.getAttribute('data-tab-target');
    const isActive = btnTarget === target;
    btn.classList.toggle('active', isActive);
    if (isActive) {
      btn.setAttribute('aria-selected', 'true');
      btn.setAttribute('tabindex', '0');
    } else {
      btn.setAttribute('aria-selected', 'false');
      btn.setAttribute('tabindex', '-1');
    }
  });
  tabPanels.forEach((panel) => {
    const isActive = panel.getAttribute('data-tab-panel') === target;
    panel.classList.toggle('active', isActive);
    if (isActive) {
      panel.removeAttribute('aria-hidden');
    } else {
      panel.setAttribute('aria-hidden', 'true');
    }
  });
}

function setupFileUploadUi() {
  if (fileBrowseBtn && filePicker) {
    fileBrowseBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      filePicker.click();
    });
  }
  if (filePicker) {
    filePicker.addEventListener('change', (event) => {
      queueFileList(event.target.files || []);
      filePicker.value = '';
    });
  }
  if (fileDropzone) {
    const handleDrag = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      fileDropzone.classList.add('drag-over');
    };
    const clearDrag = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      fileDropzone.classList.remove('drag-over');
    };
    fileDropzone.addEventListener('dragenter', handleDrag);
    fileDropzone.addEventListener('dragover', handleDrag);
    fileDropzone.addEventListener('dragleave', clearDrag);
    fileDropzone.addEventListener('drop', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      fileDropzone.classList.remove('drag-over');
      queueFileList(evt.dataTransfer ? evt.dataTransfer.files : []);
    });
    fileDropzone.addEventListener('click', (event) => {
      if (event.target.closest('button, input, select, textarea')) {
        return;
      }
      if (filePicker) {
        event.preventDefault();
        filePicker.click();
      }
    });
  }
  if (fileClearBtn) {
    fileClearBtn.addEventListener('click', () => {
      const remaining = [];
      fileJobs.forEach((job) => {
        if (job.status === 'done' || job.status === 'error') {
          disposeFileJob(job);
          if (job.ui?.container && job.ui.container.parentNode) {
            job.ui.container.parentNode.removeChild(job.ui.container);
          }
        } else {
          remaining.push(job);
        }
      });
      fileJobs = remaining;
      if (fileJobs.length === 0) {
        restoreFileEmptyHint();
      }
      updateFileStatusDisplay();
    });
  }
}

function setupVadControls() {
  const radios = Array.from(vadModeInputs || []);
  if (radios.length === 0) {
    return;
  }
  let detectedMode = preferredVadMode;
  radios.forEach((input) => {
    if (input.checked) {
      detectedMode = input.value || detectedMode;
    }
    input.addEventListener('change', () => {
      if (!input.checked) {
        return;
      }
      preferredVadMode = input.value || 'silero';
      if (wasmRuntimeReady) {
        initVadEngine(preferredVadMode, {forceRecreate : true});
      } else {
        refreshVadUiState();
      }
    });
  });
  preferredVadMode = detectedMode;
  refreshVadUiState();
}

function queueFileList(fileList) {
  if (!fileList || !fileTaskList) {
    return;
  }
  const files = Array.from(fileList);
  if (files.length === 0) {
    return;
  }
  removeFileEmptyHint();
  const accepted = files.filter((file) => isSupportedAudioFile(file));
  const rejectedCount = files.length - accepted.length;
  if (rejectedCount > 0) {
    console.warn(`[File-ASR] ${rejectedCount} file(s) skipped (unsupported).`);
  }
  accepted.forEach((file) => addFileJob(file));
  if (accepted.length > 0) {
    processNextFileJob();
  } else if (fileJobs.length === 0) {
    restoreFileEmptyHint();
  }
}

function addFileJob(file) {
  const jobId = `file-job-${++fileJobSeq}`;
  const ui = buildFileTaskElement(file, jobId);
  const job = {
    id: jobId,
    file,
    status: 'pending',
    progress: 0,
    ui,
    text: '',
  };
  fileJobs.push(job);
  if (fileTaskList && ui.container) {
    fileTaskList.prepend(ui.container);
  }
  updateFileStatusDisplay();
  return job;
}

function buildFileTaskElement(file, jobId) {
  const container = document.createElement('article');
  container.className = 'file-task';
  container.dataset.jobId = jobId;

  const header = document.createElement('div');
  header.className = 'file-task-header';

  const titleGroup = document.createElement('div');
  const fileNameEl = document.createElement('p');
  fileNameEl.className = 'file-task-name';
  fileNameEl.textContent = file.name || '未命名音频';
  const metaEl = document.createElement('p');
  metaEl.className = 'file-task-meta';
  metaEl.textContent = formatFileSize(file.size);
  titleGroup.appendChild(fileNameEl);
  titleGroup.appendChild(metaEl);

  const statusEl = document.createElement('span');
  statusEl.className = 'status-pill muted';
  statusEl.textContent = '排队中';
  header.appendChild(titleGroup);
  header.appendChild(statusEl);

  const progress = document.createElement('div');
  progress.className = 'file-task-progress';
  const progressBar = document.createElement('div');
  progressBar.className = 'file-task-progress-bar';
  progress.appendChild(progressBar);

  let audioPreview = null;
  let objectUrl = '';
  if (hasWindow && window.URL && typeof window.URL.createObjectURL === 'function') {
    try {
      objectUrl = window.URL.createObjectURL(file);
      audioPreview = document.createElement('audio');
      audioPreview.className = 'file-task-audio';
      audioPreview.controls = true;
      audioPreview.preload = 'metadata';
      audioPreview.src = objectUrl;
    } catch (err) {
      console.warn('[File-ASR] Failed to create preview URL', err);
    }
  }

  const textArea = document.createElement('textarea');
  textArea.className = 'file-task-text';
  textArea.rows = 4;
  textArea.readOnly = true;
  textArea.placeholder = '等待识别…';

  const actions = document.createElement('div');
  actions.className = 'file-task-actions';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn ghost compact';
  copyBtn.type = 'button';
  copyBtn.textContent = '复制转写';
  copyBtn.disabled = true;
  if (clipboardAvailable) {
    copyBtn.addEventListener('click', () => {
      if (!textArea.value) {
        return;
      }
      navigator.clipboard.writeText(textArea.value)
          .then(() => {
            copyBtn.textContent = '已复制';
            setTimeout(() => {
              copyBtn.textContent = '复制转写';
            }, 1500);
          })
          .catch((err) => {
            console.warn('[File-ASR] Clipboard write failed', err);
          });
    });
  } else {
    copyBtn.title = '当前浏览器不支持 Clipboard API';
  }
  actions.appendChild(copyBtn);

  container.appendChild(header);
  container.appendChild(progress);
  if (audioPreview) {
    container.appendChild(audioPreview);
  }
  container.appendChild(textArea);
  container.appendChild(actions);

  return {
    container,
    status: statusEl,
    progressBar,
    textArea,
    copyBtn,
    meta: metaEl,
    audio: audioPreview,
    objectUrl,
  };
}

function removeFileEmptyHint() {
  if (fileEmptyHint && fileEmptyHint.parentNode) {
    fileEmptyHint.parentNode.removeChild(fileEmptyHint);
    fileEmptyHint = null;
  }
}

function restoreFileEmptyHint() {
  if (!fileTaskList || fileEmptyHint) {
    return;
  }
  const hint = document.createElement('p');
  hint.className = 'panel-hint';
  hint.id = 'fileEmptyHint';
  hint.style.textAlign = 'center';
  hint.style.margin = '0';
  hint.textContent = '尚无任务，拖入音频即可开始。';
  fileTaskList.appendChild(hint);
  fileEmptyHint = hint;
}

function disposeFileJob(job) {
  if (!job || !job.ui) {
    return;
  }
  if (job.ui.objectUrl && hasWindow && window.URL &&
      typeof window.URL.revokeObjectURL === 'function') {
    try {
      window.URL.revokeObjectURL(job.ui.objectUrl);
    } catch (err) {
      console.debug('[File-ASR] Failed to revoke object URL', err);
    }
    job.ui.objectUrl = null;
  }
  if (job.ui.audio) {
    job.ui.audio.pause();
    job.ui.audio.removeAttribute('src');
    job.ui.audio.load();
  }
}

function setFileJobStatus(job, status, label, variant = 'muted') {
  if (!job) {
    return;
  }
  job.status = status;
  if (job.ui && job.ui.status) {
    job.ui.status.textContent = label;
    job.ui.status.className = `status-pill ${variant}`;
  }
  updateFileStatusDisplay();
}

function setFileJobProgress(job, ratio) {
  if (!job) {
    return;
  }
  const clamped = Math.min(1, Math.max(0, ratio || 0));
  job.progress = clamped;
  if (job.ui && job.ui.progressBar) {
    job.ui.progressBar.style.width = `${Math.round(clamped * 100)}%`;
  }
}

function updateFileStatusDisplay() {
  if (!fileStatusLabel) {
    return;
  }
  if (!wasmRuntimeReady) {
    setFileStatusPill('加载模型…', 'muted');
    if (fileClearBtn) {
      fileClearBtn.disabled = true;
    }
    return;
  }
  const activeJob =
      fileJobs.find((job) => job.status === 'decoding' || job.status === 'transcribing');
  if (activeJob) {
    setFileStatusPill(
        `处理中 · ${truncateFileName(activeJob.file?.name || '')}`, 'active');
  } else if (fileJobs.length === 0) {
    setFileStatusPill('队列空闲', 'muted');
  } else if (fileJobs.some((job) => job.status === 'pending')) {
    const pendingCount =
        fileJobs.filter((job) => job.status === 'pending').length;
    setFileStatusPill(`待执行 ${pendingCount} 个文件`, 'active');
  } else if (fileJobs.every((job) => job.status === 'done')) {
    setFileStatusPill('全部完成', 'active');
  } else {
    setFileStatusPill('存在失败任务', 'error');
  }
  if (fileClearBtn) {
    const hasClearable = fileJobs.some(
        (job) => job.status === 'done' || job.status === 'error');
    fileClearBtn.disabled = !hasClearable;
  }
}

function setFileStatusPill(text, variant) {
  if (!fileStatusLabel) {
    return;
  }
  fileStatusLabel.textContent = text;
  fileStatusLabel.className = `status-pill ${variant || 'muted'}`;
}

function truncateFileName(name, maxLen = 32) {
  if (!name) {
    return '';
  }
  if (name.length <= maxLen) {
    return name;
  }
  const sliceLen = Math.max(4, Math.floor((maxLen - 1) / 2));
  return `${name.slice(0, sliceLen)}…${name.slice(-sliceLen)}`;
}

function isSupportedAudioFile(file) {
  if (!file) {
    return false;
  }
  const name = (file.name || '').toLowerCase();
  if (supportedFileExtensions.some((ext) => name.endsWith(`.${ext}`))) {
    return true;
  }
  if (!file.type) {
    return false;
  }
  return file.type.startsWith('audio/') || file.type === 'video/mp4';
}

function formatTimestampLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00.000';
  }
  const totalMs = Math.round(seconds * 1000);
  const minutes = Math.floor(totalMs / 60000);
  const secondsPart = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secondsPart).padStart(2, '0');
  const ms = String(milliseconds).padStart(3, '0');
  return `${mm}:${ss}.${ms}`;
}

function detectFileVadSegments(samples, sampleRate) {
  if (!samples || samples.length === 0 || !sampleRate) {
    return [];
  }
  if (typeof createVad !== 'function' || typeof buildSileroVadConfig !== 'function') {
    console.warn('[File-ASR] createVad unavailable; skip VAD segmentation.');
    return [];
  }
  const availability = syncVadAvailability();
  const mode = resolveVadMode(preferredVadMode, availability);
  if (mode === 'off') {
    console.log('[File-ASR] No VAD assets detected. Skipping segmentation.');
    return [];
  }

  const bufferSeconds = Math.ceil(samples.length / sampleRate) + 2;
  const config = buildVadRuntimeConfig(mode, {
    sampleRate,
    bufferSizeInSeconds : Math.max(bufferSeconds, 30),
  });

  let vadInstance = null;
  const segments = [];
  try {
    vadInstance = createVad(Module, config);
    const hop =
        mode === 'ten' && config.tenVad && config.tenVad.model ?
            (config.tenVad.windowSize || 256) :
            (config.sileroVad.windowSize || 512);
    for (let offset = 0; offset < samples.length; offset += hop) {
      const chunk = samples.subarray(offset, Math.min(samples.length, offset + hop));
      vadInstance.acceptWaveform(chunk);
    }
    vadInstance.flush();
    while (!vadInstance.isEmpty()) {
      const segment = vadInstance.front();
      vadInstance.pop();
      const length = segment.samples ? segment.samples.length : 0;
      if (!length) {
        continue;
      }
      const startSample = Math.max(0, segment.start || 0);
      const endSample = Math.min(samples.length, startSample + length);
      const startSeconds = startSample / sampleRate;
      const endSeconds = endSample / sampleRate;
      segments.push({
        startSample,
        endSample,
        startSeconds,
        endSeconds,
      });
    }
  } catch (err) {
    console.warn('[File-ASR] VAD segmentation failed', err);
  } finally {
    if (vadInstance && typeof vadInstance.free === 'function') {
      try {
        vadInstance.free();
      } catch (freeErr) {
        console.debug('[File-ASR] Failed to free VAD instance', freeErr);
      }
    }
  }
  return segments;
}

function renderSegmentedTranscript(segments) {
  if (!segments || segments.length === 0) {
    return '';
  }
  const lines = [];
  for (let i = 0; i < segments.length; ++i) {
    const seg = segments[i];
    const text = (seg && seg.text) ? seg.text.trim() : '';
    const hasText = text.length > 0;
    const timestamp = seg && Number.isFinite(seg.startSeconds) ?
        `[${formatTimestampLabel(seg.startSeconds)}]` :
        '[--:--.--]';
    lines.push(text.length > 0 ? `${timestamp} ${text}` : `${timestamp} (未识别到有效语音)`);
  }
  return lines.join('\n\n');
}

async function processNextFileJob() {
  if (fileJobProcessing) {
    return;
  }
  if (!wasmRuntimeReady || !recognizer) {
    return;
  }
  const nextJob = fileJobs.find((job) => job.status === 'pending');
  if (!nextJob) {
    if (fileJobs.length === 0) {
      restoreFileEmptyHint();
    }
    updateFileStatusDisplay();
    return;
  }
  fileJobProcessing = true;
  try {
    await runFileJob(nextJob);
  } catch (err) {
    markFileJobError(nextJob, err);
  } finally {
    fileJobProcessing = false;
    if (fileJobs.some((job) => job.status === 'pending')) {
      processNextFileJob();
    } else if (fileJobs.length === 0) {
      restoreFileEmptyHint();
    } else {
      updateFileStatusDisplay();
    }
  }
}

async function runFileJob(job) {
  setFileJobStatus(job, 'decoding', '解析音频…', 'active');
  setFileJobProgress(job, 0.05);
  const decoded = await decodeFileToSamples(job);
  setFileJobProgress(job, 0.2);
  if (job.ui && job.ui.meta) {
    job.ui.meta.textContent =
        `${formatFileDuration(decoded.durationSeconds)} · ${formatFileSize(job.file.size)}`;
  }
  setFileJobStatus(job, 'transcribing', '识别中…', 'active');

  const transcript = await transcribeSamples(decoded.samples, job);
  const finalText = transcript && typeof transcript.text === 'string' ?
      transcript.text :
      '';
  job.text = finalText;
  job.vadSegments = transcript ? transcript.segments : null;
  if (job.ui && job.ui.textArea) {
    job.ui.textArea.value = finalText || '[空结果]';
  }
  if (job.ui && job.ui.copyBtn) {
    job.ui.copyBtn.disabled = !clipboardAvailable || !finalText;
  }
  setFileJobProgress(job, 1);
  setFileJobStatus(job, 'done', '完成', 'active');
}

async function decodeFileToSamples(job) {
  if (!job || !job.file) {
    throw new Error('无效的音频文件');
  }
  const ctx = ensureDecodingAudioContext();
  const arrayBuffer = await job.file.arrayBuffer();
  const audioBuffer = await decodeAudioDataSafe(ctx, arrayBuffer);
  const monoSamples = mixToMono(audioBuffer);
  const resampled =
      resampleToTargetRate(monoSamples, audioBuffer.sampleRate, expectedSampleRate);
  const durationSeconds =
      audioBuffer.duration || (resampled.length / expectedSampleRate);
  return {samples : resampled, durationSeconds : durationSeconds};
}

function ensureDecodingAudioContext() {
  if (decodingAudioContext &&
      typeof decodingAudioContext.state === 'string' &&
      decodingAudioContext.state === 'closed') {
    decodingAudioContext = null;
  }
  if (decodingAudioContext) {
    return decodingAudioContext;
  }
  const AudioContextCtor = typeof window !== 'undefined' ?
      (window.AudioContext || window.webkitAudioContext) :
      null;
  if (!AudioContextCtor) {
    throw new Error('当前浏览器不支持 AudioContext 解码。');
  }
  decodingAudioContext = new AudioContextCtor();
  return decodingAudioContext;
}

function decodeAudioDataSafe(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(
        arrayBuffer,
        (buffer) => resolve(buffer),
        (err) => reject(err || new Error('无法解码音频数据')));
  });
}

function mixToMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 0) {
    return new Float32Array(audioBuffer.length);
  }
  if (audioBuffer.numberOfChannels === 1) {
    return new Float32Array(audioBuffer.getChannelData(0));
  }
  const length = audioBuffer.length;
  const output = new Float32Array(length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; ++channel) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; ++i) {
      output[i] += channelData[i] / audioBuffer.numberOfChannels;
    }
  }
  return output;
}

function resampleToTargetRate(samples, sourceRate, targetRate) {
  if (!samples || samples.length === 0) {
    return new Float32Array(0);
  }
  if (!sourceRate || sourceRate === targetRate) {
    return new Float32Array(samples);
  }
  if (!targetRate) {
    return new Float32Array(samples);
  }
  const durationSeconds = samples.length / sourceRate;
  const targetLength = Math.max(1, Math.round(durationSeconds * targetRate));
  const result = new Float32Array(targetLength);
  const ratio = sourceRate / targetRate;
  let position = 0;
  for (let i = 0; i < targetLength; ++i) {
    const index = Math.floor(position);
    const frac = position - index;
    const nextIndex = Math.min(samples.length - 1, index + 1);
    const current = samples[index] || 0;
    const next = samples[nextIndex] || 0;
    result[i] = current + (next - current) * frac;
    position += ratio;
  }
  return result;
}

async function transcribeSamples(samples, job) {
  if (!samples || samples.length === 0) {
    return {text : '', segments : null};
  }
  if (!recognizer) {
    throw new Error('识别器尚未就绪');
  }

  const vadSegments = detectFileVadSegments(samples, expectedSampleRate);
  if (!vadSegments || vadSegments.length === 0) {
    const singleText =
        await decodeSamplesWithRecognizer(samples, job, {start : 0.2, end : 0.95});
    return {text : applyFilePunctuation(singleText || ''), segments : null};
  }

  const segmentResults = [];
  for (let i = 0; i < vadSegments.length; ++i) {
    const segment = vadSegments[i];
    const segSamples =
        samples.subarray(segment.startSample, Math.min(samples.length, segment.endSample));
    if (!segSamples || segSamples.length === 0) {
      continue;
    }
    const progressStart = 0.2 + 0.75 * (i / vadSegments.length);
    const progressEnd = 0.2 + 0.75 * ((i + 1) / vadSegments.length);
    const segText = await decodeSamplesWithRecognizer(
        segSamples, job, {start : progressStart, end : progressEnd});
    segmentResults.push({
      startSeconds : segment.startSeconds,
      endSeconds : segment.endSeconds,
      text : applyFilePunctuation(segText || ''),
    });
  }

  if (segmentResults.length === 0) {
    const fallback =
        await decodeSamplesWithRecognizer(samples, job, {start : 0.2, end : 0.95});
    return {text : applyFilePunctuation(fallback || ''), segments : null};
  }

  setFileJobProgress(job, 0.95);
  return {
    text : renderSegmentedTranscript(segmentResults),
    segments : segmentResults,
  };
}

async function decodeSamplesWithRecognizer(samples, job, progressRange = {}) {
  if (!samples || samples.length === 0) {
    return '';
  }
  if (!recognizer) {
    throw new Error('识别器尚未就绪');
  }
  const startProgress =
      Number.isFinite(progressRange.start) ? progressRange.start : 0.2;
  const endProgress = Number.isFinite(progressRange.end) ? progressRange.end : 0.95;

  const stream = recognizer.createStream();
  const chunkSize = expectedSampleRate * 5;
  const totalSamples = Math.max(1, samples.length);
  let processed = 0;

  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    const chunk = samples.subarray(offset, Math.min(samples.length, offset + chunkSize));
    stream.acceptWaveform(expectedSampleRate, chunk);
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }
    processed += chunk.length;
    const ratio = Math.min(1, processed / totalSamples);
    const currentProgress = startProgress + (endProgress - startProgress) * ratio;
    setFileJobProgress(job, Math.min(0.97, currentProgress));
    await pauseForUi();
  }

  if (recognizer.config && recognizer.config.modelConfig &&
      recognizer.config.modelConfig.paraformer &&
      recognizer.config.modelConfig.paraformer.encoder != '') {
    const tailPaddings = new Float32Array(expectedSampleRate);
    stream.acceptWaveform(expectedSampleRate, tailPaddings);
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }
  }

  stream.inputFinished();
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
  }
  const result = recognizer.getResult(stream).text || '';
  if (typeof stream.free === 'function') {
    try {
      stream.free();
    } catch (err) {
      console.debug('[File-ASR] Stream free failed', err);
    }
  }
  return result;
}

function applyFilePunctuation(text) {
  if (!text) {
    return '';
  }
  return applyStreamingPunctuation(text);
}

function markFileJobError(job, error) {
  console.error('[File-ASR] 任务失败', error);
  setFileJobStatus(job, 'error', '失败', 'error');
  if (job.ui && job.ui.textArea) {
    job.ui.textArea.value =
        (error && error.message) ? `识别失败：${error.message}` : '识别失败';
  }
  if (job.ui && job.ui.copyBtn) {
    job.ui.copyBtn.disabled = true;
  }
  setFileJobProgress(job, 1);
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) {
    return '';
  }
  const units = [ 'B', 'KB', 'MB', 'GB' ];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function formatFileDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0s';
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }
  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`;
}

function pauseForUi() {
  if (typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

Module = {};

function buildPunctuationConfig() {
  return {
    model: {
      ctTransformer: './punct-ct-transformer.onnx',
      numThreads: 1,
      debug: 0,
      provider: 'cpu',
    },
  };
}

function initPunctuationEngine() {
  if (punctuationReady) {
    return true;
  }
  if (punctuationAssetsMissing) {
    return false;
  }
  punctuationInitAttempted = true;

  const hasModel = fileExists('punct-ct-transformer.onnx') === 1;
  const hasTokens = fileExists('punct-ct-transformer-tokens.json') === 1;
  if (!hasModel || !hasTokens) {
    if (!punctuationAssetsMissing) {
      console.warn('[Punct] Assets missing for punctuation model; streaming text will stay unpunctuated.');
    }
    punctuationAssetsMissing = true;
    return false;
  }

  try {
    punctuationEngine = new OfflinePunctuation(buildPunctuationConfig(), Module);
    punctuationReady = true;
    console.log('[Punct] Offline punctuation initialised (ct-transformer).');
  } catch (err) {
    punctuationEngine = null;
    punctuationReady = false;
    console.error('[Punct] Failed to initialise offline punctuation', err);
  }

  return punctuationReady;
}

function applyStreamingPunctuation(text) {
  if (!text || text.length === 0) {
    return text;
  }
  if (!punctuationReady) {
    initPunctuationEngine();
  }
  if (!punctuationReady || !punctuationEngine) {
    return text;
  }
  try {
    return punctuationEngine.addPunctuation(text);
  } catch (err) {
    console.warn('[Punct] Failed to add punctuation, disabling punctuator', err);
    try {
      punctuationEngine.free();
    } catch (freeErr) {
      console.debug('[Punct] Ignoring punctuation free error', freeErr);
    }
    punctuationEngine = null;
    punctuationReady = false;
    return text;
  }
}

function resetStreamingPreview() {
  lastResult = '';
  lastRawResult = '';
  lastPunctuatedResult = '';
  lastTranslatedWordCount = 0;  // 重置单词计数
  resetPreviewTranslationState();
}

function setStreamingPreview(rawText) {
  if (!rawText || rawText.length === 0) {
    resetStreamingPreview();
    return;
  }
  if (rawText === lastRawResult) {
    // 文本没有变化，不做任何处理
    return;
  }
  
  lastRawResult = rawText;
  lastPunctuatedResult = applyStreamingPunctuation(rawText) || rawText || '';
  
  // 移除流式文本末尾的句号（避免误判为句子结束）
  let displayText = lastPunctuatedResult;
  if (displayText.endsWith('。') || displayText.endsWith('.')) {
    displayText = displayText.slice(0, -1);
  }
  
  // 先触发翻译检查（使用带标点的完整文本）
  maybeTriggerStreamingTranslation(lastPunctuatedResult);
  
  // 再设置显示文本（移除末尾句号）
  lastResult = displayText;
}

function shouldBreakParagraph(reason) {
  const now = nowMs();
  let silenceBreak = false;
  
  // 只有在有语音活动时才检查静音间隔
  if (lastSpeechActivityMs !== null &&
      now - lastSpeechActivityMs >= silenceParagraphThresholdMs) {
    silenceBreak = true;
    console.log(`[Paragraph] Silence break detected! Silent for ${((now - lastSpeechActivityMs) / 1000).toFixed(1)}s`);
  }

  if (reason === 'vad') {
    vadSegmentsSinceBreak += 1;
  }

  const vadBreak = vadSegmentsSinceBreak >= vadParagraphLimit;
  const manualBreak = reason === 'stop';
  const silenceReason = reason === 'silence';
  const needsBreak = silenceBreak || vadBreak || manualBreak || silenceReason;
  
  if (needsBreak) {
    console.log(`[Paragraph] Break needed - silenceBreak:${silenceBreak}, vadBreak:${vadBreak}, manualBreak:${manualBreak}, silenceReason:${silenceReason}`);
    vadSegmentsSinceBreak = 0;
  }
  
  return needsBreak;
}

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function isCjkChar(ch) {
  if (!ch) {
    return false;
  }
  return /[\u3400-\u9FFF]/.test(ch);
}

function mergeStreamingText(baseText, addition) {
  if (!baseText) {
    return addition || '';
  }
  if (!addition) {
    return baseText;
  }
  const needsSpace =
      !isCjkChar(baseText[baseText.length - 1]) &&
      !isCjkChar(addition[0]) &&
      baseText[baseText.length - 1] !== ' ' &&
      addition[0] !== ' ';
  return needsSpace ? `${baseText} ${addition}` : `${baseText}${addition}`;
}

function concatFloat32Arrays(first, second) {
  if (!first || first.length === 0) {
    return second || null;
  }
  if (!second || second.length === 0) {
    return first;
  }
  const merged = new Float32Array(first.length + second.length);
  merged.set(first, 0);
  merged.set(second, first.length);
  return merged;
}

function getSegmentDurationSeconds(samples) {
  if (!samples || samples.length === 0) {
    return 0;
  }
  return samples.length / expectedSampleRate;
}

function cancelPendingOfflineFlushTimer() {
  if (pendingOfflineFlushTimer) {
    clearTimeout(pendingOfflineFlushTimer);
    pendingOfflineFlushTimer = null;
  }
}

function resetPendingOfflineSegment() {
  cancelPendingOfflineFlushTimer();
  pendingOfflineSegment = null;
}

function schedulePendingOfflineFlush() {
  if (pendingOfflineFlushTimer || !pendingOfflineSegment || !offlineWorker ||
      offlineSegmentPolicy.maxBufferAgeMs <= 0) {
    return;
  }
  pendingOfflineFlushTimer = setTimeout(() => {
    pendingOfflineFlushTimer = null;
    forceDispatchPendingOfflineSegment('timeout');
  }, offlineSegmentPolicy.maxBufferAgeMs);
}

function forceDispatchPendingOfflineSegment(trigger = 'timeout') {
  if (!pendingOfflineSegment || !pendingOfflineSegment.entry) {
    return;
  }
  const entry = pendingOfflineSegment.entry;
  const payload = pendingOfflineSegment.audioSamples;
  pendingOfflineSegment = null;
  if (!payload || payload.length === 0) {
    console.warn(
        `[SenseVoice] Pending entry #${entry.id} had no audio when forced (${trigger})`);
    entry.status = 'offline-error';
    refreshTranscript();
    return;
  }
  console.log(
      `[SenseVoice] Forced flush for entry #${entry.id} (${trigger}). Dispatching ${payload.length} samples`);
  entry.status = 'offline-decoding';
  refreshTranscript();
  queueOfflineDecode(entry, payload);
}

function bufferOfflineSamples(entry, audioSamples, options = {}) {
  const {force = false, reason = ''} = options;
  if (!entry) {
    return {ready: false, audioSamples: null};
  }

  const hasSamples = audioSamples && audioSamples.length > 0;
  if (!hasSamples && !(force && pendingOfflineSegment && pendingOfflineSegment.entry === entry)) {
    return {ready: false, audioSamples: null};
  }

  const now = nowMs();
  if (!pendingOfflineSegment || pendingOfflineSegment.entry !== entry) {
    pendingOfflineSegment = {
      entry,
      audioSamples: null,
      startedAtMs: now,
    };
  }

  if (hasSamples) {
    pendingOfflineSegment.audioSamples =
        concatFloat32Arrays(pendingOfflineSegment.audioSamples, audioSamples);
  }
  pendingOfflineSegment.updatedAtMs = now;

  const durationSeconds = getSegmentDurationSeconds(pendingOfflineSegment.audioSamples);
  const shouldFlush =
      force ||
      durationSeconds >= offlineSegmentPolicy.minSeconds ||
      durationSeconds >= offlineSegmentPolicy.maxSeconds ||
      (pendingOfflineSegment.startedAtMs &&
       (now - pendingOfflineSegment.startedAtMs) >= offlineSegmentPolicy.maxBufferAgeMs);

  if (!shouldFlush) {
    console.log(
        `[SenseVoice] Buffering entry #${entry.id}: ${durationSeconds.toFixed(2)}s ready (reason=${reason || 'stream'})`);
    schedulePendingOfflineFlush();
    return {ready: false, audioSamples: null};
  }

  cancelPendingOfflineFlushTimer();
  const payload = pendingOfflineSegment.audioSamples;
  pendingOfflineSegment = null;
  if (!payload || payload.length === 0) {
    return {ready: false, audioSamples: null};
  }
  console.log(
      `[SenseVoice] Finalising entry #${entry.id} for 2-pass: ${durationSeconds.toFixed(2)}s (reason=${reason || 'stream'})`);
  return {ready: true, audioSamples: payload};
}

function buildSileroVadConfig(overrides = {}) {
  const base = {
    model: '',
    threshold: 0.5,
    minSilenceDuration: 0.3,
    minSpeechDuration: 0.25,
    maxSpeechDuration: 20,
    windowSize: 512,
  };
  return Object.assign(base, overrides);
}

function buildTenVadConfig(overrides = {}) {
  const base = {
    model: '',
    threshold: 0.5,
    minSilenceDuration: 0.5,
    minSpeechDuration: 0.25,
    maxSpeechDuration: 20,
    windowSize: 256,
  };
  return Object.assign(base, overrides);
}

function getActiveVadWindowSize(vadInstance) {
  if (!vadInstance || !vadInstance.config) {
    return 512;
  }
  const config = vadInstance.config;
  if (config.sileroVad && config.sileroVad.model) {
    return config.sileroVad.windowSize || 512;
  }
  if (config.tenVad && config.tenVad.model) {
    return config.tenVad.windowSize || 256;
  }
  return 512;
}

function refreshVadModeStatus(text, variant = 'muted') {
  if (!vadModeStatusPill) {
    return;
  }
  vadModeStatusPill.textContent = text || '';
  vadModeStatusPill.className = `status-pill ${variant}`;
}

function refreshVadAssetHint() {
  if (!vadAssetHint) {
    return;
  }
  if (!wasmRuntimeReady) {
    vadAssetHint.textContent = '等待运行时加载 VAD 资源…';
    return;
  }
  if (vadAvailability.silero && vadAvailability.ten) {
    vadAssetHint.textContent = 'silero_vad.onnx + ten-vad.onnx 已加载，可随时切换。';
    return;
  }
  if (vadAvailability.ten) {
    vadAssetHint.textContent = 'ten-vad.onnx 已就绪，未检测到 silero_vad.onnx。';
    return;
  }
  if (vadAvailability.silero) {
    vadAssetHint.textContent = 'silero_vad.onnx 已就绪，添加 ten-vad.onnx 以解锁 TEN 模型。';
    return;
  }
  vadAssetHint.textContent = '未检测到 VAD 模型，将使用 endpoint 触发 2-pass。';
}

function refreshVadOptionStates() {
  const radios = Array.from(vadModeInputs || []);
  if (radios.length === 0) {
    return;
  }
  radios.forEach((input) => {
    if (!(input && input.value)) {
      return;
    }
    if (input.value === 'silero') {
      input.disabled = !vadAvailability.silero;
    } else if (input.value === 'ten') {
      input.disabled = !vadAvailability.ten;
    } else {
      input.disabled = false;
    }
  });
  ensureValidVadSelection();
}

function ensureValidVadSelection() {
  const radios = Array.from(vadModeInputs || []);
  if (radios.length === 0) {
    return;
  }
  let checked =
      radios.find((input) => input.checked && input.disabled !== true);
  if (!checked) {
    const preferenceOrder = [ 'silero', 'ten' ];
    for (const mode of preferenceOrder) {
      const candidate =
          radios.find((input) => (input.value || 'silero') === mode &&
                                 input.disabled !== true);
      if (candidate) {
        candidate.checked = true;
        checked = candidate;
        break;
      }
    }
  }
  if (checked) {
    preferredVadMode = checked.value || 'silero';
  }
}

function refreshVadUiState() {
  refreshVadAssetHint();
  if (vadEnabled && vadDetector) {
    const hop = getActiveVadWindowSize(vadDetector);
    const label = activeVadMode === 'ten' ? 'TEN VAD' : 'Silero VAD';
    refreshVadModeStatus(`${label} · hop ${hop} samples`, 'active');
    return;
  }
  if (!wasmRuntimeReady) {
    refreshVadModeStatus('VAD pending…', 'muted');
    return;
  }
  refreshVadModeStatus('Endpoint only', 'muted');
}

function syncVadAvailability() {
  if (!wasmRuntimeReady || !Module ||
      typeof Module._SherpaOnnxFileExists !== 'function') {
    vadAvailability.silero = false;
    vadAvailability.ten = false;
    refreshVadOptionStates();
    refreshVadAssetHint();
    return vadAvailability;
  }
  try {
    vadAvailability.silero = fileExists('silero_vad.onnx') === 1;
  } catch (err) {
    vadAvailability.silero = false;
  }
  try {
    vadAvailability.ten = fileExists('ten-vad.onnx') === 1;
  } catch (err) {
    vadAvailability.ten = false;
  }
  refreshVadOptionStates();
  refreshVadAssetHint();
  return vadAvailability;
}

function resolveVadMode(preference, availability = vadAvailability) {
  const requested = preference || 'silero';
  if (requested === 'ten') {
    return availability.ten ? 'ten' :
                              (availability.silero ? 'silero' : 'off');
  }
  return availability.silero ? 'silero' :
                               (availability.ten ? 'ten' : 'off');
}

function buildVadRuntimeConfig(mode, overrides = {}) {
  const sampleRate = overrides.sampleRate || expectedSampleRate;
  const bufferSize = overrides.bufferSizeInSeconds || 60;
  const config = {
    sileroVad: buildSileroVadConfig(),
    tenVad: buildTenVadConfig(),
    sampleRate,
    numThreads: overrides.numThreads || 1,
    provider: overrides.provider || 'cpu',
    debug: overrides.debug || 0,
    bufferSizeInSeconds: bufferSize,
  };
  if (mode === 'ten') {
    config.tenVad = buildTenVadConfig(Object.assign(
        {
          model: './ten-vad.onnx',
          threshold: 0.45,
          minSilenceDuration: 0.50,
          minSpeechDuration: 0.30,
          maxSpeechDuration: 25,
          windowSize: 256,
        },
        overrides.tenVad || {}));
  } else {
    config.sileroVad = buildSileroVadConfig(Object.assign(
        {
          model: './silero_vad.onnx',
          threshold: 0.60,
          minSilenceDuration: 0.60,
          minSpeechDuration: 0.25,
          maxSpeechDuration: 25,
          windowSize: 512,
        },
        overrides.sileroVad || {}));
  }
  return config;
}

function disposeVadResources() {
  if (vadDetector && typeof vadDetector.free === 'function') {
    try {
      vadDetector.free();
    } catch (err) {
      console.debug('[VAD] Failed to free detector', err);
    }
  }
  if (vadBuffer && typeof vadBuffer.free === 'function') {
    try {
      vadBuffer.free();
    } catch (err) {
      console.debug('[VAD] Failed to free circular buffer', err);
    }
  }
  vadDetector = null;
  vadBuffer = null;
  vadEnabled = false;
  vadConfig = null;
}

function initVadEngine(preference = preferredVadMode, options = {}) {
  const availability = syncVadAvailability();
  const resolved = resolveVadMode(preference, availability);
  if (!options.forceRecreate && resolved === activeVadMode &&
      vadDetector && vadEnabled) {
    refreshVadUiState();
    return true;
  }

  disposeVadResources();
  activeVadMode = resolved;

  if (resolved === 'off') {
    console.warn('[VAD] No VAD assets detected. Falling back to endpoint-based 2-pass triggering.');
    refreshVadUiState();
    return false;
  }

  const config = buildVadRuntimeConfig(resolved, {
    sampleRate : expectedSampleRate,
    bufferSizeInSeconds : options.bufferSizeInSeconds || 60,
    sileroVad : options.sileroVad,
    tenVad : options.tenVad,
  });

  try {
    vadDetector = createVad(Module, config);
    const bufferSamples =
        config.bufferSizeInSeconds * (config.sampleRate || expectedSampleRate);
    vadBuffer = new CircularBuffer(bufferSamples, Module);
    vadEnabled = true;
    vadConfig = config;
    console.log(`[VAD] ${resolved === 'ten' ? 'TEN' : 'Silero'} VAD initialised. 2-pass will be triggered by speech segments.`);
    refreshVadUiState();
    return true;
  } catch (err) {
    console.error(`[VAD] Failed to initialise ${resolved} detector`, err);
    disposeVadResources();
    activeVadMode = 'off';
    refreshVadModeStatus('VAD init failed', 'error');
    return false;
  }
}

function resetVadDetectors() {
  if (vadDetector) {
    try {
      vadDetector.reset();
      vadDetector.clear();
    } catch (err) {
      console.warn('[VAD] Failed to reset detector cleanly', err);
    }
  }

  if (vadBuffer) {
    vadBuffer.reset();
  }
}

function drainVadSegments(vadInstance, handler) {
  if (!vadInstance || typeof handler !== 'function') {
    return;
  }
  while (!vadInstance.isEmpty()) {
    const segment = vadInstance.front();
    vadInstance.pop();
    handler(segment);
  }
}

function processVadSegment(segment) {
  if (!segment || !vadEnabled) {
    return;
  }

  const sampleCount = segment.samples ? segment.samples.length : 0;
  const hasPendingSamples =
      currentSegmentSampleCount > 0 ||
      (pendingSegmentCarry && pendingSegmentCarry.length > 0);

  console.log('[VAD] Detected speech segment',
              {start: segment.start || 0, samples: sampleCount});

  if (!hasPendingSamples && lastResult.length === 0) {
    console.log('[VAD] Ignoring segment because no active audio chunk is pending');
    return;
  }

  flushCurrentSegment({reason: 'vad'});
  if (recognizer && recognizer_stream) {
    recognizer.reset(recognizer_stream);
  }
}

function feedVad(samples) {
  if (!vadEnabled || !vadDetector || !vadBuffer || !samples || samples.length === 0) {
    return;
  }

  vadBuffer.push(samples);
  const windowSize = getActiveVadWindowSize(vadDetector);
  while (vadBuffer.size() > windowSize) {
    const chunk = vadBuffer.get(vadBuffer.head(), windowSize);
    vadDetector.acceptWaveform(chunk);
    vadBuffer.pop(windowSize);
    drainVadSegments(vadDetector, processVadSegment);
  }
}

function flushVadDetector() {
  if (!vadEnabled || !vadDetector) {
    return;
  }
  try {
    vadDetector.flush();
    drainVadSegments(vadDetector, processVadSegment);
  } catch (err) {
    console.warn('[VAD] Failed to flush detector', err);
  }
}

function resetOfflineWorkerState() {
  if (offlineWorker) {
    try {
      offlineWorker.terminate();
    } catch (err) {
      console.warn('[SenseVoice] Failed to terminate worker cleanly', err);
    }
  }

  offlineWorker = null;
  offlineWorkerReady = null;
  offlineWorkerReadyResolve = null;
  offlineWorkerReadyReject = null;
  offlineWorkerReadyResolved = false;
  offlineJobCounter = 0;
  twoPassRuntime = 'wasm';
  offlinePendingJobs.clear();
  offlineDispatchQueue.length = 0;
  resetPendingOfflineSegment();
}

function handleOfflineWorkerMessage(event) {
  const data = event.data || {};
  const {type} = data;

  if (type === 'ready') {
    offlineWorkerReadyResolved = true;
    twoPassRuntime = data.backend || (twoPassConfig.backend === 'ort-webgpu' ? 'ort-webgpu' : 'wasm');
    if (offlineWorkerReadyResolve) {
      offlineWorkerReadyResolve();
    }
    offlineWorkerReadyResolve = null;
    offlineWorkerReadyReject = null;
    console.log('Offline SenseVoice worker ready for second pass.');
    refreshTwoPassStatusPill();
    dispatchOfflineJobs();
    return;
  }

  if (type === 'init-error') {
    const message = data.message || 'Unknown error initialising SenseVoice worker';
    console.error('[SenseVoice] Worker initialisation failed:', message);
    if (offlineWorkerReadyReject) {
      offlineWorkerReadyReject(new Error(message));
    }
    resetOfflineWorkerState();
    refreshTranscript();
    return;
  }

  if (type === 'decode-result' || type === 'decode-error') {
    const jobId = data.id;
    const pending = offlinePendingJobs.get(jobId);
    if (!pending) {
      return;
    }

    offlinePendingJobs.delete(jobId);
    const {entry} = pending;

    if (type === 'decode-result') {
      const result = data.result || {};
      const previousStreaming = entry.streaming;
      entry.offline = (result.text || '').trim();
      if (entry.offline.length === 0) {
        entry.status = 'offline-complete-empty';
        console.log(`[SenseVoice] 2-pass completed for segment #${entry.id} with no additional text.`);
        const translationState = ensureEntryTranslationState(entry);
        if (translationState && translationConfig.enabled) {
          translationState.status = 'offline-empty';
          translationState.text = '';
          translationState.source = '';
          translationState.error = '';
        }
      } else {
        entry.status = 'offline-complete';
        entry.streaming = entry.offline;
        console.log(`[SenseVoice] 2-pass updated segment #${entry.id}`,
                    {preview: previousStreaming, offline: entry.offline, elapsedMs: data.elapsedMs});
        scheduleEntryTranslation(entry, {force: true, sourceText: entry.offline});
      }
    } else {
      entry.status = 'offline-error';
      const message = data.message || 'Unknown decode error';
      console.error(`[SenseVoice] 2-pass decoding failed for segment #${entry.id}`, message);
    }

    refreshTranscript();
    return;
  }
}

function dispatchOfflineJobs() {
  if (!offlineWorker || !offlineWorkerReadyResolved) {
    return;
  }

  while (offlineDispatchQueue.length > 0) {
    const job = offlineDispatchQueue.shift();
    const {entry, audioSamples, jobId} = job;
    const pending = offlinePendingJobs.get(jobId);
    if (!pending) {
      continue;
    }

    console.log(`[SenseVoice] Dispatching job #${jobId} for segment #${entry.id} (${entry.reason})`,
                {preview: entry.streaming, sampleCount: audioSamples.length});

    try {
      offlineWorker.postMessage(
          {
            type: 'decode',
            id: jobId,
            sampleRate: expectedSampleRate,
            audioBuffer: audioSamples.buffer
          },
          [ audioSamples.buffer ]);
      console.log(`[SenseVoice] Job #${jobId} posted to worker successfully`);
    } catch (err) {
      console.error(`[SenseVoice] Failed to post job #${jobId} to worker`, err);
      offlinePendingJobs.delete(jobId);
      entry.status = 'offline-error';
      refreshTranscript();
    }
  }
}

function queueOfflineDecode(entry, audioSamples) {
  // 按需初始化 Worker（延迟加载）
  if (!offlineWorker) {
    console.log('[SenseVoice] Worker not loaded, initializing on-demand...');
    if (!initOfflineRecognizer()) {
      entry.status = 'offline-error';
      console.error('[SenseVoice] Failed to initialize offline worker on-demand.');
      refreshTranscript();
      return;
    }
  }

  const jobId = offlineJobCounter++;
  console.log(`[SenseVoice] Queuing job #${jobId} for segment #${entry.id}: ${audioSamples.length} samples`);
  offlinePendingJobs.set(jobId, {entry});
  offlineDispatchQueue.push({jobId, entry, audioSamples});

  if (offlineWorkerReadyResolved) {
    dispatchOfflineJobs();
  } else if (offlineWorkerReady) {
    console.log(`[SenseVoice] Worker not ready yet, job #${jobId} will dispatch after init`);
    offlineWorkerReady.catch((err) => {
      console.error('[SenseVoice] Worker initialisation failed', err);
      entry.status = 'offline-error';
      refreshTranscript();
    });
  }
}

function resetSegmentSamples() {
  currentSegmentSamples = [];
  currentSegmentSampleCount = 0;
}

function fileExists(filename) {
  if (!Module._SherpaOnnxFileExists) {
    return 0;
  }

  const filenameLen = Module.lengthBytesUTF8(filename) + 1;
  const buffer = Module._malloc(filenameLen);
  Module.stringToUTF8(filename, buffer, filenameLen);

  const exists = Module._SherpaOnnxFileExists(buffer);

  Module._free(buffer);
  return exists;
}

function resolveActiveOnlineModel() {
  if (onlineModelSpecs[activeOnlineModel]) {
    return activeOnlineModel;
  }
  return 'zipformer';
}

function syncOnlineModelInputs() {
  if (!onlineModelInputs || onlineModelInputs.length === 0) {
    return;
  }
  onlineModelInputs.forEach((input) => {
    if (!(input && input.value)) {
      return;
    }
    input.checked = input.value === activeOnlineModel;
  });
}

function refreshOnlineModelStatus() {
  const spec = onlineModelSpecs[activeOnlineModel];
  const label = spec ? spec.label : activeOnlineModel;
  const available = onlineModelAvailability[activeOnlineModel];
  const missing = onlineModelMissing[activeOnlineModel] || [];
  const moduleRef = getModuleSafe();

  if (onlineModelStatusPill) {
    const statusClass = available ? 'status-pill active' : 'status-pill error';
    onlineModelStatusPill.className = statusClass;
    if (!moduleRef || !moduleRef._SherpaOnnxFileExists) {
      onlineModelStatusPill.textContent = 'Loading…';
    } else {
      onlineModelStatusPill.textContent =
          available ? `${label} 就绪` : `${label} 资源缺失`;
    }
  }

  if (onlineModelAssetHint) {
    if (!moduleRef || !moduleRef._SherpaOnnxFileExists) {
      onlineModelAssetHint.textContent = '等待模型文件加载…';
    } else if (available) {
      onlineModelAssetHint.textContent = spec && spec.hint ?
          spec.hint : '模型文件已加载';
    } else if (missing.length > 0) {
      onlineModelAssetHint.textContent = `缺少: ${missing.join(', ')}`;
    } else {
      onlineModelAssetHint.textContent = '模型文件未检测到';
    }
  }
}

function refreshOnlineModelAvailability() {
  const moduleRef = getModuleSafe();
  if (!moduleRef || !moduleRef._SherpaOnnxFileExists) {
    return;
  }

  Object.keys(onlineModelSpecs).forEach((key) => {
    const spec = onlineModelSpecs[key];
    if (!spec) {
      return;
    }
    const missing = [];
    const resolved = {};
    for (const asset of spec.assets) {
      if (!asset || (!asset.path && !asset.paths)) {
        continue;
      }
      const paths =
          Array.isArray(asset.paths) ? asset.paths :
          (Array.isArray(asset.path) ? asset.path : [ asset.path ]);
      let foundPath = '';
      for (const candidate of paths) {
        if (fileExists(candidate) === 1) {
          foundPath = candidate;
          break;
        }
      }
      if (!foundPath) {
        missing.push(asset.label || paths.join('|'));
      } else if (asset.slot) {
        let normalized = foundPath;
        if (normalized.startsWith('./') || normalized.startsWith('.\\')) {
          normalized = normalized.slice(2);
        }
        if (!normalized.startsWith('./')) {
          normalized = `./${normalized}`;
        }
        resolved[asset.slot] = normalized;
      }
    }
    onlineModelMissing[key] = missing;
    onlineModelAvailability[key] = missing.length === 0;
    if (resolvedOnlineModelPaths[key]) {
      resolvedOnlineModelPaths[key] =
          Object.assign({}, resolvedOnlineModelPaths[key], resolved);
    }
  });
  syncOnlineModelInputs();
  refreshOnlineModelStatus();
}

function recreateOnlineRecognizer() {
  if (!Module || typeof createOnlineRecognizer !== 'function') {
    return;
  }
  if (isRecording) {
    console.warn('[ASR] Stop recording before switching models.');
    return;
  }
  if (fileJobProcessing) {
    console.warn('[ASR] 请等待文件转写完成后再切换模型。');
    return;
  }

  if (recognizer_stream && typeof recognizer_stream.free === 'function') {
    try {
      recognizer_stream.free();
    } catch (err) {
      console.debug('[ASR] 清理旧的 recognizer_stream 失败', err);
    }
  }
  recognizer_stream = null;

  if (recognizer && typeof recognizer.free === 'function') {
    try {
      recognizer.free();
    } catch (err) {
      console.debug('[ASR] 释放旧的 recognizer 失败', err);
    }
  }

  const onlineConfig = buildOnlineRecognizerConfig();
  recognizer = createOnlineRecognizer(Module, onlineConfig);
  console.log('[ASR] 已重建识别器', {model : resolveActiveOnlineModel()});

  resetSegmentSamples();
  resetStreamingPreview();
  refreshTranscript();
  refreshOnlineModelStatus();
}

function applyOnlineModelSelection(modelKey, options = {}) {
  if (!onlineModelSpecs[modelKey]) {
    console.warn('[ASR] 未知的模型类型：', modelKey);
    return;
  }
  if (isRecording) {
    console.warn('[ASR] 录音进行中，暂停后再切换模型。');
    syncOnlineModelInputs();
    refreshOnlineModelStatus();
    return;
  }
  if (fileJobProcessing) {
    console.warn('[ASR] 文件转写进行中，稍后再切换模型。');
    syncOnlineModelInputs();
    refreshOnlineModelStatus();
    return;
  }
  activeOnlineModel = modelKey;
  syncOnlineModelInputs();
  if (wasmRuntimeReady) {
    refreshOnlineModelAvailability();
  } else {
    refreshOnlineModelStatus();
  }
  if (options.skipRecreate === true || !wasmRuntimeReady) {
    return;
  }
  if (!onlineModelAvailability[modelKey]) {
    console.warn(`[ASR] ${modelKey} 模型资源缺失，保持当前模型。`);
    return;
  }
  recreateOnlineRecognizer();
}

function buildOnlineRecognizerConfig() {
  const selectedModel = resolveActiveOnlineModel();
  const selectedSpec = onlineModelSpecs[selectedModel] || onlineModelSpecs.zipformer;
  const resolvedPaths = resolvedOnlineModelPaths[selectedModel] || {};

  const modelConfig = {
    transducer: {
      encoder: '',
      decoder: '',
      joiner: '',
    },
    paraformer: {
      encoder: '',
      decoder: '',
    },
    zipformer2Ctc: {
      model: '',
    },
    nemoCtc: {
      model: '',
    },
    toneCtc: {
      model: '',
    },
    tokens: './tokens.txt',
    numThreads: 1,
    provider: 'cpu',
    debug: 1,
    modelType: '',
    modelingUnit: 'cjkchar',
    bpeVocab: '',
  };

  if (selectedSpec && selectedSpec.type === 'paraformer') {
    modelConfig.paraformer = {
      encoder: resolvedPaths.encoder || './paraformer-encoder.int8.onnx',
      decoder: resolvedPaths.decoder || './paraformer-decoder.int8.onnx',
    };
    modelConfig.transducer = {
      encoder: '',
      decoder: '',
      joiner: '',
    };
    modelConfig.modelType = 'paraformer';
    modelConfig.tokens = resolvedPaths.tokens || selectedSpec.tokens;
  } else {
    modelConfig.transducer = {
      encoder: resolvedPaths.encoder || './encoder.onnx',
      decoder: resolvedPaths.decoder || './decoder.onnx',
      joiner: resolvedPaths.joiner || './joiner.onnx',
    };
    modelConfig.paraformer = {
      encoder: '',
      decoder: '',
    };
    modelConfig.modelType = 'transducer';
    modelConfig.tokens =
        resolvedPaths.tokens ||
        (selectedSpec ? selectedSpec.tokens : './tokens.txt');
  }

  return {
    featConfig: {
      sampleRate: expectedSampleRate,
      featureDim: 80,
    },
    modelConfig: modelConfig,
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: 1,
    rule1MinTrailingSilence: 1.4,
    rule2MinTrailingSilence: 0.5,
    rule3MinUtteranceLength: 10,
    hotwordsFile: '',
    hotwordsScore: 1.5,
    ctcFstDecoderConfig: {
      graph: '',
      maxActive: 3000,
    },
    ruleFsts: '',
    ruleFars: '',
  };
}

function buildOfflineRecognizerConfig() {
  const config = {
    modelConfig: {
      tokens: './second-pass-tokens.txt',
      numThreads: 1,
      debug: 1,
      senseVoice: {
        model: './second-pass-sense-voice.onnx',
        language: 'auto',
        useInverseTextNormalization: 1,
      },
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
  };
  console.log('[SenseVoice] Building offline recognizer config:', JSON.stringify(config, null, 2));
  return config;
}

function initOfflineRecognizer() {
  const modelExists = fileExists('second-pass-sense-voice.onnx');
  const tokensExists = fileExists('second-pass-tokens.txt');
  
  console.log('[SenseVoice] Checking assets:', {
    'second-pass-sense-voice.onnx': modelExists === 1 ? 'found' : 'missing',
    'second-pass-tokens.txt': tokensExists === 1 ? 'found' : 'missing'
  });
  
  if (modelExists === 0 || tokensExists === 0) {
    console.warn('SenseVoice assets are missing. Running single pass only.');
    resetOfflineWorkerState();
    return false;
  }

  const backend = twoPassConfig.backend || 'wasm';
  const config = buildOfflineRecognizerConfig();
  const workerScript = backend === 'ort-webgpu' ? 'sense-voice-ort-worker.js' : 'offline-worker.js';

  if (offlineWorker) {
    return true;
  }

  try {
    offlineWorker = new Worker(workerScript);
  } catch (err) {
    console.error('[SenseVoice] Failed to create offline worker', err);
    resetOfflineWorkerState();
    return false;
  }

  offlineWorkerReady = new Promise((resolve, reject) => {
    offlineWorkerReadyResolve = resolve;
    offlineWorkerReadyReject = reject;
  });

  offlineWorkerReadyResolved = false;

  offlineWorker.addEventListener('message', handleOfflineWorkerMessage);
  offlineWorker.addEventListener('error', (event) => {
    console.error('[SenseVoice] Worker error event', event.message || event);
    if (offlineWorkerReadyReject) {
      offlineWorkerReadyReject(new Error(event.message || 'Worker error'));
    }
    resetOfflineWorkerState();
  });

  console.log(`[SenseVoice] Posting init message to worker (${backend})`, config);
  if (backend === 'ort-webgpu') {
    offlineWorker.postMessage({
      type: 'init',
      config: {
        modelUrl: './second-pass-sense-voice.onnx',
        tokensUrl: './second-pass-tokens.txt',
        language: config.modelConfig?.senseVoice?.language || 'auto',
        useItn: config.modelConfig?.senseVoice?.useInverseTextNormalization ? 1 : 0,
      },
      sampleRate: expectedSampleRate,
    });
    twoPassRuntime = 'ort-webgpu';
  } else {
    offlineWorker.postMessage({
      type: 'init',
      config: config,
      sampleRate: expectedSampleRate,
    });
    twoPassRuntime = 'wasm';
  }
  refreshTwoPassStatusPill();

  // Timeout fallback if worker doesn't respond within 10 seconds
  setTimeout(() => {
    if (!offlineWorkerReadyResolved && offlineWorkerReadyReject) {
      console.error('[SenseVoice] Worker init timeout after 10 seconds');
      offlineWorkerReadyReject(new Error('Worker initialization timeout'));
      resetOfflineWorkerState();
    }
  }, 10000);

  return true;
}

function takeSegmentSamples(options = {}) {
  const {preserveTail = false} = options;

  const carryLength = pendingSegmentCarry ? pendingSegmentCarry.length : 0;
  if (currentSegmentSampleCount === 0 && carryLength === 0) {
    resetSegmentSamples();
    pendingSegmentCarry = null;
    return null;
  }

  const mergedLength = carryLength + currentSegmentSampleCount;
  const merged = new Float32Array(mergedLength);
  let offset = 0;

  if (carryLength > 0) {
    merged.set(pendingSegmentCarry, offset);
    offset += carryLength;
  }

  for (const chunk of currentSegmentSamples) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  resetSegmentSamples();
  pendingSegmentCarry = null;

  if (!preserveTail) {
    const overlapSamples = Math.max(
        0, Math.round(expectedSampleRate * segmentOverlapSeconds));
    if (overlapSamples > 0 && merged.length > overlapSamples) {
      const trimIndex = merged.length - overlapSamples;
      pendingSegmentCarry = merged.slice(trimIndex);
      return merged.slice(0, trimIndex);
    }
  }

  return merged;
}

function flushCurrentSegment(options = {}) {
  const {force = false, reason = 'endpoint'} = options;

  const streamingText = (lastResult || '').trim();
  const previewTranslationSnapshot = snapshotPreviewTranslationState();
  resetStreamingPreview();

  let audioSamples = null;
  const preserveTail = !(reason === 'endpoint' || reason === 'vad');
  
  console.log('[flushCurrentSegment] Called with:', {
    force,
    reason,
    streamingText: streamingText.substring(0, 50) + '...',
    twoPassEnabled: twoPassConfig.enabled
  });

  // 延迟加载优化：根据 twoPassConfig.enabled 决定是否收集音频
  // Worker 会在 queueOfflineDecode 时按需初始化
  if (twoPassConfig.enabled) {
    audioSamples = takeSegmentSamples({preserveTail});
    console.log('[flushCurrentSegment] Audio samples:', audioSamples ? audioSamples.length : 'null');
  } else {
    console.log('[flushCurrentSegment] Two-pass disabled, skipping offline recognition');
    takeSegmentSamples({preserveTail: true});
    resetPendingOfflineSegment();
  }

  const hasAudioSamples = audioSamples && audioSamples.length > 0;
  const pendingHasAudio = pendingOfflineSegment &&
      pendingOfflineSegment.audioSamples &&
      pendingOfflineSegment.audioSamples.length > 0;
  const expectOffline =
      twoPassConfig.enabled && (hasAudioSamples || (force && pendingHasAudio));

  console.log('[flushCurrentSegment] Expect offline:', expectOffline,
              'twoPassEnabled:', twoPassConfig.enabled,
              'pendingEntry:',
              pendingOfflineSegment && pendingOfflineSegment.entry ?
                  pendingOfflineSegment.entry.id : 'none');

  if (!force && streamingText.length === 0 && !expectOffline) {
    refreshTranscript();
    return;
  }

  let entry = null;
  const reusePendingEntry =
      expectOffline && pendingOfflineSegment && pendingOfflineSegment.entry;

  if (reusePendingEntry) {
    entry = pendingOfflineSegment.entry;
    // 先检查是否需要换行（在更新 lastSpeechActivityMs 之前）
    if (!entry.paragraphBreak) {
      entry.paragraphBreak = shouldBreakParagraph(reason);
    }
    if (streamingText.length > 0) {
      entry.streaming = mergeStreamingText(entry.streaming, streamingText);
    }
    // entry.reason 保持不变，不拼接新的 reason
    console.log(`[flushCurrentSegment] Reusing pending entry #${entry.id}`, {paragraphBreak: entry.paragraphBreak});
  } else {
    // 先检查是否需要换行（在更新 lastSpeechActivityMs 之前）
    const shouldBreak = shouldBreakParagraph(reason);
    entry = {
      id: transcriptCounter++,
      streaming: streamingText,
      offline: '',
      status: expectOffline ? 'offline-buffering' : 'stream-only',
      reason: reason,
      paragraphBreak: shouldBreak,
    };
    resultList.push(entry);
    console.log(`[flushCurrentSegment] Created entry #${entry.id}`, {
      expectOffline,
      reason,
      paragraphBreak: shouldBreak,
      streamingPreview: streamingText.substring(0, 50),
    });
  }

  const translationState = ensureEntryTranslationState(entry);
  if (translationState) {
    translationState.text = '';
    translationState.source = '';
    translationState.error = '';
    translationState.seq += 1;
    if (!translationConfig.enabled) {
      translationState.status = 'idle';
    } else if (expectOffline) {
      translationState.status = 'waiting-offline';
    } else {
      translationState.status = 'offline-missing';
    }
    applyPreviewTranslationSnapshot(entry, previewTranslationSnapshot);
  }

  refreshTranscript();

  if (!expectOffline) {
    if (entry.status === 'stream-only' && streamingText.length === 0 && force) {
      entry.status = 'offline-complete-empty';
      refreshTranscript();
    }
    return;
  }

  const buffered =
      bufferOfflineSamples(entry, audioSamples, {force, reason});

  if (!buffered.ready) {
    entry.status = 'offline-buffering';
    refreshTranscript();
    return;
  }

  entry.status = 'offline-decoding';
  refreshTranscript();

  queueOfflineDecode(entry, buffered.audioSamples);
}

// https://emscripten.org/docs/api_reference/module.html#Module.locateFile
Module.locateFile = function(path, scriptDirectory = '') {
  console.log(`path: ${path}, scriptDirectory: ${scriptDirectory}`);
  return scriptDirectory + path;
};

// https://emscripten.org/docs/api_reference/module.html#Module.locateFile
Module.setStatus = function(status) {
  console.log(`status ${status}`);
  const statusElement = document.getElementById('status');
  if (status == "Running...") {
    status = 'Model downloaded. Initializing recongizer...'
  }
  statusElement.textContent = status;
  if (status === '') {
    statusElement.style.display = 'none';
    // statusElement.parentNode.removeChild(statusElement);

    document.querySelectorAll('.tab-content').forEach((tabContentElement) => {
      tabContentElement.classList.remove('loading');
    });
  } else {
    statusElement.style.display = 'block';
    document.querySelectorAll('.tab-content').forEach((tabContentElement) => {
      tabContentElement.classList.add('loading');
    });
  }
};

Module.onRuntimeInitialized = function() {
  console.log('inited!');

  startBtn.disabled = false;

  refreshOnlineModelAvailability();
  const onlineConfig = buildOnlineRecognizerConfig();
  recognizer = createOnlineRecognizer(Module, onlineConfig);
  console.log('recognizer is created!', recognizer);
  wasmRuntimeReady = true;
  refreshOnlineModelAvailability();
  refreshOnlineModelStatus();

  // Worker 延迟加载：只有启用 two-pass 且首次需要时才初始化
  // 不再在启动时自动加载，以节省内存
  console.log('[SenseVoice] Worker will be loaded on-demand when two-pass is needed');

  initPunctuationEngine();
  updateFileStatusDisplay();
  processNextFileJob();

  if (!initVadEngine(preferredVadMode, {forceRecreate : true})) {
    console.log('[VAD] Endpoint detector will trigger 2-pass (VAD assets unavailable).');
  }
};

let audioCtx;
let mediaStream;

let expectedSampleRate = 16000;
let recordSampleRate; // the sampleRate of the microphone
let recorder = null;  // the microphone
let leftchannel = []; // TODO: Use a single channel

let recordingLength = 0; // number of samples so far
let isRecording = false;

let recognizer = null;
let recognizer_stream = null;

async function ensureRecorderReady() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.log('getUserMedia not supported on your browser!');
    alert('getUserMedia not supported on your browser!');
    return false;
  }

  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext({sampleRate : 16000});
  }
  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch (err) {
      console.warn('[ASR] Failed to resume audio context', err);
    }
  }

  if (recorder && mediaStream) {
    return true;
  }

  console.log('getUserMedia supported.');

  // see https://w3c.github.io/mediacapture-main/#dom-mediadevices-getusermedia
  const constraints = {audio : true};

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.log('The following error occured: ' + err);
    alert('无法访问麦克风，请检查浏览器权限设置。');
    return false;
  }

  console.log(audioCtx);
  recordSampleRate = audioCtx.sampleRate;
  console.log('sample rate ' + recordSampleRate);

  // creates an audio node from the microphone incoming stream
  mediaStream = audioCtx.createMediaStreamSource(stream);
  console.log('media stream', mediaStream);

  // https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createScriptProcessor
  // bufferSize: the onaudioprocess event is called when the buffer is full
  var bufferSize = 4096;
  var numberOfInputChannels = 1;
  var numberOfOutputChannels = 2;
  if (audioCtx.createScriptProcessor) {
    recorder = audioCtx.createScriptProcessor(
        bufferSize, numberOfInputChannels, numberOfOutputChannels);
  } else {
    recorder = audioCtx.createJavaScriptNode(
        bufferSize, numberOfInputChannels, numberOfOutputChannels);
  }
  console.log('recorder', recorder);

  recorder.onaudioprocess = function(e) {
    const shouldKeepAudio =
        !!(saveRecordingToggle && saveRecordingToggle.checked);
    let samples = new Float32Array(e.inputBuffer.getChannelData(0))
    samples = downsampleBuffer(samples, expectedSampleRate);

    currentSegmentSamples.push(samples);
    currentSegmentSampleCount += samples.length;
    pushWaveformSamples(samples);

    if (recognizer_stream == null) {
      recognizer_stream = recognizer.createStream();
    }

    recognizer_stream.acceptWaveform(expectedSampleRate, samples);
    while (recognizer.isReady(recognizer_stream)) {
      recognizer.decode(recognizer_stream);
    }

    if (vadEnabled) {
      feedVad(samples);
    }

    let shouldResetStream = false;
    if (!vadEnabled) {
      shouldResetStream = recognizer.isEndpoint(recognizer_stream);
    }

    let result = recognizer.getResult(recognizer_stream).text;

    if (recognizer.config.modelConfig.paraformer.encoder != '') {
      let tailPaddings = new Float32Array(expectedSampleRate);
      recognizer_stream.acceptWaveform(expectedSampleRate, tailPaddings);
      while (recognizer.isReady(recognizer_stream)) {
        recognizer.decode(recognizer_stream);
      }
      result = recognizer.getResult(recognizer_stream).text;
    }

    // 在调用 setStreamingPreview 之前记录旧文本
    const previousResult = lastRawResult;
    
    if (result.length > 0) {
      setStreamingPreview(result);
    }
    
    // 检查文本是否真的有变化（即有新的语音输入）
    const hasNewSpeech = result.length > 0 && result !== previousResult;
    
    // 检查是否需要因为静音而换行（无论 VAD 是否启用都要检查）
    const now = nowMs();
    const hasPendingText = lastResult.length > 0;  // 只检查是否有文本，不检查音频样本
    if (hasPendingText && lastSpeechActivityMs !== null) {
      const silenceDuration = now - lastSpeechActivityMs;
      
      // 如果有新语音，重置静音计时器
      if (hasNewSpeech) {
        lastSpeechActivityMs = now;
        console.log(`[Silence] New speech detected, resetting silence timer`);
      }
      // 如果静音超过阈值，触发换行（无论 VAD 是否启用都要检查）
      else if (silenceDuration >= silenceParagraphThresholdMs) {
        console.log(`[Silence] ⚠️ Triggering paragraph break after ${(silenceDuration / 1000).toFixed(1)}s silence (VAD: ${vadEnabled ? 'enabled' : 'disabled'})`);
        flushCurrentSegment({reason: 'silence'});
        if (recognizer_stream) {
          recognizer.reset(recognizer_stream);
        }
        shouldResetStream = false;  // 已经处理过了
        // 触发后重置时间戳到很久之后，防止立即再次触发
        lastSpeechActivityMs = now;
      }
      // 定期打印静音时长（每秒一次）
      else if (Math.floor(silenceDuration / 1000) !== Math.floor((silenceDuration - 100) / 1000)) {
        console.log(`[Silence] Silent for ${(silenceDuration / 1000).toFixed(1)}s (threshold: ${silenceParagraphThresholdMs / 1000}s, VAD: ${vadEnabled ? 'on' : 'off'})`);
      }
    }

    if (!vadEnabled && shouldResetStream) {
      flushCurrentSegment();
      recognizer.reset(recognizer_stream);
    }

    refreshTranscript();

    let buf = new Int16Array(samples.length);
    for (var i = 0; i < samples.length; ++i) {
      let s = samples[i];
      if (s >= 1)
        s = 1;
      else if (s <= -1)
        s = -1;

      samples[i] = s;
      buf[i] = s * 32767;
    }

    if (shouldKeepAudio) {
      leftchannel.push(buf);
      recordingLength += bufferSize;
    }
  };

  return true;
}

async function startRecording() {
  if (isRecording) {
    return;
  }
  const ready = await ensureRecorderReady();
  if (!ready || !recorder || !mediaStream) {
    return;
  }

  leftchannel = [];
  recordingLength = 0;
  resetSegmentSamples();
  pendingSegmentCarry = null;
  resetStreamingPreview();
  resetVadDetectors();
  lastSpeechActivityMs = nowMs();  // 初始化语音活动时间
  vadSegmentsSinceBreak = 0;
  mediaStream.connect(recorder);
  recorder.connect(audioCtx.destination);
  startWaveformAnimation();

  console.log('recorder started');

  stopBtn.disabled = false;
  startBtn.disabled = true;
  isRecording = true;
}

function stopRecording() {
  if (!recorder || !mediaStream) {
    return;
  }
  console.log('recorder stopped');
  isRecording = false;
  const shouldKeepAudio =
      !!(saveRecordingToggle && saveRecordingToggle.checked);

  recorder.disconnect(audioCtx.destination);
  mediaStream.disconnect(recorder);
  stopWaveformAnimation({clear: true});

  startBtn.style.background = '';
  startBtn.style.color = '';

  stopBtn.disabled = true;
  startBtn.disabled = false;

  if (recognizer_stream != null) {
    if (recognizer.config.modelConfig.paraformer &&
        recognizer.config.modelConfig.paraformer.encoder != '') {
      const tailPaddings = new Float32Array(expectedSampleRate);
      recognizer_stream.acceptWaveform(expectedSampleRate, tailPaddings);
      while (recognizer.isReady(recognizer_stream)) {
        recognizer.decode(recognizer_stream);
      }
    }

    recognizer_stream.inputFinished();
    while (recognizer.isReady(recognizer_stream)) {
      recognizer.decode(recognizer_stream);
    }

    const finalText = recognizer.getResult(recognizer_stream).text;
    if (finalText.length > 0) {
      setStreamingPreview(finalText);
    }
  }

  flushVadDetector();

  if (recognizer_stream != null) {
    flushCurrentSegment({force: true, reason: 'stop'});
    recognizer.reset(recognizer_stream);
  } else {
    flushCurrentSegment({force: true, reason: 'stop'});
  }

  resetVadDetectors();
  refreshTranscript();

  if (shouldKeepAudio && leftchannel.length > 0) {
    var clipName = new Date().toISOString();

    const clipContainer = document.createElement('article');
    const clipLabel = document.createElement('p');
    const audio = document.createElement('audio');
    const deleteButton = document.createElement('button');
    clipContainer.classList.add('clip');
    audio.setAttribute('controls', '');
    deleteButton.textContent = 'Delete';
    deleteButton.className = 'delete';

    clipLabel.textContent = clipName;

    clipContainer.appendChild(audio);

    clipContainer.appendChild(clipLabel);
    clipContainer.appendChild(deleteButton);
    soundClips.appendChild(clipContainer);

    audio.controls = true;
    let samples = flatten(leftchannel);
    const blob = toWav(samples);

    leftchannel = [];
    const audioURL = window.URL.createObjectURL(blob);
    audio.src = audioURL;
    console.log('recorder stopped');

    deleteButton.onclick = function(e) {
      let evtTgt = e.target;
      evtTgt.parentNode.parentNode.removeChild(evtTgt.parentNode);
    };

    clipLabel.onclick = function() {
      const existingName = clipLabel.textContent;
      const newClipName = prompt('Enter a new name for your sound clip?');
      if (newClipName === null) {
        clipLabel.textContent = existingName;
      } else {
        clipLabel.textContent = newClipName;
      }
    };
  } else {
    leftchannel = [];
  }
}

startBtn.onclick = startRecording;
stopBtn.onclick = stopRecording;

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('beforeunload', () => {
    if (punctuationEngine) {
      try {
        punctuationEngine.free();
      } catch (err) {
        console.debug('[Punct] Failed to free engine during unload', err);
      } finally {
        punctuationEngine = null;
        punctuationReady = false;
      }
    }
  });
}

// this function is copied/modified from
// https://gist.github.com/meziantou/edb7217fddfbb70e899e
function flatten(listOfSamples) {
  let n = 0;
  for (let i = 0; i < listOfSamples.length; ++i) {
    n += listOfSamples[i].length;
  }
  let ans = new Int16Array(n);

  let offset = 0;
  for (let i = 0; i < listOfSamples.length; ++i) {
    ans.set(listOfSamples[i], offset);
    offset += listOfSamples[i].length;
  }
  return ans;
}

// this function is copied/modified from
// https://gist.github.com/meziantou/edb7217fddfbb70e899e
function toWav(samples) {
  let buf = new ArrayBuffer(44 + samples.length * 2);
  var view = new DataView(buf);

  // http://soundfile.sapp.org/doc/WaveFormat/
  //                   F F I R
  view.setUint32(0, 0x46464952, true);              // chunkID
  view.setUint32(4, 36 + samples.length * 2, true); // chunkSize
  //                   E V A W
  view.setUint32(8, 0x45564157, true); // format
                                       //
  //                      t m f
  view.setUint32(12, 0x20746d66, true);             // subchunk1ID
  view.setUint32(16, 16, true);                     // subchunk1Size, 16 for PCM
  view.setUint32(20, 1, true);                      // audioFormat, 1 for PCM
  view.setUint16(22, 1, true);                      // numChannels: 1 channel
  view.setUint32(24, expectedSampleRate, true);     // sampleRate
  view.setUint32(28, expectedSampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true);                      // blockAlign
  view.setUint16(34, 16, true);                     // bitsPerSample
  view.setUint32(36, 0x61746164, true);             // Subchunk2ID
  view.setUint32(40, samples.length * 2, true);     // subchunk2Size

  let offset = 44;
  for (let i = 0; i < samples.length; ++i) {
    view.setInt16(offset, samples[i], true);
    offset += 2;
  }

  return new Blob([ view ], {type : 'audio/wav'});
}

// this function is copied from
// https://github.com/awslabs/aws-lex-browser-audio-capture/blob/master/lib/worker.js#L46
function downsampleBuffer(buffer, exportSampleRate) {
  if (exportSampleRate === recordSampleRate) {
    return buffer;
  }
  var sampleRateRatio = recordSampleRate / exportSampleRate;
  var newLength = Math.round(buffer.length / sampleRateRatio);
  var result = new Float32Array(newLength);
  var offsetResult = 0;
  var offsetBuffer = 0;
  while (offsetResult < result.length) {
    var nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    var accum = 0, count = 0;
    for (var i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = accum / count;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
};
