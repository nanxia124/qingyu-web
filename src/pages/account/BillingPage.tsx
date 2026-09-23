import { useState, useEffect, useRef } from "react";
import { useTranslation } from 'react-i18next'
import { useAuthStore } from "@/stores/useAuthStore";
import { api } from "@/lib/api";
import { trackEvent, AnalyticsEvent } from "@/lib/analytics";
import { CreditCard, Download, Calendar } from "lucide-react";

interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: "paid" | "pending" | "failed";
  date: string;
  pdfUrl?: string;
}

export default function BillingPage() {
  const { t } = useTranslation()
  const { currentTeam } = useAuthStore();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  // 已经上报过 payment_success 的发票 id，避免每次进页面重复计数
  const reportedPaidRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (currentTeam) {
      fetchInvoices();
    }
  }, [currentTeam]);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const data = await api.get<Invoice[]>(`/teams/${currentTeam?.id}/invoices`);
      setInvoices(data);
      // 检测新出现的已支付发票，上报一次支付成功事件
      for (const inv of data) {
        if (inv.status === "paid" && !reportedPaidRef.current.has(inv.id)) {
          reportedPaidRef.current.add(inv.id);
          trackEvent(AnalyticsEvent.PaymentSuccess, {
            invoice_id: inv.id,
            amount: inv.amount,
            currency: inv.currency,
          });
        }
      }
    } catch (err) {
      console.error("获取发票列表失败", err);
    } finally {
      setLoading(false);
    }
  };

  const handleClickUpgrade = () => {
    trackEvent(AnalyticsEvent.ClickUpgradePlan, {
      current_plan: currentTeam?.plan || "free",
    });
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "paid":
        return t("pages.account.billing.paid");
      case "pending":
        return t("pages.account.billing.pending");
      case "failed":
        return t("pages.account.billing.failed");
      default:
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "paid":
        return "bg-green-500/10 text-green-400";
      case "pending":
        return "bg-yellow-500/10 text-yellow-400";
      case "failed":
        return "bg-red-500/10 text-red-400";
      default:
        return "bg-gray-500/10 text-gray-500";
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-text mb-6">{t("pages.account.billing.title")}</h1>

      {/* 当前订阅 */}
      <div className="bg-card rounded-xl border border-border p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-text">{t("pages.account.billing.currentSub")}</h2>
            <p className="text-sm text-text-muted mt-1">
              {currentTeam?.plan || "免费版"} · 下次续费：2026-10-01
            </p>
          </div>
          <button
            onClick={handleClickUpgrade}
            className="px-4 py-2 rounded-lg bg-[#5051F8] text-white hover:bg-accent-hover transition-colors"
          >
            {t("pages.account.billing.upgrade")}
          </button>
        </div>
      </div>

      {/* 发票列表 */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-medium text-text">{t("pages.account.billing.history")}</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-text-muted">{t("pages.account.billing.loading")}</div>
        ) : invoices.length === 0 ? (
          <div className="p-8 text-center text-text-muted">{t("pages.account.billing.noInvoices")}</div>
        ) : (
          <table className="w-full">
            <thead className="bg-card">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">t("pages.account.billing.invNo")</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">t("pages.account.billing.amount")</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">t("pages.account.billing.status")</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-text-muted">t("pages.account.billing.date")</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-text-muted">t("pages.account.billing.action")</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-border">
                  <td className="px-6 py-4 font-mono text-sm text-text">{invoice.id}</td>
                  <td className="px-6 py-4 text-text">
                    {(invoice.amount / 100).toFixed(2)} {invoice.currency.toUpperCase()}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-1 text-xs rounded-full ${getStatusColor(invoice.status)}`}>
                      {getStatusText(invoice.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-text-muted">
                    {new Date(invoice.date).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {invoice.pdfUrl && (
                      <a
                        href={invoice.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg text-text-muted hover:text-text hover:bg-secondary transition-colors"
                      >
                        <Download size={14} />
                        下载
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
