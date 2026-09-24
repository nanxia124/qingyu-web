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
      const asr = new SpeechASR({
        vadMode: 'silero',
        punctuation: { enabled: true },
        modelPaths: {
          m_path: '/models/sherpa-onnx-wasm-asr-1pass',
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
      });

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
