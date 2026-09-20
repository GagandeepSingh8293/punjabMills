import { useEffect, useState } from "react";
import { Database, Plus, Pencil, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useMastersStore } from "@/stores/masters";
import { formatDate } from "@/lib/date";
import { api } from "@/lib/api";
import { MASTER_TYPES } from "@/types/masters";
import type { MasterRecord, MasterType } from "@/types/masters";

const MASTER_UI: Record<
  MasterType,
  { label: string; singular: string; fields: { key: keyof Record<string, unknown> & string; label: string; type?: string; placeholder?: string }[] }
> = {
  customers: {
    label: "Customers",
    singular: "Customer",
    fields: [
      { key: "name", label: "Name" },
      { key: "gstin", label: "GSTIN" },
      { key: "address", label: "Address" },
      { key: "state", label: "State" },
      { key: "stateCode", label: "State Code" },
    ],
  },
  "hsn-codes": {
    label: "HSN Codes",
    singular: "HSN Code",
    fields: [
      { key: "code", label: "Code" },
      { key: "description", label: "Description" },
      { key: "taxRate", label: "Tax Rate", type: "number" },
    ],
  },
  colours: {
    label: "Colours",
    singular: "Colour",
    fields: [
      { key: "name", label: "Name" },
      { key: "hex", label: "Hex", placeholder: "#1D4ED8" },
    ],
  },
  rate: {
    label: "Rates",
    singular: "Rate",
    fields: [{ key: "value", label: "Rate (₹/kg)", type: "number" }],
  },
  "rate-cards": {
    label: "Rate Cards",
    singular: "Rate Card",
    fields: [
      { key: "customerName", label: "Customer" },
      { key: "process", label: "Process" },
      { key: "depth", label: "Depth" },
      { key: "fabricQuality", label: "Fabric Quality" },
      { key: "value", label: "Value (₹/kg)", type: "number" },
    ],
  },
  depth: {
    label: "Depths",
    singular: "Depth",
    fields: [
      { key: "name", label: "Name", placeholder: "e.g. Super Dark, or - for no depth" },
    ],
  },
  shades: {
    label: "Colour & Depth",
    singular: "Colour & Depth",
    fields: [
      { key: "name", label: "Colour" },
      { key: "depth", label: "Depth", placeholder: "e.g. Super Dark, or - for none" },
      { key: "hex", label: "Hex", placeholder: "#1D4ED8" },
    ],
  },
};

type FieldKey = (typeof MASTER_UI)[MasterType]["fields"][number]["key"];

