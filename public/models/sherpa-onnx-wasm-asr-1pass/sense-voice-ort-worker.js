// sense-voice-ort-worker.js
//
// Runs SenseVoice CTC on onnxruntime-web with WebGPU (fallback to WASM).
// Message protocol mirrors offline-worker.js:
//  - init: { type: 'init', config: { modelUrl, tokensUrl, language, useItn } }
//  - decode: { type: 'decode', id, audioBuffer, sampleRate }
//  - dispose: { type: 'dispose' }

let ortSession = null;
let tokensTable = [];
let meta = null;
let readyResolve = null;
let readyReject = null;
let readyPromise = null;
let backend = 'webgpu';

const defaultFeatureConfig = {
  sampleRate: 16000,
  frameLength: 25,  // ms
  frameShift: 10,   // ms
  numMelBins: 80,
  preemph: 0.97,
  lowFreq: 20,
  highFreq: null,   // nyquist
  roundToPowerOfTwo: true,
  snipEdges: true,
  windowType: 'hamming',
  normalizeSamples: false,  // scale by 32768 if false
  removeDcOffset: true,
};

let fbankState = null;

function log(...args) {
  console.log('[SenseVoice ORT]', ...args);
}

function warn(...args) {
  console.warn('[SenseVoice ORT]', ...args);
}

function error(...args) {
  console.error('[SenseVoice ORT]', ...args);
}

async function loadOrt() {
  if (self.ort) {
    return;
  }
  try {
    importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.webgpu.min.js');
  } catch (err) {
    warn('Failed to load ort.webgpu from CDN, falling back to ort.wasm', err);
  }
  if (!self.ort) {
    importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js');
  }
  if (!self.ort) {
    throw new Error('onnxruntime-web failed to load');
  }
}

async function createSession(modelUrl) {
  await loadOrt();
  const providers = ['webgpu', 'wasm'];
  try {
    ortSession = await ort.InferenceSession.create(modelUrl, {
      executionProviders: providers,
    });
    backend = ortSession.executionProvider || 'wasm';
    log(`ORT session created with provider ${backend}`);
  } catch (err) {
    error('Failed to create ORT session', err);
    throw err;
  }
}

async function fetchText(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  }
  return resp.text();
}

function parseTokens(tokensText) {
  const lines = tokensText.split(/\r?\n/);
  const maxId = lines.reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed) return acc;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return acc;
    const id = Number(parts[1]);
    return Number.isFinite(id) ? Math.max(acc, id) : acc;
  }, 0);
  const table = new Array(maxId + 1).fill('');
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return;
    const token = parts[0];
    const id = Number(parts[1]);
    if (Number.isFinite(id) && id >= 0 && id < table.length) {
      table[id] = token;
    }
  });
  return table;
}

