import { useState, useEffect } from "react";
import { Users, Copy, Check } from "lucide-react";
import { billingApi } from "@/lib/billing";

export default function InviteModal({ onClose }: { onClose: () => void }) {
  const [invite, setInvite] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    billingApi
      .invite()
      .then((data) => setInvite(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const inviteUrl = invite?.inviteCode
    ? `${window.location.origin}/?invite=${invite.inviteCode}`
    : "";

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时降级
    }
  };

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-[24px] bg-card p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-5 top-5 text-gray-500 hover:text-text transition-colors text-lg"
        >
          ✕
        </button>

        {/* 标题 */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-text flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent/10">
              <Users size={18} className="text-accent" />
            </span>
            邀请有礼
          </h2>
          <p className="mt-2 text-sm text-gray-500 leading-relaxed">
            分享你的专属邀请链接，好友注册成功后双方均可获得奖励。
          </p>
        </div>

        {/* 邀请链接 */}
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-500">加载中...</div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteUrl}
                className="flex-1 rounded-xl bg-secondary px-4 py-2.5 text-sm text-text outline-none font-mono"
              />
              <button
                onClick={handleCopy}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "已复制" : "复制"}
              </button>
            </div>

            {invite && (
              <div className="mt-4 flex items-center justify-between rounded-xl bg-secondary px-4 py-3 text-sm">
                <span className="text-gray-500">已邀请好友</span>
                <span className="font-semibold text-text">{invite.invitedCount} 人</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
