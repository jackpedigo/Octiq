"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

type Source = {
  id: string;
  title: string;
  source_type: string;
  source_date?: string | null;
  source_time?: string | null;
  source_url?: string | null;
};

type Claim = {
  id: string;
  source_id?: string | null;
  claim_text: string;
  support_excerpt?: string | null;
};

type StoryData = {
  story_cluster: {
    id: string;
    title: string;
    image_url?: string | null;
    image_attribution?: string | null;
  };
  sources: Source[];
  claims: Claim[];
  latest_render?: {
    headline?: string | null;
    body?: string | null;
    why_it_matters?: string | null;
  } | null;
};

function formatSourceType(type: string) {
  return type
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function ClaimHover({
  text,
  source,
  claim,
}: {
  text: string;
  source?: Source;
  claim?: Claim;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <span
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={hovered ? "bg-yellow-100/80" : ""}>{text}</span>

      {hovered && source && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 rounded-2xl border bg-white p-4 shadow-xl">
          <div className="text-xs text-slate-500">
            {formatSourceType(source.source_type)}
          </div>

          <div className="mt-1 text-sm font-semibold text-slate-900">
            {source.title}
          </div>

          {claim?.support_excerpt && (
            <div className="mt-3 text-sm text-slate-700">
              “{claim.support_excerpt}”
            </div>
          )}

          {source.source_url && (
            <a
              href={source.source_url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm font-medium hover:underline"
              style={{ color: "#FFA166" }}
            >
              Open source
            </a>
          )}
        </div>
      )}
    </span>
  );
}

export default function StoryPageClient() {
  const params = useParams();
  const searchParams = useSearchParams();

  const storyId = String(params.storyId || "");
  const userId = (searchParams.get("user") || "").trim();

  const [story, setStory] = useState<StoryData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStory = async () => {
    if (!storyId) return;

    await fetch(
      `${API_BASE}/stories/${storyId}/render-if-needed/${userId}`,
      { method: "POST" }
    ).catch(() => {});

    const res = await fetch(`${API_BASE}/stories/${storyId}`);
    const data = await res.json();

    setStory(data);
    setLoading(false);
  };

  useEffect(() => {
    loadStory();
  }, [storyId]);

  const renderBody = useMemo(() => {
    if (!story?.latest_render?.body) return null;

    let text = story.latest_render.body;

    return text.split("\n").map((p, i) => (
      <p key={i} className="mb-4">
        {p}
      </p>
    ));
  }, [story]);

  if (loading) return <div>Loading...</div>;

  if (!story) return <div>Story not found</div>;

  return (
    <main
      className="min-h-screen px-6 py-8"
      style={{
        backgroundColor: "#f3f6fa",
        fontFamily: "Helvetica, Arial, sans-serif",
      }}
    >
      <div className="mx-auto max-w-5xl space-y-6">
        <div
          className="rounded-[28px] px-6 py-5 shadow"
          style={{ backgroundColor: "#1F0954" }}
        >
          <div className="flex items-center justify-between">
            <Link
              href={`/reader?user=${userId}`}
              className="bg-white px-4 py-2 rounded-full"
            >
              Back
            </Link>

            <img
              src="/octiq-news-logo.png"
              className="h-20 object-contain"
            />

            <Link
              href={`/reader/profile?user=${userId}`}
              className="bg-white px-4 py-2 rounded-full"
            >
              Profile
            </Link>
          </div>
        </div>

        <article className="bg-white p-8 rounded-3xl shadow">
          <h1 className="text-4xl font-bold mb-6">
            {story.latest_render?.headline}
          </h1>

          {story.story_cluster.image_url && (
            <img
              src={story.story_cluster.image_url}
              className="w-full mb-4 rounded-2xl"
            />
          )}

          <div className="text-lg leading-[1.15]">{renderBody}</div>
        </article>
      </div>
    </main>
  );
}