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

function hasAttributionCue(text: string) {
  const lower = text.toLowerCase();

  return (
    lower.includes("according to") ||
    lower.includes("said") ||
    lower.includes("told") ||
    lower.includes("wrote on x") ||
    lower.includes("posted on x") ||
    lower.includes("in a statement") ||
    lower.includes("according to a") ||
    lower.includes("records show") ||
    lower.includes("court filing") ||
    lower.includes("document") ||
    lower.includes('"')
  );
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoSentences(text: string) {
  if (!text.trim()) return [];
  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()) || [];
}

function getWordSet(text: string) {
  return new Set(normalizeText(text).split(" ").filter(Boolean));
}

function getOverlapScore(a: string, b: string) {
  const aWords = getWordSet(a);
  const bWords = getWordSet(b);

  if (aWords.size === 0 || bWords.size === 0) return 0;

  let overlap = 0;
  for (const word of aWords) {
    if (bWords.has(word)) overlap += 1;
  }

  return overlap / Math.max(aWords.size, 1);
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

function buildBodySegments(body: string, claims: Claim[], sources: Source[]) {
  if (!body) return [<span key="empty">No body available yet.</span>];

  const sentences = splitIntoSentences(body);
 
  return sentences.map((sentence, index) => {
    let bestClaim: Claim | undefined;
    let bestSource: Source | undefined;
    let bestScore = 0;

    for (const claim of claims) {
      const source = sources.find((s) => s.id === claim.source_id);

      if (!hasAttributionCue(sentence)) {
        return (
          <span key={`sentence-${index}`}>
            <span>{sentence}</span>{" "}
          </span>
        );
      }

      // never link octiq copy
      if (!source || source.source_type === "octiq_copy") continue;

      const comparisonTexts = [
        claim.normalized_claim_text,
        claim.claim_text,
        claim.support_excerpt,
      ].filter(Boolean) as string[];

      for (const comparisonText of comparisonTexts) {
        const score = getOverlapScore(sentence, comparisonText);

        if (score > bestScore) {
          bestScore = score;
          bestClaim = claim;
          bestSource = source;
        }
      }
    }
    
    // threshold: only link if sentence meaningfully overlaps
    const shouldLink = bestClaim && bestSource && bestScore >= 0.28;

    return (
      <span key={`sentence-${index}`}>
        {shouldLink ? (
          <ClaimHover
            text={sentence}
            source={bestSource}
            claim={bestClaim}
          />
        ) : (
          <span>{sentence}</span>
        )}
        {" "}
      </span>
    );
  });
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
      `${API_BASE}/stories/${storyId}?user_profile_id=${encodeURIComponent(userId)}`
    );
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