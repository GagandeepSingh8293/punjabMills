import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Plus, ScanLine, Search, FilterX, Pencil, Printer, Inbox, Truck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageLoader } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/utils";
import { formatDate } from "@/lib/date";
import { challanEffectiveStatus, challanTotalWeight, challanHsnCodes, challanColours } from "@/lib/challan-helpers";
import { canAccessModule } from "@/lib/permissions";
import { useChallanStore, type ChallanFilters } from "@/stores/challan";
import { useUserStore } from "@/stores/user";
import { api } from "@/lib/api";
import type { ChallanFilterOptions, } from "@/types/api";
import type { ChallanRecord, DocumentType } from "@/types/challan";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "saved", label: "Saved" },
  { value: "billed", label: "Billed" },
];

export function ChallanListPage({ documentType }: { documentType: DocumentType }) {
  const { user } = useUserStore();
  const { items, total, page, pageSize, loading, filters, setFilters, fetch } = useChallanStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.getAll("q").join(", "));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [options, setOptions] = useState<ChallanFilterOptions | null>(null);

  const isOutgoing = documentType === "outgoing";

  useEffect(() => {
    setFilters({ documentType, page: 1 });
    void fetch({ documentType, excludeBilled: false, pendingOnly: false, q: searchParams.get("q") ?? "" });
    api.challans.filterOptions(documentType).then(setOptions).catch(() => setOptions(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentType]);

  const applySearch = useMemo(
    () => (value: string) => {
      setFilters({ q: value, page: 1 });
      void fetch();
    },
    [setFilters, fetch]
  );

  const pagesCount = Math.max(1, Math.ceil(total / pageSize));

  const role = user?.role;

  return (
    <div className="space-y-5">
      <PageHeader
        title={isOutgoing ? "Outgoing Challans" : "Incoming Challans"}
        description={`${total} record${total === 1 ? "" : "s"} · ${isOutgoing ? "goods dispatched to job-work units" : "grey fabric received from suppliers"}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/scan">
                <ScanLine />
                Scan
              </Link>
            </Button>
            <Button asChild>
              <Link to={`/challans/new?type=${documentType}`}>
                <Plus />
                New {isOutgoing ? "Outgoing" : "Incoming"} Challan
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search challan no., vehicle, party, lot…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              applySearch(e.target.value);
            }}
          />
        </div>
        <Select
          value={filters.status ?? ""}
          onValueChange={(v) => {
            setFilters({ status: v || undefined, page: 1 });
            void fetch();
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => setShowAdvanced((v) => !v)}>
          <FilterX className="h-4 w-4" />
          Advanced
        </Button>
      </div>

      {showAdvanced && (
        <div className="grid grid-cols-1 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
          <fieldset className="space-y-1.5">
            <Label>From date</Label>
            <Input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => setFilters({ from: e.target.value || undefined, page: 1 })}
            />
          </fieldset>
          <fieldset className="space-y-1.5">
            <Label>To date</Label>
            <Input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => setFilters({ to: e.target.value || undefined, page: 1 })}
            />
          </fieldset>
          <fieldset className="space-y-1.5">
            <Label>Vehicle no.</Label>
            <Select
              value={filters.vehicleNo ?? ""}
              onValueChange={(v) => setFilters({ vehicleNo: v || undefined, page: 1 })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                {options?.vehicleNo.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </fieldset>
          <fieldset className="space-y-1.5">
            <Label>Customer</Label>
            <Select
              value={filters.customer ?? ""}
              onValueChange={(v) => setFilters({ customer: v || undefined, page: 1 })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                {options?.customer.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </fieldset>
          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFilters({ from: undefined, to: undefined, vehicleNo: undefined, customer: undefined, status: undefined, q: "", page: 1 });
                setSearch("");
                void fetch();
              }}
            >
              <FilterX className="h-4 w-4" />
              Reset filters
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        {loading && items.length === 0 ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={<Inbox className="h-8 w-8" />}
            title={`No ${isOutgoing ? "outgoing" : "incoming"} challans found`}
            description="Try adjusting filters, or create a new challan."
            action={
              <Button asChild size="sm">
                <Link to={`/challans/new?type=${documentType}`}>
                  <Plus />
                  New challan
                </Link>
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Challan No.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead className="hidden md:table-cell">Lots</TableHead>
                <TableHead className="text-right">Weight (kg)</TableHead>
                <TableHead>Status</TableHead>
                {isOutgoing && <TableHead>Billing</TableHead>}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <ChallanRow key={c.id} challan={c} isOutgoing={isOutgoing} canEdit={role ? canAccessModule(role, "challans") : false} />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {pagesCount > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {page} of {pagesCount} · {total} records
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => void fetch({ page: page - 1 })}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagesCount}
              onClick={() => void fetch({ page: page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChallanRow({ challan, isOutgoing, canEdit }: { challan: ChallanRecord; isOutgoing: boolean; canEdit: boolean }) {
  const status = challanEffectiveStatus(challan);
  const weight = challanTotalWeight(challan);
  const hsn = challanHsnCodes(challan);
  const colours = challanColours(challan);

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link to={`/challans/${challan.id}`} className="text-primary hover:underline">
          {challan.header.challanNo ?? challan.id.slice(0, 8)}
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap">{formatDate(challan.header.challanDate)}</TableCell>
      <TableCell>
        <p className="truncate max-w-[180px]">{challan.header.billing.name}</p>
        <p className="text-xs text-muted-foreground">{challan.header.billing.state}</p>
      </TableCell>
      <TableCell>{challan.header.vehicleNo || "—"}</TableCell>
      <TableCell className="hidden max-w-[200px] md:table-cell">
        <div className="flex flex-wrap gap-1">
          {colours.slice(0, 2).map((color) => (
            <Badge key={color} variant="outline" className="normal-case">
              {color}
            </Badge>
          ))}
          {colours.length > 2 && (
            <Badge variant="outline">+{colours.length - 2}</Badge>
          )}
          {hsn.length > 0 && <span className="text-xs text-muted-foreground">{hsn.join(", ")}</span>}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatNumber(weight)}</TableCell>
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
      {isOutgoing && (
        <TableCell>
          {challan.billed ? <StatusBadge status="billed" /> : <StatusBadge status="unbilled" />}
        </TableCell>
      )}
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {canEdit && (
            <Button asChild variant="ghost" size="icon" title="Edit">
              <Link to={`/challans/${challan.id}`}>
                <Pencil className="h-4 w-4" />
              </Link>
            </Button>
          )}
          <Button asChild variant="ghost" size="icon" title="Print">
            <Link to={`/challans/${challan.id}/print`}>
              <Printer className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}