import { useEffect, useRef, useState } from "react";
import { Modal, Input } from "antd";
import { App } from "antd";
import { useTranslation } from "react-i18next";
import { billingApi } from "@/lib/billing";
import { useBillingStore } from "@/stores/useBillingStore";
import { useAuthStore } from "@/stores/useAuthStore";

function deviceLabel(t: (k: string) => string, d?: { displayName?: string; osFamily?: string; browserFamily?: string } | null) {
  if (!d) return t("takeover.deviceUnknown");
  return d.displayName || [d.osFamily, d.browserFamily].filter(Boolean).join(" · ") || t("takeover.deviceUnknown");
}

export default function TakeoverGuard() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const billingUser = useBillingStore((s) => s.user);
  const refreshMe = useBillingStore((s) => s.refreshMe);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const logout = useAuthStore((s) => s.logout);
  const changePassword = useAuthStore((s) => s.changePassword);

  // 新设备（pending）自己的状态
  const [myPending, setMyPending] = useState<{ sessionId: string; status: string } | null>(null);
  // 旧设备轮询到的新登录请求
  const [incoming, setIncoming] = useState<{ sessionId: string; device: any } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);

  // 新设备：自己是 pending 时，每 3 秒查一次自己的状态
  useEffect(() => {
    if (!isLoggedIn) return;
    if (billingUser?.admissionStatus !== "pending") {
      setMyPending(null);
      return;
    }
    let stopped = false;
    const tick = async () => {
      try {
        const st = await billingApi.sessionStatus();
        if (stopped) return;
        if (st.admissionStatus === "pending") {
          setMyPending({ sessionId: st.sessionId || "", status: "pending" });
        } else if (st.admissionStatus === "active") {
          setMyPending(null);
          await refreshMe();
        } else {
          setMyPending({ sessionId: st.sessionId || "", status: st.admissionStatus });
        }
      } catch {
        // 网络抖动，下一轮再试
      }
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [isLoggedIn, billingUser?.admissionStatus, refreshMe]);

  // 旧设备：自己在线时，每 5 秒查有没有新设备请求登录
  useEffect(() => {
    if (!isLoggedIn) return;
    if (billingUser?.admissionStatus !== "active") {
      setIncoming(null);
      return;
    }
    let stopped = false;
    const tick = async () => {
      try {
        const r = await billingApi.pendingTakeover();
        if (stopped) return;
        setIncoming(r.request ? { sessionId: r.request.sessionId, device: r.request.device } : null);
      } catch {
        // 忽略
      }
    };
    const timer = setInterval(tick, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [isLoggedIn, billingUser?.admissionStatus]);

  const handleTakeOver = async () => {
    if (!myPending?.sessionId) return;
    setBusy(true);
    try {
      await billingApi.activateTakeover(myPending.sessionId);
      await refreshMe();
      setMyPending(null);
    } catch (e: any) {
      message.error(e?.message || t("takeover.expired"));
    } finally {
      setBusy(false);
    }
  };

  const handleCancelSelf = async () => {
    if (!myPending?.sessionId) return;
    setBusy(true);
    try {
      await billingApi.denyTakeover(myPending.sessionId);
    } catch { /* 忽略 */ }
    setBusy(false);
    await logout();
  };

  const handleAllow = async () => {
    if (!incoming) return;
    setBusy(true);
    try {
      await billingApi.activateTakeover(incoming.sessionId);
      setIncoming(null);
      await logout();
    } catch (e: any) {
      message.error(e?.message || t("takeover.expired"));
    } finally {
      setBusy(false);
    }
  };

  const handleDeny = async () => {
    if (!incoming) return;
    setBusy(true);
    try {
      await billingApi.denyTakeover(incoming.sessionId);
    } catch { /* 忽略 */ }
    setBusy(false);
    setIncoming(null);
  };

  const handleChangePwd = async () => {
    if (newPwd.length < 8) { message.error(t("pages.account.security.newPwdMin")); return; }
    if (newPwd !== confirmPwd) { message.error(t("pages.account.security.mismatch")); return; }
    setPwdBusy(true);
    try {
      await changePassword(oldPwd, newPwd);
      message.success(t("takeover.pwdChanged"));
      setShowPwd(false);
      await logout();
    } catch (e: any) {
      message.error(e?.message || t("pages.account.security.changeFailed"));
    } finally {
      setPwdBusy(false);
    }
  };

  const newDeviceBlocked = billingUser?.admissionStatus === "pending" && myPending;
  let pendingDevice: any = null;
  try { pendingDevice = JSON.parse(sessionStorage.getItem("pending_takeover_device") || "null"); } catch { /* ignore */ }

  return (
    <>
      {/* 新设备端：确认是否切到这台 */}
      <Modal
        open={!!newDeviceBlocked}
        closable={false}
        maskClosable={false}
        keyboard={false}
        footer={null}
        centered
      >
        <h3 className="text-lg font-bold mb-3">{t("takeover.newTitle")}</h3>
        <p className="text-sm mb-4">{t("takeover.newDesc", { device: deviceLabel(t, pendingDevice) })}</p>
        {myPending?.status === "denied" && <p className="text-sm text-red-400 mb-3">{t("takeover.denied")}</p>}
        {myPending?.status === "expired" && <p className="text-sm text-red-400 mb-3">{t("takeover.expired")}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={handleCancelSelf}
            disabled={busy || myPending?.status !== "pending"}
            className="px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {t("takeover.cancel")}
          </button>
          <button
            onClick={handleTakeOver}
            disabled={busy || myPending?.status !== "pending"}
            className="px-4 py-2 rounded-lg bg-[#5051F8] text-white text-sm disabled:opacity-50"
          >
            {busy ? t("takeover.waiting") : t("takeover.takeOver")}
          </button>
        </div>
      </Modal>

      {/* 旧设备端：新设备请求登录，强制确认 */}
      <Modal
        open={!!incoming}
        closable={false}
        maskClosable={false}
        keyboard={false}
        footer={null}
        centered
      >
        <h3 className="text-lg font-bold mb-3">{t("takeover.oldTitle")}</h3>
        <p className="text-sm mb-2">{t("takeover.oldDesc", { device: deviceLabel(t, incoming?.device) })}</p>
        <p className="text-sm text-red-400 mb-4">{t("takeover.leakWarn")}</p>
        <div className="flex flex-col gap-2">
          <div className="flex justify-end gap-2">
            <button onClick={handleDeny} disabled={busy} className="px-4 py-2 rounded-lg text-sm disabled:opacity-50">
              {t("takeover.deny")}
            </button>
            <button onClick={handleAllow} disabled={busy} className="px-4 py-2 rounded-lg bg-[#5051F8] text-white text-sm disabled:opacity-50">
              {busy ? t("takeover.waiting") : t("takeover.allow")}
            </button>
          </div>
          <div className="text-right">
            <button onClick={() => setShowPwd(true)} className="text-sm text-[#5051F8]">
              {t("takeover.changePwd")}
            </button>
          </div>
        </div>
      </Modal>

      {/* 修改密码弹窗 */}
      <Modal
        open={showPwd}
        title={t("takeover.pwdTitle")}
        onCancel={() => setShowPwd(false)}
        onOk={handleChangePwd}
        confirmLoading={pwdBusy}
        okText={t("takeover.changePwd")}
        cancelText={t("takeover.cancel")}
      >
        <div className="flex flex-col gap-3 pt-2">
          <Input.Password placeholder={t("takeover.oldPwd")} value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} />
          <Input.Password placeholder={t("takeover.newPwd")} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
          <Input.Password placeholder={t("takeover.confirmPwd")} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}

