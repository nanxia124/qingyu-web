let offlineRecognizer = null;
let expectedSampleRate = 16000;
let runtimeReadyResolve = null;
let runtimeReadyReject = null;
const runtimeReady = new Promise((resolve, reject) => {
  runtimeReadyResolve = resolve;
  runtimeReadyReject = reject;
});

console.log('[SenseVoice Worker] Script started, setting up Module');

self.Module = {
  locateFile(path, scriptDirectory = '') {
    console.log('[SenseVoice Worker] locateFile:', path, 'scriptDir:', scriptDirectory);
    return scriptDirectory + path;
  },
  onAbort(reason) {
    console.error('[SenseVoice Worker] Module abort', reason);
    if (runtimeReadyReject) {
      runtimeReadyReject(reason);
      runtimeReadyReject = null;
    }
  },
  onRuntimeInitialized() {
    console.log('[SenseVoice Worker] onRuntimeInitialized called');
    runtimeReadyResolve();
    runtimeReadyResolve = null;
  },
  print(text) {
    console.log('[SenseVoice Worker stdout]', text);
  },
  printErr(text) {
    console.error('[SenseVoice Worker stderr]', text);
  },
  setStatus(text) {
    console.log('[SenseVoice Worker] Module status:', text);
  },
};

console.log('[SenseVoice Worker] Importing WASM runtime and API wrapper');
try {
  importScripts('sherpa-onnx-wasm-main-asr.js');
  console.log('[SenseVoice Worker] sherpa-onnx-wasm-main-asr.js imported');
  importScripts('sherpa-onnx-asr.js');
  console.log('[SenseVoice Worker] sherpa-onnx-asr.js imported successfully');
} catch (err) {
  console.error('[SenseVoice Worker] Failed to import scripts', err);
  if (runtimeReadyReject) {
    runtimeReadyReject(err);
  }
}

function toErrorMessage(err) {
  if (!err) {
    return 'Unknown error';
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err instanceof Error) {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch (jsonErr) {
    return String(err);
  }
}

async function ensureRuntimeReady() {
  return runtimeReady;
}

function ensureRecognizerReady() {
  if (!offlineRecognizer) {
    throw new Error('Offline recognizer not initialised');
  }
  return offlineRecognizer;
}

self.onmessage = async (event) => {
  const data = event.data || {};
  const { type } = data;

  if (type === 'init') {
    console.log('[SenseVoice Worker] Received init message', data);
    expectedSampleRate = data.sampleRate || expectedSampleRate;
    const config = data.config;
    try {
      console.log('[SenseVoice Worker] Awaiting runtime ready...');
      await ensureRuntimeReady();
      console.log('[SenseVoice Worker] Runtime ready, creating OfflineRecognizer with config:', config);
      offlineRecognizer = new OfflineRecognizer(config, Module);
      console.log('[SenseVoice Worker] OfflineRecognizer created successfully');
      self.postMessage({ type: 'ready' });
    } catch (err) {
      const message = toErrorMessage(err);
      console.error('[SenseVoice Worker] init failed', err);
      self.postMessage({ type: 'init-error', message });
    }
    return;
  }

  if (type === 'decode') {
    const jobId = data.id;
    const audioBuffer = data.audioBuffer;
    const sampleRate = data.sampleRate || expectedSampleRate;

    console.log(`[SenseVoice Worker] Decode job #${jobId}: ${audioBuffer?.byteLength || 0} bytes`);

    try {
      await ensureRuntimeReady();
      const recognizer = ensureRecognizerReady();
      const samples = new Float32Array(audioBuffer);
      console.log(`[SenseVoice Worker] Job #${jobId}: ${samples.length} samples @ ${sampleRate} Hz`);
      const start = performance.now();
      const stream = recognizer.createStream();
      stream.acceptWaveform(sampleRate, samples);
      recognizer.decode(stream);
      const result = recognizer.getResult(stream);
      stream.free();
      const elapsedMs = performance.now() - start;
      console.log(`[SenseVoice Worker] Job #${jobId} completed in ${elapsedMs.toFixed(2)}ms`, result);
      self.postMessage({
        type: 'decode-result',
        id: jobId,
        result,
        elapsedMs,
      });
    } catch (err) {
      const message = toErrorMessage(err);
      console.error(`[SenseVoice Worker] Job #${jobId} decode failed`, err);
      self.postMessage({ type: 'decode-error', id: jobId, message });
    }
    return;
  }

  if (type === 'dispose') {
    try {
      if (offlineRecognizer) {
        offlineRecognizer.free();
        offlineRecognizer = null;
      }
    } catch (err) {
      console.error('[SenseVoice Worker] dispose failed', err);
    } finally {
      self.postMessage({ type: 'disposed' });
      close();
    }
    return;
  }
};
