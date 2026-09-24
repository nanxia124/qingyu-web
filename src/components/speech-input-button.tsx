import { Button, Tooltip } from 'antd';
import { AudioOutlined, AudioFilled, LoadingOutlined } from '@ant-design/icons';
import { useSpeechInput } from '@/lib/use-speech-input';

interface SpeechInputButtonProps {
  onResult: (text: string) => void;
  onPartial?: (text: string) => void;
}

export function SpeechInputButton({ onResult, onPartial }: SpeechInputButtonProps) {
  const { isListening, isLoading, toggle } = useSpeechInput({
    onPartial: (text) => {
      onPartial?.(text);
    },
    onResult: (text) => {
      onResult(text);
    },
  });

  const handleClick = () => {
    if (isLoading) return;
    toggle();
  };

  const icon = isLoading ? (
    <LoadingOutlined />
  ) : isListening ? (
    <AudioFilled style={{ color: '#ff4d4f' }} />
  ) : (
    <AudioOutlined />
  );

  const tooltipTitle = isLoading
    ? '正在加载语音模型...'
    : isListening
      ? '点击停止，语音将自动填入'
      : '点击开始语音输入';

  return (
    <Tooltip title={tooltipTitle}>
      <Button
        type="text"
        size="small"
        icon={icon}
        onClick={handleClick}
        loading={isLoading}
        style={{
          color: isListening ? '#ff4d4f' : 'var(--color-text-secondary)',
        }}
      />
    </Tooltip>
  );
}
