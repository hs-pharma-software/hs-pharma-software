/** Fixed last lines of every printed invoice, bill and receipt:
 * "Powered by MAVIN.pk — Aap Key Business Ka معاون", then "For your معاون +923160585858".
 * Not part of the editable print templates. Plain <img> loaded at once, so it is there when printing. */
export function PoweredByFooter() {
  const muawin = (cls: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/muawin-logo.png" alt="معاون" width={800} height={322} loading="eager" className={`inline-block w-auto object-contain ${cls}`} />
  );
  return (
    <div className="mt-2 flex flex-col items-center gap-0.5 text-center text-[9px] leading-tight text-neutral-500">
      <p className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
        Powered by
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mavin-header.png" alt="MAVIN.pk" width={1405} height={361} loading="eager" className="inline-block h-3.5 w-auto object-contain" />
        <span>—</span>
        <span>Aap Key Business Ka</span>
        {muawin("h-4")}
      </p>
      <p className="flex flex-wrap items-center justify-center gap-x-1">
        <span>For your</span>
        {muawin("h-4")}
        <span className="tabular-nums">+923160585858</span>
      </p>
    </div>
  );
}
