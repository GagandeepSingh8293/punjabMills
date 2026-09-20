import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation, Link } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Save, FileCheck2, Sparkles } from "lucide-react";
import { nanoid } from "nanoid";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/utils";
import { computeTotals, computeLineItemAmount, emptyHeader, emptyLineItem, isLineItemRowValid } from "@/types/challan";
import type { ChallanHeader, DocumentType, LineItem, Party } from "@/types/challan";
import type { FieldsUpdatedPayload } from "@/types/socket-events";
import { findMatchingRateCard } from "@/lib/rate-cards";
import { api } from "@/lib/api";
import { useChallanStore } from "@/stores/challan";
import { useStateStore } from "@/stores/ui-state";

const ROLE_HELPER: Record<DocumentType, string> = {
  incoming: "Details of grey fabric received from your supplier.",
  outgoing: "Details of fabric being sent out — usually returned to the customer after job work.",
  billing: "Billing document",
};

export function ChallanFormPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const upsert = useChallanStore((s) => s.upsert);

  const isEdit = Boolean(id);
  const requestedType = (searchParams.get("type") as DocumentType | null) ?? "incoming";
  const sessionId = (location.state as { sessionId?: string } | null)?.sessionId;

  const [documentType, setDocumentType] = useState<DocumentType>(requestedType);
  const [header, setHeader] = useState<ChallanHeader>(emptyHeader());
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem(nanoid(8))]);
  const [linked, setLinked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState<"draft" | "saved" | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [scanPrefill, setScanPrefill] = useState<FieldsUpdatedPayload | null>(null);

  const customers = useStateStore((s) => s.customers);
  const rateCards = useStateStore((s) => s.rateCards);
  const colours = useStateStore((s) => s.colours);
  const depths = useStateStore((s) => s.depths);
  const processors = useStateStore((s) => s.processors);
  const hsnCodes = useStateStore((s) => s.hsnCodes);
  const pendingIncoming = useStateStore((s) => s.pendingIncoming);

  // Load masters once
  useEffect(() => {
    if (customers.length === 0) api.masters.list("customers").then((r) => useStateStore.getState().setCustomers(r)).catch(() => {});
    if (rateCards.length === 0) api.masters.list("rate-cards").then((r) => useStateStore.getState().setRateCards(r)).catch(() => {});
    if (colours.length === 0) api.masters.list("colours").then((r) => useStateStore.getState().setColours(r)).catch(() => {});
    if (depths.length === 0) api.masters.list("depth").then((r) => useStateStore.getState().setDepths(r)).catch(() => {});
    if (processors.length === 0) api.masters.list("processors").then((r) => useStateStore.getState().setProcessors(r)).catch(() => {});
    if (hsnCodes.length === 0) api.masters.list("hsn-codes").then((r) => useStateStore.getState().setHsnCodes(r)).catch(() => {});
    if (pendingIncoming.length === 0 && documentType === "outgoing") {
      void api.challans.list({ documentType: "incoming", pendingOnly: true, pageSize: 500 }).then((res) => {
        useStateStore.getState().setPendingIncoming(res.items);
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentType]);

  // Load existing challan or scan prefills
  useEffect(() => {
    if (isEdit && id) {
      api.challans.get(id).then((c) => {
        setDocumentType(c.documentType);
        setHeader(c.header);
        setLineItems(c.lineItems.length ? c.lineItems : [emptyLineItem(nanoid(8))]);
        setLinked(
          Object.fromEntries((c.header.linkedIncomingChallanIds ?? []).map((x) => [x, true]))
        );
        setLoading(false);
      }).catch(() => {
        setErrors(["Could not load this challan. It may have been deleted."]);
        setLoading(false);
      });
      return;
    }
    if (sessionId) {
      api.scan.getExtraction(sessionId).then((raw) => {
        const payload = raw as FieldsUpdatedPayload | null;
        if (payload?.header) {
          setHeader((h) => ({ ...h, ...payload.header! }));
          if (payload.lineItems?.length) setLineItems(payload.lineItems);
          setScanPrefill(payload);
        }
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sessionId, isEdit]);

  const totals = useMemo(() => computeTotals(lineItems), [lineItems]);

  function setParty(side: "billing" | "shipping", patch: Partial<Party>) {
    setHeader((h) => ({ ...h, [side]: { ...h[side], ...patch } }));
  }

  function updateLineItem(index: number, patch: Partial<LineItem>) {
    setLineItems((items) =>
      items.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item, ...patch };
        if (patch.processName !== undefined || patch.depth !== undefined) {
          const card = findMatchingRateCard(rateCards, {
            customerName: header.billing.name,
            process: next.processName,
            depth: next.depth,
          });
          if (card && card.value !== undefined && (next.rate === undefined || next.rate === 0)) next.rate = card.value;
        }
        return next;
      })
    );
  }

  function validate(): string[] {
    const issues: string[] = [];
    if (!header.vehicleNo.trim()) issues.push("Vehicle number is required.");
    if (!header.challanDate) issues.push("Challan date is required.");
    for (const side of ["billing", "shipping"] as const) {
      const p = header[side];
      if (!p.name.trim()) issues.push(`${side[0].toUpperCase()}${side.slice(1)} name is required.`);
      if (!p.address.trim()) issues.push(`${side[0].toUpperCase()}${side.slice(1)} address is required.`);
      if (!p.state.trim() || !p.stateCode.trim()) issues.push(`${side[0].toUpperCase()}${side.slice(1)} state is required.`);
    }
    if (documentType === "outgoing") {
      if (!header.dispatchDate) issues.push("Dispatch date is required.");
      else if (header.dispatchDate < header.challanDate) issues.push("Dispatch date cannot be before the challan date.");
      if (!header.transporter?.trim()) issues.push("Transporter is required.");
      if (lineItems.some((li) => !isLineItemRowValid(li))) issues.push("Every line must have rolls, weight and rate filled in.");
    }
    return issues;
  }

  async function save(mode: "draft" | "saved") {
    const issues = validate();
    setErrors(issues);
    if (issues.length) return;

    setSaving(mode);
    const payload = {
      status: mode,
      documentType,
      header: { ...header, linkedIncomingChallanIds: Object.keys(linked).filter((k) => linked[k]) },
      lineItems,
    };
    try {
      const record = isEdit && id
        ? await api.challans.update(id, payload as unknown as Record<string, unknown>, sessionId)
        : await api.challans.create(payload as unknown as Record<string, unknown>, sessionId);
      upsert(record);
      navigate(documentType === "outgoing" ? "/challans/outgoing" : "/challans", { replace: true });
    } catch (e) {
      setErrors([String(e)]);
      setSaving(null);
    }
  }

  if (loading) return <Spinner className="mx-auto mt-16" size={28} />;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title={isEdit ? `Edit ${documentType === "outgoing" ? "Outgoing" : "Incoming"} Challan` : `New ${documentType === "outgoing" ? "Outgoing" : "Incoming"} Challan`}
        description={ROLE_HELPER[documentType]}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to={documentType === "outgoing" ? "/challans/outgoing" : "/challans"}>
              <ArrowLeft />
              Back
            </Link>
          </Button>
        }
      />

      {scanPrefill && (
        <div className="flex items-start gap-2 rounded-md border border-[color-mix(in_oklch,var(--info)_30%,transparent)] bg-[color-mix(in_oklch,var(--info)_8%,white)] px-3 py-2 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--info)]" />
          <p>
            Prefilled from AI scan extraction. Edits you make here are saved as corrections and logged to the session.
          </p>
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <ul className="list-inside list-disc space-y-0.5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Header Details</h2>
          <Badge variant="outline" className="capitalize">
            {documentType}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <fieldset className="space-y-1.5">
            <Label>Challan No.</Label>
            <Input value={header.challanNo ?? ""} onChange={(e) => setHeader((h) => ({ ...h, challanNo: e.target.value || null }))} placeholder={isEdit ? header.challanNo ?? "Auto" : "Auto (on save)"} />
          </fieldset>
          <fieldset className="space-y-1.5">
            <Label>Challan Date</Label>
            <Input type="date" value={header.challanDate} onChange={(e) => setHeader((h) => ({ ...h, challanDate: e.target.value }))} />
          </fieldset>
          <fieldset className="space-y-1.5">
            <Label>E-Way No.</Label>
            <Input value={header.eWayNo ?? ""} onChange={(e) => setHeader((h) => ({ ...h, eWayNo: e.target.value }))} placeholder="Optional" />
          </fieldset>
          <fieldset className="space-y-1.5">
            <Label>Vehicle No.</Label>
            <Input value={header.vehicleNo} onChange={(e) => setHeader((h) => ({ ...h, vehicleNo: e.target.value }))} placeholder="e.g. PB-10-AB-1234" />
          </fieldset>

          {documentType === "outgoing" && (
            <>
              <fieldset className="space-y-1.5">
                <Label>Dispatch Date</Label>
                <Input type="date" value={header.dispatchDate ?? ""} onChange={(e) => setHeader((h) => ({ ...h, dispatchDate: e.target.value }))} />
              </fieldset>
              <fieldset className="space-y-1.5">
                <Label>Transporter</Label>
                <Input list="transporter-suggestions" value={header.transporter ?? ""} onChange={(e) => setHeader((h) => ({ ...h, transporter: e.target.value }))} placeholder="e.g. Goyal Transport" />
                <datalist id="transporter-suggestions">
                  <option value="Goyal Transport Co." />
                  <option value="VRL Logistics" />
                  <option value="Balaji Roadways" />
                  <option value="TCI Freight" />
                </datalist>
              </fieldset>
            </>
          )}
        </div>

        <PartySection
          title="Billing Details"
          party={header.billing}
          showGstin
          onChange={(patch) => setParty("billing", patch)}
          customerNames={customers.map((c) => c.name)}
          showMobile
        />
        <PartySection
          title="Shipping Details"
          party={header.shipping}
          showGstin
          onChange={(patch) => setParty("shipping", patch)}
          customerNames={customers.map((c) => c.name)}
          showMobile
        />

        {documentType === "outgoing" && (
          <div className="space-y-2">
            <Label>Linked Incoming Challans</Label>
            {pendingIncoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending incoming challans available to link.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {pendingIncoming.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm hover:bg-muted/50">
                    <Checkbox checked={Boolean(linked[c.id])} onCheckedChange={(v) => setLinked((prev) => ({ ...prev, [c.id]: Boolean(v) }))} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.header.challanNo}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.header.billing.name}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Line Items</h2>
          <Button size="sm" variant="outline" onClick={() => setLineItems((items) => [...items, emptyLineItem(nanoid(8))])}>
            <Plus />
            Add line
          </Button>
        </div>

        <datalist id="form-colour-list">
          {colours.map((c) => (
            <option key={c.name} value={c.name} />
          ))}
        </datalist>
        <datalist id="form-depth-list">
          {depths.map((d) => (
            <option key={d.name} value={d.name} />
          ))}
        </datalist>
        <datalist id="form-process-list">
          {processors.map((p) => (
            <option key={p.name} value={p.name} />
          ))}
        </datalist>
        <datalist id="form-hsn-list">
          {hsnCodes.map((h) => (
            <option key={h.code} value={h.code} />
          ))}
        </datalist>

        {lineItems.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No line items yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[130px]">Lot No.</TableHead>
                  <TableHead className="min-w-[140px]">Particulars</TableHead>
                  <TableHead className="min-w-[100px]">Process</TableHead>
                  <TableHead className="min-w-[100px]">Colour</TableHead>
                  <TableHead className="min-w-[90px]">Depth</TableHead>
                  <TableHead className="min-w-[90px]">HSN</TableHead>
                  <TableHead className="w-20 text-right">Rolls</TableHead>
                  <TableHead className="w-24 text-right">Weight</TableHead>
                  <TableHead className="w-24 text-right">Rate</TableHead>
                  <TableHead className="w-20 text-right">Rib Rolls</TableHead>
                  <TableHead className="w-24 text-right">Rib Wt.</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.map((item, index) => (
                  <LineItemRow
                    key={item.id}
                    item={item}
                    colourOptions={colours.map((c) => ({ name: c.name, hex: c.hex }))}
                    onChange={(patch) => updateLineItem(index, patch)}
                    onRemove={() => setLineItems((items) => items.filter((_, i) => i !== index))}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t pt-3 text-sm">
          <span className="text-muted-foreground">
            Total Rolls: <strong className="text-foreground tabular-nums">{formatNumber(totals.totalRoll)}</strong>
          </span>
          <span className="text-muted-foreground">
            Total Weight: <strong className="text-foreground tabular-nums">{formatNumber(totals.totalWeight)} kg</strong>
          </span>
          <span className="text-muted-foreground">
            Approx. Amount: <strong className="text-foreground tabular-nums">₹{formatNumber(Math.round(totals.totalApproxAmount))}</strong>
          </span>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={() => save("draft")} disabled={saving !== null}>
          {saving === "draft" && <Spinner size={16} />}
          <Save />
          Save as Draft
        </Button>
        <Button onClick={() => save("saved")} disabled={saving !== null}>
          {saving === "saved" && <Spinner size={16} />}
          <FileCheck2 />
          {isEdit ? "Update Challan" : "Save Challan"}
        </Button>
      </div>
    </div>
  );
}

function PartySection({
  title,
  party,
  onChange,
  customerNames,
  showGstin,
  showMobile,
}: {
  title: string;
  party: Party;
  onChange: (patch: Partial<Party>) => void;
  customerNames: string[];
  showGstin?: boolean;
  showMobile?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <fieldset className="space-y-1.5">
          <Label>Name</Label>
          <Input list="party-names" value={party.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Party name" />
          <datalist id="party-names">
            {customerNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </fieldset>
        <fieldset className="space-y-1.5 sm:col-span-2">
          <Label>Address</Label>
          <Input value={party.address} onChange={(e) => onChange({ address: e.target.value })} placeholder="Street, city" />
        </fieldset>
        {showGstin && (
          <fieldset className="space-y-1.5">
            <Label>GSTIN</Label>
            <Input value={party.gstin ?? ""} onChange={(e) => onChange({ gstin: e.target.value })} placeholder="15-character GSTIN" maxLength={15} />
          </fieldset>
        )}
        <fieldset className="space-y-1.5 sm:col-span-2">
          <Label>State</Label>
          <Input value={party.state} onChange={(e) => onChange({ state: e.target.value })} placeholder="e.g. Gujarat" />
        </fieldset>
        <fieldset className="space-y-1.5">
          <Label>State Code</Label>
          <Input value={party.stateCode} onChange={(e) => onChange({ stateCode: e.target.value })} placeholder="e.g. 24" maxLength={2} />
        </fieldset>
        {showMobile && (
          <fieldset className="space-y-1.5">
            <Label>Mobile</Label>
            <Input value={party.mobile ?? ""} onChange={(e) => onChange({ mobile: e.target.value })} placeholder="Optional" />
          </fieldset>
        )}
      </div>
    </div>
  );
}

function LineItemRow({
  item,
  colourOptions,
  onChange,
  onRemove,
}: {
  item: LineItem;
  colourOptions: { name: string; hex: string }[];
  onChange: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
}) {
  const colour = colourOptions.find((c) => c.name === item.colour);
  const valid = isLineItemRowValid(item);
  return (
    <TableRow className={cn(!valid && item.weight !== undefined && "bg-destructive/5")}>
      <TableCell>
        <Input className="h-8" value={item.lotNo ?? ""} onChange={(e) => onChange({ lotNo: e.target.value })} placeholder="LOT-xxxx" />
      </TableCell>
      <TableCell>
        <Input className="h-8" value={item.particulars ?? ""} onChange={(e) => onChange({ particulars: e.target.value })} placeholder="Dyed Fabric" />
      </TableCell>
      <TableCell>
        <Input list="form-process-list" className="h-8" value={item.processName ?? ""} onChange={(e) => onChange({ processName: e.target.value })} placeholder="Process" />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          {colour && (
            <span className="h-3.5 w-3.5 shrink-0 rounded-full border" style={{ backgroundColor: colour.hex }} />
          )}
          <Input list="form-colour-list" className="h-8" value={item.colour ?? ""} onChange={(e) => onChange({ colour: e.target.value })} placeholder="Colour" />
        </div>
      </TableCell>
      <TableCell>
        <Input list="form-depth-list" className="h-8" value={item.depth ?? ""} onChange={(e) => onChange({ depth: e.target.value })} placeholder="Depth" />
      </TableCell>
      <TableCell>
        <Input list="form-hsn-list" className="h-8" value={item.hsnCode ?? ""} onChange={(e) => onChange({ hsnCode: e.target.value })} placeholder="HSN" />
      </TableCell>
      <TableCell>
        <Input type="number" min={0} className="h-8 text-right" value={item.roll ?? ""} onChange={(e) => onChange({ roll: e.target.value === "" ? undefined : Number(e.target.value) })} />
      </TableCell>
      <TableCell>
        <Input type="number" min={0} className="h-8 text-right" value={item.weight ?? ""} onChange={(e) => onChange({ weight: e.target.value === "" ? undefined : Number(e.target.value) })} />
      </TableCell>
      <TableCell>
        <Input type="number" min={0} className="h-8 text-right" value={item.rate ?? ""} onChange={(e) => onChange({ rate: e.target.value === "" ? undefined : Number(e.target.value) })} />
      </TableCell>
      <TableCell>
        <Input type="number" min={0} className="h-8 text-right" value={item.ribRoll ?? ""} onChange={(e) => onChange({ ribRoll: e.target.value === "" ? undefined : Number(e.target.value) })} />
      </TableCell>
      <TableCell>
        <Input type="number" min={0} className="h-8 text-right" value={item.ribWeight ?? ""} onChange={(e) => onChange({ ribWeight: e.target.value === "" ? undefined : Number(e.target.value) })} />
      </TableCell>
      <TableCell className="text-right tabular-nums">{computeLineItemAmount(item).toFixed(2)}</TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onRemove} title="Remove line">
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}