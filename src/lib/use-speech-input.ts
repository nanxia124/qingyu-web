import { useCallback, useEffect, useRef, useState } from 'react';
import { SpeechASR } from 'speech-asr';

interface UseSpeechInputOptions {
  onPartial?: (text: string) => void;
  onResult?: (text: string) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

export function useSpeechInput(options: UseSpeechInputOptions = {}) {
  const asrRef = useRef<SpeechASR | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [transcript, setTranscript] = useState('');

  // 保存回调，避免闭包过期
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const init = useCallback(async () => {
    if (asrRef.current || isLoading) return;

    setIsLoading(true);
    try {
      const modelPath = '/models/sherpa-onnx-wasm-asr-1pass';
      // 发布包的类型声明未包含标点配置，独立配置对象保留运行时支持的选项。
      const speechOptions = {
        vadMode: 'silero' as const,
        punctuation: { enabled: true },
        modelPaths: {
          data: `${modelPath}/sherpa-onnx-wasm-main-asr.data`,
          wasmJs: `${modelPath}/sherpa-onnx-wasm-main-asr.js`,
          wasm: `${modelPath}/sherpa-onnx-wasm-main-asr.wasm`,
          asrJs: `${modelPath}/sherpa-onnx-asr.js`,
          vadJs: `${modelPath}/sherpa-onnx-vad.js`,
        },
        onReady: () => {
          setIsReady(true);
          setIsLoading(false);
          callbacksRef.current.onReady?.();
        },
        onPartial: (text: string) => {
          setTranscript(text);
          callbacksRef.current.onPartial?.(text);
        },
        onResult: (text: string) => {
          setTranscript(text);
          callbacksRef.current.onResult?.(text);
        },
        onError: (error: Error) => {
          setIsLoading(false);
          setIsListening(false);
          callbacksRef.current.onError?.(error);
        },
      };
      const asr = new SpeechASR(speechOptions);

      asrRef.current = asr;
      await asr.init();
    } catch (error) {
      setIsLoading(false);
      callbacksRef.current.onError?.(error as Error);
    }
  }, [isLoading]);

  const start = useCallback(async () => {
    if (!asrRef.current || !isReady) {
      await init();
    }
    if (!asrRef.current) return;

    setTranscript('');
    setIsListening(true);
    await asrRef.current.start();
  }, [isReady, init]);

  const stop = useCallback(() => {
    asrRef.current?.stop();
    setIsListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  // 卸载时销毁
  useEffect(() => {
    return () => {
      asrRef.current?.destroy();
      asrRef.current = null;
    };
  }, []);

  return {
    isListening,
    isReady,
    isLoading,
    transcript,
    start,
    stop,
    toggle,
  };
}