function parseMeta(session) {
  const custom = session?.metadata?.customMetadataMap || {};
  const toInt = (key, fallback = 0) => {
    const v = custom[key];
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const metaObj = {
    windowSize: toInt('lfr_window_size', 7),
    windowShift: toInt('lfr_window_shift', 6),
    normalizeSamples: toInt('normalize_samples', 0) !== 0,
    vocabSize: toInt('vocab_size', 0),
    blankId: toInt('blank_id', 0),
    withItnId: toInt('with_itn', 14),
    withoutItnId: toInt('without_itn', 15),
    lang: {
      auto: toInt('lang_auto', 0),
      zh: toInt('lang_zh', 0),
      en: toInt('lang_en', 0),
      ja: toInt('lang_ja', 0),
      ko: toInt('lang_ko', 0),
      yue: toInt('lang_yue', 0),
      nospeech: toInt('lang_nospeech', 0),
    },
    negMean: [],
    invStd: [],
  };
  const negMeanStr = custom['neg_mean'] || '';
  const invStdStr = custom['inv_stddev'] || '';
  metaObj.negMean = negMeanStr.split(',').map((x) => Number(x)).filter((x) => Number.isFinite(x));
  metaObj.invStd = invStdStr.split(',').map((x) => Number(x)).filter((x) => Number.isFinite(x));
  return metaObj;
}

function nextPow2(v) {
  let n = 1;
  while (n < v) n <<= 1;
  return n;
}

function createHamming(length) {
  const win = new Float32Array(length);
  const denom = length - 1;
  for (let i = 0; i < length; ++i) {
    win[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / denom);
  }
  return win;
}

function hzToMel(hz) {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel) {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

function createMelFilterbank({ fftSize, sampleRate, numMelBins, lowFreq, highFreq }) {
  const fftBinCount = Math.floor(fftSize / 2) + 1;
  const fMin = lowFreq;
  const fMax = highFreq ?? sampleRate / 2;
  const mMin = hzToMel(fMin);
  const mMax = hzToMel(fMax);
  const melPoints = new Float32Array(numMelBins + 2);
  for (let i = 0; i < melPoints.length; ++i) {
    melPoints[i] = mMin + ((mMax - mMin) * i) / (numMelBins + 1);
  }
  const hzPoints = new Float32Array(melPoints.length);
  for (let i = 0; i < melPoints.length; ++i) {
    hzPoints[i] = melToHz(melPoints[i]);
  }
  const bin = new Float32Array(hzPoints.length);
  for (let i = 0; i < hzPoints.length; ++i) {
    bin[i] = Math.floor((fftSize + 1) * hzPoints[i] / sampleRate);
  }
  const filters = new Array(numMelBins);
  for (let i = 0; i < numMelBins; ++i) {
    const start = bin[i];
    const center = bin[i + 1];
    const end = bin[i + 2];
    const fb = new Float32Array(fftBinCount);
    for (let j = start; j < center; ++j) {
      fb[j] = (j - start) / (center - start + 1e-6);
    }
    for (let j = center; j < end; ++j) {
      fb[j] = (end - j) / (end - center + 1e-6);
    }
    filters[i] = fb;
  }
  return filters;
}

function initFbankState() {
  const cfg = defaultFeatureConfig;
  const frameLength = Math.floor(cfg.sampleRate * cfg.frameLength / 1000);
  const frameShift = Math.floor(cfg.sampleRate * cfg.frameShift / 1000);
  const fftSize = cfg.roundToPowerOfTwo ? nextPow2(frameLength) : frameLength;
  const window = createHamming(frameLength);
  const filters = createMelFilterbank({
    fftSize,
    sampleRate: cfg.sampleRate,
    numMelBins: cfg.numMelBins,
    lowFreq: cfg.lowFreq,
    highFreq: cfg.highFreq ?? cfg.sampleRate / 2,
  });
  fbankState = { frameLength, frameShift, fftSize, window, filters };
}

function fftRadix2(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; ++i) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenReal = Math.cos(ang);
    const wlenImag = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wReal = 1;
      let wImag = 0;
      for (let j = 0; j < len / 2; ++j) {
        const uReal = real[i + j];
        const uImag = imag[i + j];
        const vReal = real[i + j + len / 2] * wReal - imag[i + j + len / 2] * wImag;
        const vImag = real[i + j + len / 2] * wImag + imag[i + j + len / 2] * wReal;
        real[i + j] = uReal + vReal;
        imag[i + j] = uImag + vImag;
        real[i + j + len / 2] = uReal - vReal;
        imag[i + j + len / 2] = uImag - vImag;
        const nextWReal = wReal * wlenReal - wImag * wlenImag;
        const nextWImag = wReal * wlenImag + wImag * wlenReal;
        wReal = nextWReal;
        wImag = nextWImag;
      }
    }
  }
}

