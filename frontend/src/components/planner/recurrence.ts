export type RecurrenceFreq = "daily" | "weekly" | "biweekly" | "monthly";

export type PlannerRecurrence = {
  freq: RecurrenceFreq;
};

export const RECURRENCE_OPTIONS: { value: RecurrenceFreq | ""; label: string }[] = [
  { value: "", label: "None" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
];

export function recurrenceLabel(freq?: RecurrenceFreq): string {
  return RECURRENCE_OPTIONS.find((o) => o.value === freq)?.label || "";
}
