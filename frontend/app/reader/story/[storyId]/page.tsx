import { connection } from "next/server";
import StoryPageClient from "./StoryPageClient";

export default async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ storyId: string }>;
  searchParams: Promise<{ user?: string }>;
}) {
  await connection();

  const p = await params;
  const sp = await searchParams;

  return <StoryPageClient storyId={p.storyId} userId={sp.user || ""} />;
}