function computeFbank(waveform) {
  if (!fbankState) {
    initFbankState();
  }
  const { frameLength, frameShift, fftSize, window, filters } = fbankState;
  const cfg = defaultFeatureConfig;
  const numSamples = waveform.length;
  const numFrames = cfg.snipEdges
    ? Math.floor((numSamples - frameLength) / frameShift) + 1
    : Math.floor((numSamples + frameShift / 2) / frameShift);
  if (numFrames <= 0) {
    return [];
  }
  const fftReal = new Float32Array(fftSize);
  const fftImag = new Float32Array(fftSize);
  const powSpec = new Float32Array(Math.floor(fftSize / 2) + 1);
  const melBins = cfg.numMelBins;
  const feats = new Array(numFrames);
  let offset = 0;
  for (let i = 0; i < numFrames; ++i) {
    fftReal.fill(0);
    fftImag.fill(0);
    for (let j = 0; j < frameLength; ++j) {
      const sample = waveform[offset + j] ?? 0;
      let val = sample;
      if (cfg.removeDcOffset) {
        // handled by mean subtraction outside
      }
      if (cfg.preemph) {
        const prev = j === 0 ? waveform[offset + j] : waveform[offset + j - 1];
        val = sample - cfg.preemph * prev;
      }
      fftReal[j] = val * window[j];
    }
    fftRadix2(fftReal, fftImag);
    for (let k = 0; k < powSpec.length; ++k) {
      powSpec[k] = fftReal[k] * fftReal[k] + fftImag[k] * fftImag[k];
    }
    const melFeat = new Float32Array(melBins);
    for (let m = 0; m < melBins; ++m) {
      const fb = filters[m];
      let e = 0;
      for (let b = 0; b < fb.length; ++b) {
        e += fb[b] * powSpec[b];
      }
      melFeat[m] = Math.log(Math.max(e, 1e-10));
    }
    feats[i] = melFeat;
    offset += frameShift;
  }
  return feats;
}

function applyLfr(feats, windowSize, windowShift) {
  if (!feats || feats.length === 0) return [];
  const inFrames = feats.length;
  const outFrames = Math.floor((inFrames - windowSize) / windowShift) + 1;
  if (outFrames <= 0) return [];
  const featDim = feats[0].length;
  const out = new Array(outFrames);
  for (let i = 0; i < outFrames; ++i) {
    const concat = new Float32Array(featDim * windowSize);
    for (let k = 0; k < windowSize; ++k) {
      const src = feats[i * windowShift + k];
      concat.set(src, k * featDim);
    }
    out[i] = concat;
  }
  return out;
}

function applyCmvn(feats, negMean, invStd) {
  if (!feats || feats.length === 0) return feats;
  const dim = negMean.length;
  const out = new Array(feats.length);
  for (let i = 0; i < feats.length; ++i) {
    const f = feats[i];
    const cmvn = new Float32Array(dim);
    for (let k = 0; k < dim; ++k) {
      cmvn[k] = (f[k] + negMean[k]) * invStd[k];
    }
    out[i] = cmvn;
  }
  return out;
}

function ctcGreedy(logits, vocab, blankId) {
  const [batch, time, vocabSize] = logits.dims;
  if (batch !== 1) {
    throw new Error('Only batch size 1 is supported');
  }
  const data = logits.data;
  const textTokens = [];
  let prev = -1;
  for (let t = 0; t < time; ++t) {
    let maxIdx = 0;
    let maxVal = -Infinity;
    const base = t * vocabSize;
    for (let v = 0; v < vocabSize; ++v) {
      const val = data[base + v];
      if (val > maxVal) {
        maxVal = val;
        maxIdx = v;
      }
    }
    if (maxIdx === blankId || maxIdx === prev) {
      prev = maxIdx;
      continue;
    }
    prev = maxIdx;
    if (maxIdx < 4) {
      continue;  // skip special tokens
    }
    const tok = vocab[maxIdx] || '';
    if (tok) {
      textTokens.push(tok);
    }
  }
  return textTokens.join('');
}

function buildWaveform(raw, normalizeSamples) {
  const out = new Float32Array(raw.length);
  let sum = 0;
  for (let i = 0; i < raw.length; ++i) {
    const val = normalizeSamples ? raw[i] : raw[i] * 32768;
    out[i] = val;
    sum += val;
  }
  const mean = sum / raw.length;
  for (let i = 0; i < out.length; ++i) {
    out[i] = out[i] - mean;
  }
  return out;
}

