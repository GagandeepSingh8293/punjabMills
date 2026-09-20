import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, FilePlus2, Receipt, Printer, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatINR } from "@/lib/utils";
import { formatDate } from "@/lib/date";
import { useBillingStore } from "@/stores/billing";
import { useUserStore } from "@/stores/user";
import { canAccessModule } from "@/lib/permissions";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
];

export function BillingListPage() {
  const { user } = useUserStore();
  const { items, total, page, pageSize, q, status, loading, setQuery, setStatus, setPage, fetch } = useBillingStore();
  const [search, setSearch] = useState(q);
  const canBilling = user ? canAccessModule(user.role, "billing") : false;

  useEffect(() => {
    void fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pagesCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Billing"
        description={`${total} invoice${total === 1 ? "" : "s"} on record`}
        actions={
          canBilling ? (
            <Button asChild>
              <Link to="/billing/generate">
                <FilePlus2 />
                Generate Invoice
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search invoice no. or party…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setQuery(e.target.value);
              void fetch();
            }}
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
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
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {loading && items.length === 0 ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={<Receipt className="h-8 w-8" />}
            title="No invoices found"
            description="Generate an invoice from your outgoing challans."
            action={
              canBilling ? (
                <Button asChild size="sm">
                  <Link to="/billing/generate">
                    <FilePlus2 />
                    Generate Invoice
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Party</TableHead>
                <TableHead className="text-right">Challans</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">
                    <Link to={`/billing/${inv.id}`} className="text-primary hover:underline">
                      {inv.invoiceNo}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(inv.invoiceDate)}</TableCell>
                  <TableCell>
                    <p className="truncate max-w-[200px]">{inv.header.billing.name}</p>
                    <p className="text-xs text-muted-foreground">{inv.header.billing.state}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{inv.challanIds.length}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatINR(inv.totals.grandTotal)}</TableCell>
                  <TableCell>
                    <StatusBadge status={inv.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon" title="Edit / View">
                        <Link to={`/billing/${inv.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="icon" title="Print">
                        <Link to={`/billing/${inv.id}/print`}>
                          <Printer className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {pagesCount > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {page} of {pagesCount} · {total} invoices
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                setPage(page - 1);
                void fetch();
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagesCount}
              onClick={() => {
                setPage(page + 1);
                void fetch();
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}