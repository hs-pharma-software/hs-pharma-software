/** Fixed last line of every printed invoice, bill and receipt: "Powered by MAVIN.pk — Aap Key Business Ka معاون".
 * Not part of the editable print templates. Plain <img> loaded at once, so it is there when printing. */
export function PoweredByFooter() {
  return (
    <p className="mt-2 flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-center text-[9px] leading-tight text-neutral-500">
      Powered by
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mavin-header.png" alt="MAVIN.pk" width={1405} height={361} loading="eager" className="inline-block h-3.5 w-auto object-contain" />
      <span>—</span>
      <span>Aap Key Business Ka</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/muawin-logo.png" alt="معاون" width={800} height={322} loading="eager" className="inline-block h-4 w-auto object-contain" />
    </p>
  );
}
