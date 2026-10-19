import { PageHeader } from "./PageHeader";

/** Placeholder for nav routes that exist (so navigation never 404s) but
 * haven't been built out yet. Lists what the screen will contain, sourced
 * from the CLAUDE.md spec, so the nav tree stays honest about progress. */
export function ComingSoon({
  title,
  description,
  fields,
}: {
  title: string;
  description?: string;
  fields?: string[];
}) {
  return (
    <div>
      <PageHeader title={title} />
      <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
        <p className="text-sm font-medium text-neutral-500">Not built yet</p>
        {description && <p className="mx-auto mt-2 max-w-lg text-sm text-neutral-500">{description}</p>}
        {fields && fields.length > 0 && (
          <ul className="mx-auto mt-4 max-w-md list-disc space-y-1 text-left text-xs text-neutral-500">
            {fields.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