async function handleInit(msg) {
  const { modelUrl, tokensUrl, language, useItn } = msg.config || {};
  try {
    await createSession(modelUrl || './second-pass-sense-voice.onnx');
    const tokensText = await fetchText(tokensUrl || './second-pass-tokens.txt');
    tokensTable = parseTokens(tokensText);
    meta = parseMeta(ortSession);
    defaultFeatureConfig.normalizeSamples = meta.normalizeSamples;
    log('Metadata', meta);
    readyResolve?.();
    readyResolve = null;
    readyReject = null;
    self.postMessage({
      type: 'ready',
      backend,
      meta,
    });
    self.languagePref = language || 'auto';
    self.useItn = useItn !== 0;
  } catch (err) {
    error('Init failed', err);
    readyReject?.(err);
    readyResolve = null;
    readyReject = null;
    self.postMessage({
      type: 'init-error',
      message: err?.message || String(err),
    });
  }
}

async function handleDecode(msg) {
  if (!ortSession || !meta) {
    throw new Error('Session not ready');
  }
  const audioBuffer = msg.audioBuffer;
  const sampleRate = msg.sampleRate || defaultFeatureConfig.sampleRate;
  if (sampleRate !== defaultFeatureConfig.sampleRate) {
    throw new Error(`Unsupported sample rate: ${sampleRate}, expected ${defaultFeatureConfig.sampleRate}`);
  }
  const samples = new Float32Array(audioBuffer);
  const waveform = buildWaveform(samples, defaultFeatureConfig.normalizeSamples);
  const feats = computeFbank(waveform);
  const lfr = applyLfr(feats, meta.windowSize, meta.windowShift);
  if (!lfr || lfr.length === 0) {
    throw new Error('No features produced');
  }
  const cmvn = applyCmvn(lfr, meta.negMean, meta.invStd);
  const numFrames = cmvn.length;
  const featDim = cmvn[0].length;
  const flattened = new Float32Array(numFrames * featDim);
  for (let i = 0; i < numFrames; ++i) {
    flattened.set(cmvn[i], i * featDim);
  }
  const feeds = {};
  feeds['x'] = new ort.Tensor('float32', flattened, [1, numFrames, featDim]);
  feeds['x_length'] = new ort.Tensor('int64', BigInt64Array.from([BigInt(numFrames)]), [1]);
  const langId = meta.lang[self.languagePref] ?? meta.lang.auto ?? 0;
  feeds['language'] = new ort.Tensor('int64', BigInt64Array.from([BigInt(langId)]), [1]);
  const textNormId = (self.useItn ? meta.withItnId : meta.withoutItnId) ?? meta.withoutItnId;
  feeds['text_norm'] = new ort.Tensor('int64', BigInt64Array.from([BigInt(textNormId)]), [1]);

  const start = performance.now();
  const outputs = await ortSession.run(feeds);
  const elapsedMs = performance.now() - start;
  const logits = outputs['logits'] || Object.values(outputs)[0];
  const text = ctcGreedy(logits, tokensTable, meta.blankId || 0);
  self.postMessage({
    type: 'decode-result',
    id: msg.id,
    result: {
      text,
    },
    elapsedMs,
  });
}

self.onmessage = async (event) => {
  const data = event.data || {};
  const { type } = data;
  if (type === 'init') {
    readyPromise = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    await handleInit(data);
    return;
  }
  if (type === 'decode') {
    try {
      await (readyPromise || Promise.resolve());
      await handleDecode(data);
    } catch (err) {
      error('Decode failed', err);
      self.postMessage({
        type: 'decode-error',
        id: data.id,
        message: err?.message || String(err),
      });
    }
    return;
  }
  if (type === 'dispose') {
    try {
      self.postMessage({ type: 'disposed' });
    } catch (_) {
      // ignore
    }
    close();
  }
};
