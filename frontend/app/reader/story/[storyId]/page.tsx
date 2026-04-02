import StoryPageClient from "./StoryPageClient";

export const dynamic = "force-dynamic";

export default async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ storyId: string }>;
  searchParams: Promise<{ user?: string }>;
}) {
  const p = await params;
  const sp = await searchParams;

  return (
    <StoryPageClient
      storyId={p.storyId}
      userId={sp.user || ""}
    />
  );
}