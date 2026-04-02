import ReaderClient from "./ReaderClient";

export const dynamic = "force-dynamic";

export default async function ReaderPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const sp = await searchParams;
  const initialUser = sp.user || "";

  return <ReaderClient initialUser={initialUser} />;
}