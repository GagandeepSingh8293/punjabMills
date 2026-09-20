import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/spinner";
import { formatINR, formatNumber } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Invoice } from "@/types/billing";
import type { TenantSettings } from "@/types/tenant";

export function BillingPrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [tenant, setTenant] = useState<TenantSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.invoices.get(id).then(setInvoice).catch((e) => setError(String(e)));
    api.settings.tenant.get().then(setTenant).catch(() => setTenant(null));
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [id]);

  if (error) {
    return (
      <div className="py-24 text-center text-sm text-destructive">
        {error}
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft />
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (!invoice || !tenant) return <PageLoader label="Preparing invoice…" />;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft />
          Back
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer />
          Print Invoice
        </Button>
      </div>

      <section className="mx-auto max-w-3xl bg-white p-6 text-[11px] leading-relaxed text-neutral-900 print:max-w-none print:p-0">
        {/* Letterhead */}
        <div className="flex items-start justify-between border-b-2 border-neutral-900 pb-2">
          <div>
            <h1 className="text-lg font-bold uppercase">{tenant.companyName}</h1>
            {tenant.tagline && <p className="text-neutral-600">{tenant.tagline}</p>}
            <p className="text-neutral-600">{tenant.address}</p>
            <p className="text-neutral-600">
              GSTIN: {tenant.gstin} · State: {tenant.state} ({tenant.stateCode})
            </p>
            {tenant.email && <p className="text-neutral-600">Email: {tenant.email}</p>}
            {tenant.phone && <p className="text-neutral-600">Phone: {tenant.phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-base font-bold uppercase">Tax Invoice</p>
            <p className="text-[10px] uppercase tracking-wide text-neutral-600">B2B · Job Work</p>
          </div>
        </div>

        {/* Invoice + party info */}
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div className="space-y-0.5">
            <p>
              <span className="font-semibold">Invoice No:</span> {invoice.invoiceNo}
            </p>
            <p>
              <span className="font-semibold">Invoice Date:</span> {invoice.invoiceDate}
            </p>
            <p>
              <span className="font-semibold">Status:</span> {invoice.status.toUpperCase()}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-neutral-300 p-2">
              <p className="text-[10px] font-bold uppercase">Billed To</p>
              <p className="font-semibold">{invoice.header.billing.name}</p>
              <p>{invoice.header.billing.address}</p>
              <p>GSTIN: {invoice.header.billing.gstin || "—"}</p>
              <p>
                {invoice.header.billing.state} ({invoice.header.billing.stateCode})
              </p>
            </div>
            <div className="border border-neutral-300 p-2">
              <p className="text-[10px] font-bold uppercase">Shipped To</p>
              <p className="font-semibold">{invoice.header.shipping.name}</p>
              <p>{invoice.header.shipping.address}</p>
              <p>GSTIN: {invoice.header.shipping.gstin || "—"}</p>
              <p>
                {invoice.header.shipping.state} ({invoice.header.shipping.stateCode})
              </p>
            </div>
          </div>
        </div>

        {/* Line items */}
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border border-neutral-900 bg-neutral-100">
              <th className="border border-neutral-400 p-1 text-left">#</th>
              <th className="border border-neutral-400 p-1 text-left">HSN</th>
              <th className="border border-neutral-400 p-1 text-left">Particulars</th>
              <th className="border border-neutral-400 p-1 text-left">Lot No(s)</th>
              <th className="border border-neutral-400 p-1 text-right">Rolls</th>
              <th className="border border-neutral-400 p-1 text-right">Weight (kg)</th>
              <th className="border border-neutral-400 p-1 text-right">Rate</th>
              <th className="border border-neutral-400 p-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineGroups.map((g, i) => {
              const rate = g.amount / (g.totalWeight || 1);
              return (
                <tr key={g.hsnCode}>
                  <td className="border border-neutral-300 p-1">{i + 1}</td>
                  <td className="border border-neutral-300 p-1">{g.hsnCode}</td>
                  <td className="border border-neutral-300 p-1">{g.particulars}</td>
                  <td className="border border-neutral-300 p-1">{g.lotNos.join(", ") || "—"}</td>
                  <td className="border border-neutral-300 p-1 text-right">{formatNumber(g.totalRoll)}</td>
                  <td className="border border-neutral-300 p-1 text-right">{formatNumber(g.totalWeight)}</td>
                  <td className="border border-neutral-300 p-1 text-right">{formatINR(rate)}</td>
                  <td className="border border-neutral-300 p-1 text-right">{formatINR(g.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-2 flex justify-end">
          <table className="w-64 border-collapse">
            <tbody>
              <tr>
                <td className="border border-neutral-300 p-1">Taxable Amount</td>
                <td className="border border-neutral-300 p-1 text-right">{formatINR(invoice.totals.taxableAmount)}</td>
              </tr>
              {invoice.taxLines.flatMap((t) =>
                (t.isInterState
                  ? [{ key: "igst", label: "IGST", value: t.igst }]
                  : [
                      { key: "cgst", label: "CGST", value: t.cgst },
                      { key: "sgst", label: "SGST", value: t.sgst },
                    ]
                ).map((row) => (
                  <tr key={row.key}>
                    <td className="border border-neutral-300 p-1">
                      {row.label} @ {t.gstRate / (t.isInterState ? 1 : 2)}%
                    </td>
                    <td className="border border-neutral-300 p-1 text-right">{formatINR(row.value)}</td>
                  </tr>
                ))
              )}
              <tr className="bg-neutral-100 font-bold">
                <td className="border border-neutral-400 p-1">Grand Total</td>
                <td className="border border-neutral-400 p-1 text-right">{formatINR(invoice.totals.grandTotal)}</td>
              </tr>
              <tr>
                <td colSpan={2} className="border border-neutral-300 p-1 text-[10px] text-neutral-600">
                  Amount in words: {formatINR(invoice.totals.grandTotal).replace("₹", "Rs. ")} only.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Bank + terms */}
        <div className="mt-4 grid grid-cols-2 gap-6 text-[10px] text-neutral-700">
          <div className="space-y-0.5">
            <p className="text-[10px] font-bold uppercase">Terms & Conditions</p>
            <p>1. Subject to {tenant.state} jurisdiction.</p>
            <p>2. Goods once sold will not be taken back.</p>
            <p>3. Interest @ 18% p.a. on overdue payments.</p>
            {invoice.warnings.length > 0 && (
              <p className="mt-1">
                Note: {invoice.warnings.length} line item(s) without HSN skipped.
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="mb-10">For {tenant.companyName}</p>
            <div className="ml-auto w-44 border-t border-neutral-900 pt-1 text-[10px]">
              Authorised Signatory
            </div>
          </div>
        </div>
      </section>

      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>
    </div>
  );
}