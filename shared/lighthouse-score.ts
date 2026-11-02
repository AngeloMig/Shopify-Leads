export function lighthouseScore(value: unknown) {
  const score =
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
      ? Math.round(value)
      : null;
  return {
    score,
    band:
      score === null
        ? "unknown"
        : score < 50
          ? "poor"
          : score < 90
            ? "average"
            : "good",
    label:
      score === null
        ? "Unavailable"
        : score < 50
          ? "Poor"
          : score < 90
            ? "Needs improvement"
            : "Good",
  } as const;
}
