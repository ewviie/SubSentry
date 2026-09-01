import { TrendingUp, CalendarClock, CalendarX, Clock, Copy, PiggyBank, AlertTriangle, type LucideIcon } from "lucide-react";
import type { Notification } from "@/lib/db/schema";

// Shared by every surface that renders a notification row (bell dropdown,
// /notifications, the dashboard's attention panel) — previously copy-pasted
// per component, which is exactly the kind of drift risk this app's own
// namesLikelyMatch/forEachLikelyDuplicatePair extraction comment (insights.ts)
// already warns about: a new notification type added to one copy and not
// the others would silently render as a missing icon somewhere.
export const NOTIFICATION_TYPE_ICON: Record<Notification["type"], LucideIcon> = {
  price_increase: TrendingUp,
  upcoming_renewal: CalendarClock,
  stale_subscription: Clock,
  unusual_charge: AlertTriangle,
  savings_opportunity: PiggyBank,
  duplicate_subscription: Copy,
  renewal_lapsed: CalendarX,
};
