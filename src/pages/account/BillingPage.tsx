import { useState, useEffect, useMemo } from "react";
import { useAuthStore } from "@/stores/useAuthStore";
import { useBillingStore } from "@/stores/useBillingStore";
import { billingApi, type Order, type InvoiceRequest } from "@/lib/billing";
import { CreditCard, Download, FileText, Loader2 } from "lucide-react";

const STATUS_TEXT: Record<string, { label: string; cls: string }> = {
  pending: { label: "待处理", cls: "bg-yellow-500/10 text-yellow-400" },
  processing: { label: "开票中", cls: "bg-blue-500/10 text-blue-400" },
  completed: { label: "已完成", cls: "bg-green-500/10 text-green-400" },
  failed: { label: "已拒绝", cls: "bg-red-500/10 text-red-400" },
};

export default function BillingPage() {
  const { user: authUser, isLoggedIn } = useAuthStore();
  const { user: billingUser, initFromAuth, refreshMe } = useBillingStore();

  const [tab, setTab] = useState<"apply" | "records">("apply");
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [automaticRenewalEnabled, setAutomaticRenewalEnabled] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showApply, setShowApply] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 申请表单
  const [titleType, setTitleType] = useState<"personal" | "company">("personal");
  const [titleName, setTitleName] = useState("");
  const [taxNo, setTaxNo] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (isLoggedIn && authUser) {
      initFromAuth({ id: authUser.id, email: authUser.email }).then(() => refreshMe());
      billingApi.renewalStatus().then((status) => setAutomaticRenewalEnabled(status.automaticRenewalEnabled)).catch(() => setAutomaticRenewalEnabled(false));
    }
  }, [isLoggedIn, authUser?.id]);

  const loadOrders = async () => {
    try {
      const list = await billingApi.orders();
      setOrders(list);
    } catch (e: any) {
      console.error("加载订单失败", e);
    } finally {
      setLoading(false);
    }
  };

  const loadInvoices = async () => {
    try {
      setInvoices(await billingApi.listInvoiceRequests());
    } catch (e: any) {
      console.error("加载开票记录失败", e);
    }
  };

  useEffect(() => { loadOrders(); loadInvoices(); }, []);

  const paidOrders = useMemo(() => orders.filter((o) => o.status === "paid"), [orders]);
  const selectedOrders = useMemo(() => paidOrders.filter((o) => selected.has(o.id)), [paidOrders, selected]);
  const selectedTotal = selectedOrders.reduce((s, o) => s + o.amountCents, 0);

  const toggleOrder = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openApply = () => {
    setMsg(null);
    setShowApply(true);
  };

  const submitApply = async () => {
    if (!titleName.trim()) { setMsg({ type: "error", text: "请填写发票抬头" }); return; }
    if (titleType === "company" && !taxNo.trim()) { setMsg({ type: "error", text: "企业抬头请填写税号" }); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setMsg({ type: "error", text: "请填写正确的收票邮箱" }); return; }
    if (selectedOrders.length === 0) { setMsg({ type: "error", text: "请至少勾选一笔已支付订单" }); return; }

    setSubmitting(true);
    setMsg(null);
    try {
      await billingApi.createInvoiceRequest({
        titleType,
        titleName: titleName.trim(),
        taxNo: taxNo.trim(),
        email: email.trim(),
        orderIds: selectedOrders.map((o) => o.id),
      });
      setShowApply(false);
      setSelected(new Set());
      setTitleName(""); setTaxNo(""); setEmail("");
      setMsg({ type: "success", text: "开票申请已提交，我们会在 1-3 个工作日内处理" });
      await loadInvoices();
      await loadOrders();
    } catch (e: any) {
      setMsg({ type: "error", text: e.message || "提交失败，请稍后重试" });
    } finally {
      setSubmitting(false);
    }
  };

  const expireText = billingUser?.memberExpireAt
    ? new Date(billingUser.memberExpireAt).toLocaleDateString()
    : "—";
  const planText = billingUser?.memberActive
    ? billingUser.memberLevel === "pro" ? "Pro" : billingUser.memberLevel === "team" ? "团队版" : billingUser.memberLevel
    : "免费版";

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-text mb-6">账单与发票</h1>

      {/* 当前订阅 */}
      <div className="bg-card rounded-xl border border-border p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-text">当前订阅</h2>
            <p className="text-sm text-text-muted mt-1">
              {planText} · {billingUser?.memberActive ? `有效期至：${expireText}` : "当前无生效订阅"}
              {billingUser?.memberActive && <span className="block">自动续费：{automaticRenewalEnabled ? "已开启" : "未开启，不会自动扣款"}</span>}
            </p>
          </div>
          <CreditCard size={28} className="text-accent" />
        </div>
      </div>

      {msg && (
        <div className={`mb-4 p-3 rounded-lg ${msg.type === "success" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
          {msg.text}
        </div>
      )}

      {/* Tab */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {([["apply", "申请开票"], ["records", "开票记录"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${tab === k ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 申请开票 */}
      {tab === "apply" && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-lg font-medium text-text">选择已支付订单合并开票</h2>
            <button
              onClick={openApply}
              disabled={selectedOrders.length === 0}
              className="px-4 py-2 rounded-lg bg-[#5051F8] text-white text-sm hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              申请开票{selectedOrders.length > 0 ? `（¥${(selectedTotal / 100).toFixed(2)}）` : ""}
            </button>
          </div>
          {loading ? (
            <div className="p-8 text-center text-text-muted"><Loader2 className="animate-spin inline mr-2" size={16} />加载中...</div>
          ) : paidOrders.length === 0 ? (
            <div className="p-8 text-center text-text-muted">暂无已支付订单</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-secondary">
                <tr>
                  <th className="w-10 px-4 py-3"></th>
                  <th className="text-left px-4 py-3 text-text-muted font-medium">订单号</th>
                  <th className="text-left px-4 py-3 text-text-muted font-medium">套餐</th>
                  <th className="text-left px-4 py-3 text-text-muted font-medium">金额</th>
                  <th className="text-left px-4 py-3 text-text-muted font-medium">支付时间</th>
                </tr>
              </thead>
              <tbody>
                {paidOrders.map((o) => {
                  const checked = selected.has(o.id);
                  return (
                    <tr key={o.id} className="border-t border-border" onClick={() => toggleOrder(o.id)}>
                      <td className="px-4 py-3 text-center">
                        <input type="checkbox" checked={checked} onChange={() => toggleOrder(o.id)} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-text-muted">{o.id.slice(0, 12)}</td>
                      <td className="px-4 py-3 text-text">{o.planId}</td>
                      <td className="px-4 py-3 text-text">¥{(o.amountCents / 100).toFixed(2)}</td>
                      <td className="px-4 py-3 text-text-muted">{o.paidAt ? new Date(o.paidAt).toLocaleDateString() : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 开票记录 */}
      {tab === "records" && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-lg font-medium text-text">我的开票申请</h2>
          </div>
          {invoices.length === 0 ? (
            <div className="p-8 text-center text-text-muted">暂无开票记录</div>
          ) : (
            <div className="divide-y divide-border">
              {invoices.map((inv) => {
                const st = STATUS_TEXT[inv.status] || STATUS_TEXT.pending;
                return (
                  <div key={inv.id} className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText size={18} className="text-text-muted" />
                        <div>
                          <div className="text-text font-medium">{inv.titleName} <span className="text-xs text-text-muted">（{inv.titleType === "company" ? "企业" : "个人"}）</span></div>
                          <div className="text-xs text-text-muted mt-0.5">
                            {new Date(inv.createdAt).toLocaleString()} · {inv.orders.length} 笔订单 · ¥{(inv.totalCents / 100).toFixed(2)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex px-2 py-1 text-xs rounded-full ${st.cls}`}>{st.label}</span>
                        {inv.status === "completed" && inv.pdfUrl && (
                          <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
                            <Download size={14} /> 下载发票
                          </a>
                        )}
                        {inv.status === "failed" && inv.rejectReason && (
                          <span className="text-xs text-red-400">拒绝原因：{inv.rejectReason}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 申请弹窗 */}
      {showApply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => !submitting && setShowApply(false)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-text mb-4">申请开票（共 {selectedOrders.length} 笔，¥{(selectedTotal / 100).toFixed(2)}）</h2>
            <div className="space-y-3">
              <div className="flex gap-2">
                {(["personal", "company"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTitleType(type)}
                    className={`flex-1 py-2 rounded-lg text-sm transition-colors ${titleType === type ? "bg-[#5051F8] text-white" : "bg-secondary text-text-muted hover:text-text"}`}
                  >
                    {type === "personal" ? "个人抬头" : "企业抬头"}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={titleName}
                onChange={(e) => setTitleName(e.target.value)}
                placeholder={titleType === "company" ? "企业全称" : "个人姓名"}
                autoFocus
                className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none"
              />
              {titleType === "company" && (
                <input
                  type="text"
                  value={taxNo}
                  onChange={(e) => setTaxNo(e.target.value)}
                  placeholder="税号"
                  className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none"
                />
              )}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="收票邮箱"
                className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-text placeholder:text-text-muted focus:border-accent outline-none"
              />
              <p className="text-xs text-text-muted">电子发票将在开具完成后发送到此邮箱，通常 1-3 个工作日。</p>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setShowApply(false)} disabled={submitting} className="px-4 py-2 rounded-lg text-text-muted hover:text-text transition-colors">取消</button>
              <button onClick={submitApply} disabled={submitting} className="px-4 py-2 rounded-lg bg-[#5051F8] text-white hover:bg-accent-hover disabled:opacity-50 transition-colors">
                {submitting ? "提交中..." : "提交申请"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
