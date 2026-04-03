"use client";

import Link from "next/link";
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
  normalized_claim_text?: string | null;
  support_excerpt?: string | null;
  is_core_claim?: boolean;
  claim_type?: string | null;
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

function splitWithAttributionSpans(text: string) {
  const pattern =
    /“[^”]+”|"[^"]+"|according to [^,.]+|[^,.]+ said|[^,.]+ posted on X|[^,.]+ wrote on X|according to court records|according to a filing|according to documents?/gi;

  const parts: Array<{ text: string; attributed: boolean }> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const matchedText = match[0];

    if (start > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, start),
        attributed: false,
      });
    }

    parts.push({
      text: matchedText,
      attributed: true,
    });

    lastIndex = start + matchedText.length;
  }

  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      attributed: false,
    });
  }

  return parts;
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

          {source?.source_url && (
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

export default function StoryPageClient({
  storyId,
  userId,
}: {
  storyId: string;
  userId: string;
}) {
  const [story, setStory] = useState<StoryData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStory = async () => {
    if (!storyId) return;

    await fetch(
      `${API_BASE}/stories/${storyId}/render-if-needed/${userId}`,
      { method: "POST" }
    ).catch(() => {});

    const res = await fetch(
      `${API_BASE}/stories/${storyId}?user_profile_id=${encodeURIComponent(
        userId
      )}`
    );
    const data = await res.json();

    setStory(data);
    setLoading(false);
  };

  useEffect(() => {
    loadStory();
  }, [storyId]);

  const renderedBody = useMemo(() => {
    if (!story?.latest_render?.body) return null;

    const paragraphs = story.latest_render.body.split("\n").filter(Boolean);

    return paragraphs.map((paragraph, paragraphIndex) => {
      const parts = splitWithAttributionSpans(paragraph);

      return (
        <p key={paragraphIndex} className="mb-4">
          {parts.map((part, partIndex) => {
            if (!part.attributed) {
              return <span key={partIndex}>{part.text}</span>;
            }

            const candidateSource =
              story.sources.find(
                (s) => s.source_type !== "octiq_copy" && s.source_url
              ) || story.sources.find((s) => s.source_type !== "octiq_copy");

            if (!candidateSource) {
              return <span key={partIndex}>{part.text}</span>;
            }

            return (
              <ClaimHover
                key={partIndex}
                text={part.text}
                source={candidateSource}
              />
            );
          })}
        </p>
      );
    });
  }, [story]);

  if (loading) {
    return (
      <main
        className="min-h-screen px-6 py-8"
        style={{
          backgroundColor: "#f3f6fa",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div className="mx-auto max-w-5xl">
          <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
            Loading story...
          </div>
        </div>
      </main>
    );
  }

  if (!story) {
    return (
      <main
        className="min-h-screen px-6 py-8"
        style={{
          backgroundColor: "#f3f6fa",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div className="mx-auto max-w-5xl">
          <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
            Story not found.
          </div>
        </div>
      </main>
    );
  }

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
          className="rounded-[28px] px-6 py-5 shadow-[0_14px_34px_rgba(31,9,84,0.18)]"
          style={{ backgroundColor: "#1F0954" }}
        >
          <div className="flex items-center justify-between gap-4">
            <Link
              href={userId ? `/reader?user=${userId}` : "/reader"}
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100"
            >
              Back
            </Link>

            <img
              src="/octiq-news-logo.png"
              alt="OCTIQ News"
              className="h-20 object-contain md:h-24"
            />

            <Link
              href={userId ? `/reader/profile?user=${userId}` : "/reader/profile"}
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100"
            >
              Profile
            </Link>
          </div>
        </div>

        <article className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm space-y-6">
          <h1 className="text-4xl font-bold leading-[1.15] text-slate-950">
            {story.latest_render?.headline || story.story_cluster.title}
          </h1>

          {story.story_cluster.image_url && (
            <div className="space-y-2">
              <img
                src={story.story_cluster.image_url}
                alt={story.latest_render?.headline || story.story_cluster.title}
                className="w-full rounded-2xl object-cover"
              />
              {story.story_cluster.image_attribution && (
                <div className="text-xs text-slate-500">
                  {story.story_cluster.image_attribution}
                </div>
              )}
            </div>
          )}

          <div className="text-[17px] leading-[1.6] text-slate-800">
            {renderedBody}
          </div>
        </article>
      </div>
    </main>
  );
}