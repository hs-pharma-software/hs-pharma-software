import Image from "next/image";

/** The MAVIN.pk tagline: "Aap Key Business Ka" and the معاون logo (teal swooshes). */
export function MuawinTagline({ className = "", logoClassName = "h-7 w-auto" }: { className?: string; logoClassName?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span>Aap Key Business Ka</span>
      <Image src="/muawin-logo.png" alt="معاون" width={800} height={322} className={`object-contain ${logoClassName}`} />
    </span>
  );
}
