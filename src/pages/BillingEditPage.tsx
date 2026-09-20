import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/date";
import { api } from "@/lib/api";
import { useBillingStore } from "@/stores/billing";
import type { ChallanRecord, Party } from "@/types/challan";
import type { Invoice } from "@/types/billing";

export function BillingEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const upsert = useBillingStore((s) => s.upsert);

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [invoiceDate, setInvoiceDate] = useState("");
  const [billing, setBilling] = useState<Party | null>(null);
  const [shipping, setShipping] = useState<Party | null>(null);
  const [candidates, setCandidates] = useState<ChallanRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      if (!id) return;
      try {
        const inv = await api.invoices.get(id);
        setInvoice(inv);
        setInvoiceDate(inv.invoiceDate);
        setBilling(inv.header.billing);
        setShipping(inv.header.shipping);
        setSelectedIds(new Set(inv.challanIds));
        const res = await api.challans.list({ documentType: "outgoing", pageSize: 500 });
        setCandidates(res.items);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const selectedCount = selectedIds.size;

  async function save() {
    if (!id || !billing || !shipping || selectedIds.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.invoices.updateDetails(id, {
        invoiceDate,
        header: { billing, shipping },
        challanIds: Array.from(selectedIds),
      });
      upsert(updated);
      navigate(`/billing/${id}`, { replace: true });
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (error && !invoice)
    return (
      <div className="py-24 text-center text-sm text-destructive">
        {error}
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate("/billing")}>
            <ArrowLeft />
            Back
          </Button>
        </div>
      </div>
    );
  if (!invoice || !billing || !shipping) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title={`Edit Invoice ${invoice.invoiceNo}`}
        description="Draft invoices can be edited: change the date, parties or the challans included."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to={`/billing/${id}`}>
              <ArrowLeft />
              Back
            </Link>
          </Button>
        }
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Invoice & Parties</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <fieldset className="space-y-1.5">
            <Label>Invoice Date</Label>
            <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </fieldset>
        </div>

        <PartyFields label="Billing Details" party={billing} onChange={setBilling} />
        <PartyFields label="Shipping Details" party={shipping} onChange={setShipping} />
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Included Outgoing Challans</h2>
          <span className="text-xs text-muted-foreground">{selectedCount} selected</span>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Challan No.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Party</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  });
                }}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      });
                    }} />
                  </TableCell>
                  <TableCell className="font-medium">{c.header.challanNo}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(c.header.challanDate)}</TableCell>
                  <TableCell className="truncate max-w-[220px]">{c.header.billing.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(`/billing/${id}`)}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || selectedIds.size === 0}>
          {saving && <Spinner size={16} />}
          <Save />
          Save Changes
        </Button>
      </div>
    </div>
  );
}

function PartyFields({
  label,
  party,
  onChange,
}: {
  label: string;
  party: Party;
  onChange: (p: Party) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <fieldset className="space-y-1.5">
          <Label>Name</Label>
          <Input value={party.name} onChange={(e) => onChange({ ...party, name: e.target.value })} />
        </fieldset>
        <fieldset className="space-y-1.5 sm:col-span-2">
          <Label>Address</Label>
          <Input value={party.address} onChange={(e) => onChange({ ...party, address: e.target.value })} />
        </fieldset>
        <fieldset className="space-y-1.5">
          <Label>GSTIN</Label>
          <Input value={party.gstin ?? ""} maxLength={15} onChange={(e) => onChange({ ...party, gstin: e.target.value })} />
        </fieldset>
        <fieldset className="space-y-1.5">
          <Label>State</Label>
          <Input value={party.state} onChange={(e) => onChange({ ...party, state: e.target.value })} />
        </fieldset>
        <fieldset className="space-y-1.5">
          <Label>State Code</Label>
          <Input value={party.stateCode} maxLength={2} onChange={(e) => onChange({ ...party, stateCode: e.target.value })} />
        </fieldset>
        <fieldset className="space-y-1.5">
          <Label>Mobile</Label>
          <Input value={party.mobile ?? ""} onChange={(e) => onChange({ ...party, mobile: e.target.value })} />
        </fieldset>
      </div>
    </div>
  );
}