import { Suspense } from "react";
import ReaderClient from "./ReaderClient";

export default function ReaderPage() {
  return (
    <Suspense fallback={null}>
      <ReaderClient />
    </Suspense>
  );
}