const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function DiscoveryFunnel({ value }: { value: unknown }) {
  if (!record(value)) return null;
  const number = (key: string) =>
    typeof value[key] === "number" ? (value[key] as number) : 0;
  const searches = Array.isArray(value.searches)
    ? value.searches.filter(record)
    : [];
  return (
    <div className="discovery-funnel">
      <dl aria-label="Discovery results">
        {[
          ["Returned results", "returned"],
          ["Candidates", "candidates"],
          ["Checked", "checked"],
          ["Shopify", "shopify"],
          ["Active", "active"],
          ["Country verified", "country"],
          ["Outside ideal client", "outside_fit"],
          ["Audits queued", "queued"],
          ["Researched before", "previously_researched"],
          ["Suppressed", "suppressed"],
        ].map(([label, key]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{number(key)}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>
          Search queries · {searches.length}/{number("search_limit")} returned
        </summary>
        <ol>
          {searches.map((search, index) => (
            <li key={index}>
              <strong>{String(search.query ?? "")}</strong>
              <span>
                {Number(search.returned) || 0} results ·{" "}
                {Number(search.candidates) || 0} candidates ·{" "}
                {Number(search.excluded) || 0} excluded ·{" "}
                {Number(search.duplicates) || 0} duplicate results ·{" "}
                {Number(search.invalid) || 0} invalid
              </span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
