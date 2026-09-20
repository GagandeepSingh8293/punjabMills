import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Inbox,
  Truck,
  Receipt,
  ClipboardList,
  Activity as ActivityIcon,
  Plus,
  ScanLine,
  FilePlus2,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatINR } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/date";
import { challanEffectiveStatus } from "@/lib/challan-helpers";
import { canAccessModule } from "@/lib/permissions";
import { api } from "@/lib/api";
import { useUserStore } from "@/stores/user";
import type { DashboardStatsResponse } from "@/types/dashboard";
import type { ActivityEntry } from "@/types/activity";

const STATUS_COLORS: Record<string, string> = {
  draft: "#b8750a",
  saved: "#33418f",
  billed: "#1f8a5f",
};

const ACTIVITY_ICONS = {
  incoming_challan: Inbox,
  outgoing_challan: Truck,
  invoice: Receipt,
} as const;

export function DashboardPage() {
  const user = useUserStore((s) => s.user);
  const [stats, setStats] = useState<DashboardStatsResponse | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    api.dashboard.stats().then(setStats).catch(() => setStats(null));
    api.dashboard.activity(10).then((res) => setActivity(res.items)).catch(() => setActivity([]));
  }, []);

  const role = user?.role;
  const canChallans = role ? canAccessModule(role, "challans") : false;
  const canBilling = role ? canAccessModule(role, "billing") : false;

  const cards = [
    {
      label: "Total Challans",
      value: stats ? String(stats.totalChallans) : "—",
      icon: ClipboardList,
      tone: "text-[var(--info)] bg-[color-mix(in_oklch,var(--info)_12%,transparent)]",
    },
    {
      label: "Incoming Today",
      value: stats ? String(stats.incomingToday.count) : "—",
      sub: stats ? `${stats.incomingToday.pendingReview} pending review` : undefined,
      icon: Inbox,
      tone: "text-[var(--success)] bg-[color-mix(in_oklch,var(--success)_12%,transparent)]",
    },
    {
      label: "Outgoing Today",
      value: stats ? String(stats.outgoingToday.count) : "—",
      sub: stats ? `${stats.outgoingToday.awaitingDispatch} awaiting dispatch` : undefined,
      icon: Truck,
      tone: "text-[var(--warning)] bg-[color-mix(in_oklch,var(--warning)_12%,transparent)]",
    },
    {
      label: "Pending Billing",
      value: stats ? String(stats.pendingBilling) : "—",
      icon: Receipt,
      tone: "text-[#c23b4b] bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)]",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${user?.name.split(" ")[0] ?? "there"}`}
        description="Here's what's happening across your job-work mill today."
        actions={
          <>
            {canBilling && (
              <Button asChild variant="outline">
                <Link to="/billing/generate">
                  <FilePlus2 />
                  Generate Invoice
                </Link>
              </Button>
            )}
            {canChallans && (
              <Button asChild>
                <Link to="/scan">
                  <ScanLine />
                  Scan Challan
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="flex items-center gap-4 p-5">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${c.tone}`}>
                <c.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
                <p className="text-2xl font-semibold leading-tight">{c.value}</p>
                {c.sub && <p className="truncate text-xs text-muted-foreground">{c.sub}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Challan Status</CardTitle>
          </CardHeader>
          <CardContent>
            {stats ? (
              stats.statusBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={stats.statusBreakdown.map((b) => ({
                        name: challanEffectiveStatus({ billed: b.status === "billed", status: b.status === "billed" ? "saved" : b.status }),
                        value: b.count,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                    >
                      {stats.statusBreakdown.map((b) => (
                        <Cell key={b.status} fill={STATUS_COLORS[b.status] ?? "#33418f"} />
                      ))}
                    </Pie>
                    <RechartsTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">No challans recorded yet.</p>
              )
            ) : (
              <Skeleton className="h-[220px] w-full" />
            )}
            {stats && stats.billedThisMonth.count > 0 && (
              <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Billed this month</span>
                <span className="font-semibold">
                  {stats.billedThisMonth.count} · {formatINR(stats.billedThisMonth.totalValue)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <ActivityIcon className="h-4 w-4 text-muted-foreground" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="divide-y">
                {activity.map((entry) => {
                  const Icon = ACTIVITY_ICONS[entry.type];
                  return (
                    <li key={entry.id} className="flex items-start gap-3 py-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">{entry.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.actor} · {formatRelativeTime(entry.timestamp)}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 capitalize">
                        {entry.type.replace("_", " ")}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {canChallans && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-5">
            <Button asChild>
              <Link to="/challans/new">
                <Plus />
                New Incoming Challan
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/challans">View Incoming Challans</Link>
            </Button>
            {canBilling && (
              <Button asChild variant="outline">
                <Link to="/billing">View Invoices</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}