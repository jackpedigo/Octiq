import { connection } from "next/server";
import ProfileClient from "./ProfileClient";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  await connection();

  const sp = await searchParams;
  return <ProfileClient userId={sp.user || ""} />;
}