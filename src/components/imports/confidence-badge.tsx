import { Badge } from "@/components/ui/badge";
import type { Confidence } from "@/lib/imports/types";

const VARIANT_BY_CONFIDENCE: Record<Confidence, "default" | "secondary" | "outline"> = {
  high: "default",
  medium: "secondary",
  low: "outline",
};

const LABEL_BY_CONFIDENCE: Record<Confidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return <Badge variant={VARIANT_BY_CONFIDENCE[confidence]}>{LABEL_BY_CONFIDENCE[confidence]}</Badge>;
}
