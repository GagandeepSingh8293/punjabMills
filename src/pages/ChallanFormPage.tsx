import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams, useSearchParams, useLocation, Link } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Save, FileCheck2, Sparkles, ScanLine, Search } from "lucide-react";
import { nanoid } from "nanoid";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/utils";
import { formatDate } from "@/lib/date";
import { computeTotals, computeLineItemAmount, emptyHeader, emptyLineItem, isLineItemRowValid } from "@/types/challan";
import type { ChallanHeader, ChallanRecord, DocumentType, LineItem, Party, ScannedPhoto } from "@/types/challan";
import type { FieldsUpdatedPayload } from "@/types/socket-events";
import type { ShadeRecord } from "@/types/masters";
import { ScanFlowDialog } from "@/components/scan/ScanFlowDialog";
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
  const sessionId =
    (location.state as { sessionId?: string } | null)?.sessionId ?? searchParams.get("session") ?? undefined;

  const [documentType, setDocumentType] = useState<DocumentType>(requestedType);
  const [header, setHeader] = useState<ChallanHeader>(emptyHeader());
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem(nanoid(8))]);
  const [autoWeights, setAutoWeights] = useState<Record<string, boolean>>({});
  const [linked, setLinked] = useState<Record<string, boolean>>({});
  const [linkedSearch, setLinkedSearch] = useState("");
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState<"draft" | "saved" | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [scanPrefill, setScanPrefill] = useState<FieldsUpdatedPayload | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [photos, setPhotos] = useState<ScannedPhoto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  const customers = useStateStore((s) => s.customers);
  const rateCards = useStateStore((s) => s.rateCards);
  const colours = useStateStore((s) => s.colours);
  const depths = useStateStore((s) => s.depths);
  const shades = useStateStore((s) => s.shades);
  const processors = useStateStore((s) => s.processors);
  const hsnCodes = useStateStore((s) => s.hsnCodes);
  const pendingIncoming = useStateStore((s) => s.pendingIncoming);

  // Load masters once
  useEffect(() => {
    if (customers.length === 0) api.masters.list("customers").then((r) => useStateStore.getState().setCustomers(r)).catch(() => {});
    if (rateCards.length === 0) api.masters.list("rate-cards").then((r) => useStateStore.getState().setRateCards(r)).catch(() => {});
    if (colours.length === 0) api.masters.list("colours").then((r) => useStateStore.getState().setColours(r)).catch(() => {});
    if (depths.length === 0) api.masters.list("depth").then((r) => useStateStore.getState().setDepths(r)).catch(() => {});
    if (shades.length === 0) api.masters.list("shades").then((r) => useStateStore.getState().setShades(r)).catch(() => {});
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
        setPhotos(c.photos ?? []);
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
  const showAmount = documentType === "outgoing";

  function setParty(side: "billing" | "shipping", patch: Partial<Party>) {
    setHeader((h) => ({ ...h, [side]: { ...h[side], ...patch } }));
  }

  function updateLineItem(index: number, patch: Partial<LineItem>) {
    setLineItems((items) =>
      items.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item, ...patch };
        if (patch.roll !== undefined && autoWeights[item.id] !== false) {
          const rolls = next.roll ?? 0;
          next.weight = rolls > 0 ? Math.round(rolls * 20 * 10) / 10 : 0;
        }
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

  const shadeOptions = useMemo<ShadeRecord[]>(() => {
    const seen = new Set<string>();
    const all: ShadeRecord[] = [];
    for (const s of shades) {
      const key = `${s.name}|${s.depth}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(s);
    }
    for (const c of colours) {
      const key = `${c.name}|-`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ id: c.id, name: c.name, depth: "-", hex: c.hex, createdAt: c.createdAt });
    }
    return all;
  }, [shades, colours]);

  const filteredLinked = useMemo(() => {
    const q = linkedSearch.trim().toLowerCase();
    if (!q) return [];
    return pendingIncoming.filter(
      (c) =>
        (c.header.challanNo ?? "").toLowerCase().includes(q) ||
        c.header.billing.name.toLowerCase().includes(q) ||
        c.header.vehicleNo.toLowerCase().includes(q)
    );
  }, [pendingIncoming, linkedSearch]);

  /** Link an incoming challan to the outgoing one AND copy its party details into the header. */
  function useIncoming(challan: ChallanRecord) {
    setLinked((prev) => {
      const next = { ...prev };
      if (next[challan.id]) {
        delete next[challan.id];
      } else {
        next[challan.id] = true;
      }
      return next;
    });
    const billing = challan.header.billing;
    const shipping = challan.header.shipping ?? billing;
    setHeader((h) => ({ ...h, billing: { ...billing }, shipping: { ...shipping } }));
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
      <ScanFlowDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        mode={isEdit ? "existing" : "new"}
        existingId={id}
        type={documentType}
      />
      <PageHeader
        title={isEdit ? `Edit ${documentType === "outgoing" ? "Outgoing" : "Incoming"} Challan` : `New ${documentType === "outgoing" ? "Outgoing" : "Incoming"} Challan`}
        description={ROLE_HELPER[documentType]}
        actions={
          <>
            {documentType === "incoming" && (
              <Button variant="outline" size="sm" onClick={() => setScanOpen(true)}>
                <ScanLine />
                Scan from phone
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link to={documentType === "outgoing" ? "/challans/outgoing" : "/challans"}>
                <ArrowLeft />
                Back
              </Link>
            </Button>
          </>
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

      {photos.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Scan photos ({photos.length})</h2>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {photos.map((p) => (
              <ScannedPhotoThumb key={p.photoId} photo={p} dataUrl={photoUrls[p.photoId]} onLoad={setPhotoUrls} />
            ))}
          </div>
        </section>
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

      {documentType === "outgoing" && (
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <div>
            <h2 className="text-sm font-semibold">Link an Incoming Challan (optional)</h2>
            <p className="text-xs text-muted-foreground">
              Search an incoming challan to fill this outgoing challan's parties and link the two. Type to see matches —
              nothing shows until you search.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search challan no., party, vehicle…"
              value={linkedSearch}
              onChange={(e) => setLinkedSearch(e.target.value)}
            />
          </div>
          {linkedSearch.trim() === "" ? (
            <p className="text-sm text-muted-foreground">Start typing to search pending incoming challans.</p>
          ) : filteredLinked.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matching incoming challans.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {filteredLinked.map((c) => {
                const checked = Boolean(linked[c.id]);
                return (
                  <div
                    key={c.id}
                    onClick={() => useIncoming(c)}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm transition-colors hover:bg-muted/50",
                      checked && "border-primary/60 bg-primary/5"
                    )}
                  >
                    <Checkbox checked={checked} onClick={(e) => e.stopPropagation()} onCheckedChange={() => useIncoming(c)} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.header.challanNo ?? c.id.slice(0, 8)}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.header.billing.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Incoming date: <span className="tabular-nums">{formatDate(c.header.challanDate)}</span> ·{" "}
                        {formatNumber(c.lineItems.reduce((s, li) => s + (li.weight ?? 0) + (li.ribWeight ?? 0), 0))} kg
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
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
        <datalist id="form-shade-list">
          {shadeOptions.map((s) => (
            <option key={`${s.name}|${s.depth}`} value={s.depth && s.depth !== "-" ? `${s.name} · ${s.depth}` : s.name} />
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
          <div className="space-y-3">
            {lineItems.map((item, index) => (
              <LineItemCard
                key={item.id}
                item={item}
                index={index}
                colourOptions={colours.map((c) => ({ name: c.name, hex: c.hex }))}
                shadeOptions={shadeOptions}
                showAmount={showAmount}
                autoWeight={autoWeights[item.id] !== false}
                onToggleAutoWeight={() => setAutoWeights((prev) => ({ ...prev, [item.id]: prev[item.id] === false }))}
                onChange={(patch) => updateLineItem(index, patch)}
                onRemove={() => setLineItems((items) => items.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t pt-3 text-sm">
          <span className="text-muted-foreground">
            Total Rolls: <strong className="text-foreground tabular-nums">{formatNumber(totals.totalRoll)}</strong>
          </span>
          <span className="text-muted-foreground">
            Total Weight: <strong className="text-foreground tabular-nums">{formatNumber(totals.totalWeight)} kg</strong>
          </span>
          {showAmount && (
            <span className="text-muted-foreground">
              Approx. Amount: <strong className="text-foreground tabular-nums">₹{formatNumber(Math.round(totals.totalApproxAmount))}</strong>
            </span>
          )}
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

function LineField({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <fieldset className={cn("space-y-1", className)}>
      <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label>
      {children}
    </fieldset>
  );
}

function LineItemCard({
  item,
  index,
  colourOptions,
  shadeOptions,
  showAmount,
  autoWeight,
  onToggleAutoWeight,
  onChange,
  onRemove,
}: {
  item: LineItem;
  index: number;
  colourOptions: { name: string; hex: string }[];
  shadeOptions: ShadeRecord[];
  showAmount: boolean;
  autoWeight: boolean;
  onToggleAutoWeight: () => void;
  onChange: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
}) {
  const colour = colourOptions.find((c) => c.name === item.colour) ?? shadeOptions.find((s) => s.name === item.colour);
  const shadeHex = shadeOptions.find((s) => s.name === item.colour && (s.depth === item.depth || s.depth === "-" || item.depth === ""))?.hex ?? colour?.hex;
  const valid = isLineItemRowValid(item);
  const invalid = !valid && item.weight !== undefined;

  const setShade = (raw: string) => {
    const hasDepth = raw.includes(" · ");
    const colourPart = (hasDepth ? raw.split(" · ")[0] : raw).trim();
    const depthPart = hasDepth ? raw.split(" · ")[1].trim() : "";
    onChange({
      colour: colourPart || undefined,
      depth: depthPart === "-" ? "" : depthPart || undefined,
    });
  };
  const shadeValue = item.depth && item.depth !== "-" ? `${item.colour ?? ""} · ${item.depth}` : (item.colour ?? "");

  return (
    <div className={cn("rounded-xl border bg-muted/20 p-3 sm:p-4", invalid && "border-destructive/40")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line {index + 1}</p>
        <div className="flex items-center gap-2">
          {showAmount && (
            <span className="text-sm text-muted-foreground tabular-nums">
              Amount: <strong className="text-foreground">₹{computeLineItemAmount(item).toFixed(2)}</strong>
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onRemove} title="Remove line">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <LineField label="Lot No.">
          <Input className="h-9" value={item.lotNo ?? ""} onChange={(e) => onChange({ lotNo: e.target.value })} placeholder="LOT-xxxx" />
        </LineField>
        <LineField label="Particulars" className="col-span-2 sm:col-span-1">
          <Input className="h-9" value={item.particulars ?? ""} onChange={(e) => onChange({ particulars: e.target.value })} placeholder="Dyed Fabric" />
        </LineField>
        <LineField label="Process">
          <Input list="form-process-list" className="h-9" value={item.processName ?? ""} onChange={(e) => onChange({ processName: e.target.value })} placeholder="Process" />
        </LineField>
        <LineField label="Colour · Depth">
          <div className="flex items-center gap-1.5">
            {shadeHex && item.colour && <span className="h-4 w-4 shrink-0 rounded-full border" style={{ backgroundColor: shadeHex }} />}
            <Input
              list="form-shade-list"
              className="h-9"
              value={shadeValue}
              onChange={(e) => setShade(e.target.value)}
              placeholder="Colour · Depth"
            />
          </div>
        </LineField>
        <LineField label="HSN">
          <Input list="form-hsn-list" className="h-9" value={item.hsnCode ?? ""} onChange={(e) => onChange({ hsnCode: e.target.value })} placeholder="HSN" />
        </LineField>
        <LineField label="Rolls">
          <Input type="number" min={0} className="h-9" value={item.roll ?? ""} onChange={(e) => onChange({ roll: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </LineField>
        <LineField label="Weight (kg)">
          <div className="flex items-center gap-1.5">
            <Input type="number" min={0} className="h-9" value={item.weight ?? ""} onChange={(e) => onChange({ weight: e.target.value === "" ? undefined : Number(e.target.value) })} />
            <button
              type="button"
              onClick={onToggleAutoWeight}
              title={autoWeight ? "Auto weight on: ~20 kg per roll" : "Auto weight off — enter weight manually"}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold transition-colors",
                autoWeight ? "border-primary/40 bg-primary/10 text-primary" : "border-input bg-card text-muted-foreground"
              )}
            >
              ≈20
            </button>
          </div>
        </LineField>
        <LineField label="Rate (₹)">
          <Input type="number" min={0} className="h-9" value={item.rate ?? ""} onChange={(e) => onChange({ rate: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="0.00" />
        </LineField>
        <LineField label="Rib Rolls">
          <Input type="number" min={0} className="h-9" value={item.ribRoll ?? ""} onChange={(e) => onChange({ ribRoll: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </LineField>
        <LineField label="Rib Wt. (kg)">
          <Input type="number" min={0} className="h-9" value={item.ribWeight ?? ""} onChange={(e) => onChange({ ribWeight: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </LineField>
      </div>

      {invalid && (
        <p className="mt-2 text-xs text-destructive">Fill rolls, weight and rate to complete this line.</p>
      )}
    </div>
  );
}

function ScannedPhotoThumb({
  photo,
  dataUrl,
  onLoad,
}: {
  photo: ScannedPhoto;
  dataUrl?: string;
  onLoad: (urls: Record<string, string>) => void;
}) {
  useEffect(() => {
    if (dataUrl) return;
    api.scan.photo(photo.photoId).then((p) => {
      if (p?.dataUrl) onLoad({ [photo.photoId]: p.dataUrl });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.photoId, dataUrl]);

  if (!dataUrl) {
    return <div className="h-36 w-28 animate-pulse rounded-md border bg-muted" />;
  }
  return (
    <div className="group relative h-36 w-28 overflow-hidden rounded-md border">
      <img src={dataUrl} alt="Scanned challan" className="h-full w-full object-cover" />
      <span className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
        {Math.round(photo.size / 102.4) / 10} KB
      </span>
    </div>
  );
}