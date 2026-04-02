import { connection } from "next/server";
import ReaderClient from "./ReaderClient";

export default async function ReaderPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  await connection();

  const sp = await searchParams;
  const initialUser = sp.user || "";

  return <ReaderClient initialUser={initialUser} />;
}