"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import EpisodesList from "./EpisodesList";

/** All episodes. Older links with ?type=opd|ipd|emergency still filter. */
function Filtered() {
  return <EpisodesList type={useSearchParams().get("type") ?? ""} />;
}

export default function EpisodesPage() {
  return (
    <Suspense fallback={null}>
      <Filtered />
    </Suspense>
  );
}
