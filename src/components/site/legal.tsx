/** Shown on the legal drafts until a lawyer has reviewed them. */
export function LegalDraftNote() {
  return (
    <p className="mb-6 max-w-3xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      Draft prepared from how the software works today. It must be reviewed by a lawyer before publishing; items marked [Review] need a decision.
    </p>
  );
}
