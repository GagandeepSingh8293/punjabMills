import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, CheckSquare, FilePlus2, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Spinner } from "@/components/ui/spinner";
import { formatINR, formatNumber } from "@/lib/utils";
import { formatDate } from "@/lib/date";
import { buildInvoicePreview } from "@/lib/billing";
import { challanTotalWeight, challanEffectiveStatus } from "@/lib/challan-helpers";
import { api } from "@/lib/api";
import { useStateStore } from "@/stores/ui-state";
import type { ChallanFilterOptions } from "@/types/api";
import type { ChallanRecord } from "@/types/challan";
import type { JobWorkSettings } from "@/types/masters";
import type { TenantSettings } from "@/types/tenant";

export function BillingGeneratePage() {
  const navigate = useNavigate();
  const pushToast = useStateStore((s) => s.pushToast);
  const [challans, setChallans] = useState<ChallanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tenant, setTenant] = useState<TenantSettings | null>(null);
  const [jobWork, setJobWork] = useState<JobWorkSettings>({ sacCode: "9988", gstRate: 5 });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.challans
      .list({ documentType: "outgoing", excludeBilled: true, status: "saved", pageSize: 500 })
      .then((res) => setChallans(res.items))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    api.settings.tenant.get().then(setTenant).catch(() => setTenant(null));
    api.settings.jobWork.get().then(setJobWork).catch(() => setJobWork({ sacCode: "9988", gstRate: 5 as const }));
  }, []);

  const selectedChallans = useMemo(() => challans.filter((c) => selected.has(c.id)), [challans, selected]);

  /** One standalone bill per challan, so each keeps the outgoing challan's number. */
  const previews = useMemo(
    () =>
      selectedChallans.map((challan) => ({
        challan,
        preview: buildInvoicePreview([challan], tenant?.stateCode, jobWork),
      })),
    [selectedChallans, tenant, jobWork]
  );

  const totalGrand = useMemo(
    () => previews.reduce((sum, p) => sum + (p.preview?.totals.grandTotal ?? 0), 0),
    [previews]
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generate = async () => {
    if (selectedChallans.length === 0) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await api.invoices.generate(selectedChallans.map((c) => c.id));
      pushToast(`Generated ${result.created} bill${result.created === 1 ? "" : "s"}`);
      navigate("/billing", { replace: true });
    } catch (e) {
      setError(String(e));
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Generate Invoice"
        description="Select the outgoing challans to bill. Invoicing uses the same HSN grouping and GST logic shown in the preview."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to="/billing">
              <ArrowLeft />
              Back to billing
            </Link>
          </Button>
        }
      />

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <p className="text-sm font-semibold">Unbilled Outgoing Challans</p>
              {challans.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSelected(new Set(selected.size === challans.length ? [] : challans.map((c) => c.id)))
                  }
                >
                  <CheckSquare />
                  {selected.size === challans.length ? "Clear all" : "Select all"}
                </Button>
              )}
            </div>
            {loading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : challans.length === 0 ? (
              <EmptyState
                className="m-4"
                icon={<FilePlus2 className="h-8 w-8" />}
                title="Nothing to bill"
                description="Every outgoing challan on record is already billed, or none are saved yet."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Challan No.</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {challans.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggle(c.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                      </TableCell>
                      <TableCell className="font-medium">{c.header.challanNo}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(c.header.challanDate)}</TableCell>
                      <TableCell className="truncate max-w-[180px]">{c.header.billing.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(challanTotalWeight(c))}</TableCell>
                      <TableCell>
                        <StatusBadge status={challanEffectiveStatus(c)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Selection
            </p>
            <p className="text-2xl font-semibold">
              {selectedChallans.length}
              <span className="text-base font-normal text-muted-foreground"> challan{selectedChallans.length === 1 ? "" : "s"}</span>
            </p>
            {selectedChallans.length > 0 && (
              <Button className="mt-3 w-full" onClick={generate} disabled={generating}>
                {generating ? <Spinner size={16} /> : <FilePlus2 />}
                Generate {selectedChallans.length} bill{selectedChallans.length === 1 ? "" : "s"} · ₹{formatINR(totalGrand).replace("₹", "")}
              </Button>
            )}
          </div>

          {previews.length > 0 && (
            <div className="rounded-xl border bg-card">
              <div className="border-b px-4 py-3">
                <p className="text-sm font-semibold">
                  One bill per challan — {previews.length} invoice{previews.length === 1 ? "" : "s"} to create
                </p>
                <p className="text-xs text-muted-foreground">
                  Each invoice keeps its outgoing challan's number and carries that challan's items.
                </p>
              </div>
              <div className="divide-y px-4 py-2 text-sm">
                {previews.map(({ challan, preview }) => (
                  <div key={challan.id} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{challan.header.challanNo}</p>
                        <p className="truncate text-xs text-muted-foreground">{challan.header.billing.name}</p>
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {preview ? formatINR(preview.totals.grandTotal) : "—"}
                      </span>
                    </div>
                    {preview && (
                      <div className="mt-1 space-y-0.5">
                        {preview.lineGroups.map((g) => (
                          <p key={g.hsnCode} className="truncate text-xs text-muted-foreground">
                            {g.particulars} · HSN {g.hsnCode} · {g.totalRoll} rolls · {formatNumber(g.totalWeight)} kg
                            {g.lotNos.length > 0 && ` · ${g.lotNos.join(", ")}`}
                          </p>
                        ))}
                        {preview.warnings.length > 0 && (
                          <p className="flex items-center gap-1 text-xs text-[var(--warning)]">
                            <TriangleAlert className="h-3.5 w-3.5" />
                            {preview.warnings.length} line item{preview.warnings.length === 1 ? "" : "s"} without HSN skipped.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}