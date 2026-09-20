import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Printer, Send, CheckCircle2, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatINR, formatNumber } from "@/lib/utils";
import { formatDate } from "@/lib/date";
import { api } from "@/lib/api";
import { useBillingStore } from "@/stores/billing";
import { useUserStore } from "@/stores/user";
import { canAccessModule } from "@/lib/permissions";
import type { Invoice } from "@/types/billing";

const NEXT_ACTION: Record<string, { label: string; next: string; icon: typeof Send }> = {
  draft: { label: "Mark as Sent", next: "sent", icon: Send },
  sent: { label: "Mark as Paid", next: "paid", icon: CheckCircle2 },
};

export function BillingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const upsert = useBillingStore((s) => s.upsert);
  const user = useUserStore((s) => s.user);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.invoices
      .get(id)
      .then((inv) => {
        setInvoice(inv);
        upsert(inv);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canBilling = user ? canAccessModule(user.role, "billing") : false;

  const advance = async () => {
    if (!invoice || !id) return;
const action = NEXT_ACTION[invoice.status];
    if (!action) return;
    setActing(true);
    setError(null);
    try {
      const updated = await api.invoices.updateStatus(id, action.next);
      setInvoice(updated);
      upsert(updated);
    } catch (e) {
      setError(String(e));
    } finally {
      setActing(false);
    }
  };

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (error && !invoice)
    return (
      <div className="py-24 text-center text-sm text-destructive">
        {error}
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate("/billing")}>
            <ArrowLeft />
            Back to billing
          </Button>
        </div>
      </div>
    );
  if (!invoice) return null;

  const action = NEXT_ACTION[invoice.status];
  const shippingParty = invoice.header.shipping ?? invoice.header.billing;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Invoice {invoice.invoiceNo}
            <StatusBadge status={invoice.status} />
          </span>
        }
        description={`Issued ${formatDate(invoice.invoiceDate)} · ${invoice.challanIds.length} challan${invoice.challanIds.length === 1 ? "" : "s"}`}
        actions={
          <>
            {action && canBilling && invoice.status === "draft" && (
              <Button asChild variant="outline">
                <Link to={`/billing/${invoice.id}/edit`}>
                  <Pencil />
                  Edit
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link to={`/billing/${invoice.id}/print`}>
                <Printer />
                Print
              </Link>
            </Button>
            {action && canBilling && (
              <Button onClick={advance} disabled={acting}>
                <action.icon />
                {action.label}
              </Button>
            )}
          </>
        }
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Parties</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-muted/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Billed To</p>
                <p className="mt-1 font-medium">{invoice.header.billing.name}</p>
                <p className="text-sm text-muted-foreground">{invoice.header.billing.address}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  GSTIN: {invoice.header.billing.gstin || "—"} · {invoice.header.billing.state} ({invoice.header.billing.stateCode})
                </p>
              </div>
              <div className="rounded-lg bg-muted/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shipped To</p>
                <p className="mt-1 font-medium">{shippingParty.name}</p>
                <p className="text-sm text-muted-foreground">{shippingParty.address}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  GSTIN: {shippingParty.gstin || "—"} · {shippingParty.state} ({shippingParty.stateCode})
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border bg-card">
            <h2 className="px-5 pt-5 text-sm font-semibold">Line Items</h2>
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>HSN</TableHead>
                    <TableHead>Particulars</TableHead>
                    <TableHead>Lots</TableHead>
                    <TableHead className="text-right">Rolls</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.lineGroups.map((g) => (
                    <TableRow key={g.hsnCode}>
                      <TableCell className="tabular-nums">{g.hsnCode}</TableCell>
                      <TableCell>{g.particulars}</TableCell>
                      <TableCell>{g.lotNos.join(", ") || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(g.totalRoll)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(g.totalWeight)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(g.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>

        <div className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Totals</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Total Rolls</dt>
                <dd className="tabular-nums">{formatNumber(invoice.totals.totalRoll)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Total Weight</dt>
                <dd className="tabular-nums">{formatNumber(invoice.totals.totalWeight)} kg</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Taxable Amount</dt>
                <dd className="tabular-nums">{formatINR(invoice.totals.taxableAmount)}</dd>
              </div>
              {invoice.taxLines.map((t, i) => (
                <div key={i} className="flex justify-between text-muted-foreground">
                  <dt>
                    {t.isInterState ? "IGST" : "CGST + SGST"} @ {t.gstRate}%
                  </dt>
                  <dd className="tabular-nums text-foreground">{formatINR(t.cgst + t.sgst + t.igst)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <dt>Grand Total</dt>
                <dd className="tabular-nums">{formatINR(invoice.totals.grandTotal)}</dd>
              </div>
            </dl>
          </section>

          {invoice.warnings.length > 0 && (
            <section className="rounded-xl border bg-warning/10 p-4 text-sm">
              <p className="font-medium text-[var(--warning)]">
                {invoice.warnings.length} line item{invoice.warnings.length === 1 ? "" : "s"} skipped (no HSN)
              </p>
              <ul className="mt-1.5 max-h-32 list-inside list-disc space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                {invoice.warnings.map((w) => (
                  <li key={`${w.challanId}-${w.lineItemId}`}>
                    {w.particulars} (lot {w.lotNo})
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}