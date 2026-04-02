import ProfileClient from "./ProfileClient";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const sp = await searchParams;
  const userId = sp.user || "";

  return <ProfileClient userId={userId} />;
}