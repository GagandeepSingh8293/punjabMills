import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANTS: Record<string, { variant: "success" | "warning" | "info" | "secondary" | "destructive" | "default"; label: string }> = {
  pending: { variant: "warning", label: "Pending" },
  in_progress: { variant: "info", label: "In Progress" },
  completed: { variant: "success", label: "Completed" },
  received: { variant: "info", label: "Received" },
  draft: { variant: "secondary", label: "Draft" },
  sent: { variant: "info", label: "Sent" },
  paid: { variant: "success", label: "Paid" },
  overdue: { variant: "destructive", label: "Overdue" },
  billed: { variant: "success", label: "Billed" },
  unbilled: { variant: "secondary", label: "Unbilled" },
  dispatched: { variant: "success", label: "Dispatched" },
  partially_dispatched: { variant: "warning", label: "Partially Dispatched" },
  not_dispatched: { variant: "secondary", label: "Not Dispatched" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const cfg = STATUS_VARIANTS[status] ?? { variant: "secondary" as const, label: status };
  return (
    <Badge variant={cfg.variant} className={cn("capitalize", className)}>
      {cfg.label}
    </Badge>
  );
}