import { Suspense } from "react";
import StoryPageClient from "./StoryPageClient";

export default function StoryPage() {
  return (
    <Suspense fallback={null}>
      <StoryPageClient />
    </Suspense>
  );
}