export function MastersPage() {
  const { records, activeType, loading, setActiveType, fetch, create, update } = useMastersStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MasterRecord | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);

  useEffect(() => {
    if (records[activeType] === undefined) {
      void fetch(activeType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType]);

  const list = records[activeType] ?? [];
  const ui = MASTER_UI[activeType];

  const openCreate = () => {
    setEditing(null);
    setForm({});
    setFormError(null);
    setLookupMsg(null);
    setDialogOpen(true);
  };

  const openEdit = (record: MasterRecord) => {
    setEditing(record);
    const base = { ...record };
    delete (base as Record<string, unknown>)["id"];
    delete (base as Record<string, unknown>)["createdAt"];
    setForm(base as unknown as Record<string, unknown>);
    setFormError(null);
    setLookupMsg(null);
    setDialogOpen(true);
  };

  const lookupGst = async () => {
    const gstin = String(form.gstin ?? "").trim();
    if (!gstin) {
      setFormError("Enter a GSTIN first");
      return;
    }
    if (gstin.length < 15) {
      setFormError("GSTIN must be 15 characters");
      return;
    }
    setFormError(null);
    setLookupBusy(true);
    setLookupMsg(null);
    try {
      const res = await api.gst.lookup(gstin);
      if (res.found && res.customer) {
        setForm((prev) => ({ ...prev, ...res.customer }));
        setLookupMsg(
          res.source === "local"
            ? "Found among your saved customers. Review and save."
            : `Found online for GSTIN ${gstin}. Review and save.`
        );
      } else {
        setLookupMsg(res.message ?? "No GSTIN found locally or online — enter details manually.");
      }
    } catch (e) {
      setLookupMsg(`Lookup failed: ${String(e)}`);
    } finally {
      setLookupBusy(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await update(activeType, editing.id, form);
      } else {
        await create(activeType, form);
      }
      setDialogOpen(false);
    } catch (e) {
      setFormError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const isRateCard = activeType === "rate-cards";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Master Data"
        description="Reference data used across challans, rate suggestions and invoices."
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Add {ui.singular}
          </Button>
        }
      />

      <Tabs value={activeType} onValueChange={(v) => setActiveType(v as MasterType)}>
        <TabsList className="flex h-auto flex-wrap justify-start">
          {MASTER_TYPES.map((t) => (
            <TabsTrigger key={t} value={t}>
              {MASTER_UI[t].label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="overflow-hidden rounded-xl border bg-card">
        {loading[activeType] ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={<Database className="h-8 w-8" />}
            title={`No ${ui.label.toLowerCase()} yet`}
            description={`Add your first ${ui.singular.toLowerCase()} to get started.`}
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus />
                Add {ui.singular}
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {ui.fields.map((f) => (
                  <TableHead key={f.key as string}>{f.label}</TableHead>
                ))}
                <TableHead>Created</TableHead>
                <TableHead className="w-14 text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((record) => (
                <TableRow key={record.id}>
                  {ui.fields.map((f) => (
                    <CellValue key={f.key as string} kind={activeType} fieldKey={f.key} record={record} />
                  ))}
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate((record as { createdAt?: string }).createdAt ?? "")}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(record)}>Edit {ui.singular}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {isRateCard && list.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Rate cards are used to auto-suggest rates on challan line items when customer + process + depth all match.
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${ui.singular}` : `Add ${ui.singular}`}
            </DialogTitle>
            <DialogDescription>
              {MASTER_UI[activeType].singular} records are shared across all documents.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {activeType === "customers" && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 sm:col-span-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Search by GSTIN</p>
                <Button size="sm" variant="outline" type="button" onClick={lookupGst} disabled={lookupBusy || saving}>
                  {lookupBusy ? <Spinner size={14} /> : <Search className="h-3.5 w-3.5" />}
                  Look up GST
                </Button>
                {lookupMsg && <span className="text-xs text-muted-foreground">{lookupMsg}</span>}
              </div>
            )}
            {ui.fields.map((f) => (
              <fieldset
                key={f.key as string}
                className={cn("space-y-1.5", f.key === "address" && "sm:col-span-2")}
              >
                <Label htmlFor={`m-${f.key}`}>{f.label}</Label>
                {f.key === "hex" ? (
                  <div className="flex items-center gap-2">
                    <Input type="color" className="h-9 w-12 px-1" value={String(form[f.key] ?? "#1D4ED8")}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))} />
                    <Input value={String(form[f.key] ?? "")} onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} />
                  </div>
                ) : (
                  <Input
                    id={`m-${f.key}`}
                    type={f.type ?? "text"}
                    value={String(form[f.key] ?? "")}
                    placeholder={f.placeholder}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value,
                      }))
                    }
                  />
                )}
              </fieldset>
            ))}
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Spinner size={16} />}
              {editing ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CellValue({ kind, fieldKey, record }: { kind: MasterType; fieldKey: FieldKey; record: MasterRecord }) {
  const value = (record as Record<string, unknown>)[fieldKey as string];
  if (fieldKey === "hex") {
    return (
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="h-3.5 w-3.5 rounded-full border" style={{ backgroundColor: String(value ?? "") }} />
          <span>{String(value ?? "")}</span>
        </div>
      </TableCell>
    );
  }
  void kind;
  return <TableCell className="max-w-[260px] truncate">{String(value ?? "—")}</TableCell>;
}