import type { ChallanEffectiveStatus } from "@/lib/challan-helpers";

export interface DashboardStatsResponse {
  totalChallans: number;
  incomingToday: { count: number; pendingReview: number };
  outgoingToday: { count: number; awaitingDispatch: number };
  pendingBilling: number;
  billedThisMonth: { count: number; totalValue: number };
  statusBreakdown: { status: ChallanEffectiveStatus; count: number }[];
}