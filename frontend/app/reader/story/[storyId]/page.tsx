"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const API_BASE = "http://127.0.0.1:8000";

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
  is_core_claim?: boolean;
};

type StoryData = {
  story_cluster: {
    id: string;
    title: string;
    main_issue?: string;
    event_type?: string;
    location?: string;
    date_reference?: string;
    summary_seed?: string;
    image_url?: string | null;
    image_attribution?: string | null;
  };
  sources: Source[];
  claims: Claim[];
  latest_render?: {
    id: string;
    headline?: string | null;
    summary?: string | null;
    body?: string | null;
    why_it_matters?: string | null;
    user_profile_id?: string | null;
  } | null;
};

function formatSourceType(type: string) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(date?: string | null, time?: string | null) {
  if (!date) return "No date";

  const d = new Date(`${date}T00:00:00`);
  const dateText = `${d.getMonth() + 1}/${d.getDate()}/${String(
    d.getFullYear()
  ).slice(-2)}`;

  if (!time) return dateText;

  const [hoursStr, minutes] = time.slice(0, 5).split(":");
  const hoursNum = Number(hoursStr);
  const suffix = hoursNum >= 12 ? "pm" : "am";
  const normalizedHour = hoursNum % 12 === 0 ? 12 : hoursNum % 12;

  return `${dateText} ${normalizedHour}:${minutes} ${suffix}`;
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
      className="relative transition"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={hovered ? "rounded-sm bg-yellow-100/80" : ""}>
        {text}
      </span>

      {hovered && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_18px_48px_rgba(15,23,42,0.18)]">
          <div className="text-xs text-slate-500">
            {source ? formatSourceType(source.source_type) : "Source"}
            {source?.source_date
              ? ` · ${formatDateTime(source.source_date, source.source_time)}`
              : ""}
          </div>

          <div className="mt-1 text-sm font-semibold text-slate-900">
            {source?.title || "Attached source"}
          </div>

          {claim?.support_excerpt && (
            <div className="mt-3 text-sm leading-[1.15] text-slate-700">
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

  const matches: Array<{
    start: number;
    end: number;
    text: string;
    claim: Claim;
    source?: Source;
  }> = [];

  for (const claim of claims) {
    const source = sources.find((s) => s.id === claim.source_id);
    const target = claim.claim_text?.trim();

    if (!target) continue;

    const index = body.indexOf(target);
    if (index === -1) continue;

    matches.push({
      start: index,
      end: index + target.length,
      text: target,
      claim,
      source,
    });
  }

  matches.sort((a, b) => a.start - b.start);

  const nonOverlapping: typeof matches = [];
  let lastEnd = -1;

  for (const match of matches) {
    if (match.start >= lastEnd) {
      nonOverlapping.push(match);
      lastEnd = match.end;
    }
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (let i = 0; i < nonOverlapping.length; i++) {
    const match = nonOverlapping[i];

    if (cursor < match.start) {
      parts.push(
        <span key={`text-${i}-${cursor}`}>
          {body.slice(cursor, match.start)}
        </span>
      );
    }

    parts.push(
      <ClaimHover
        key={`claim-${match.claim.id}`}
        text={match.text}
        source={match.source}
        claim={match.claim}
      />
    );

    cursor = match.end;
  }

  if (cursor < body.length) {
    parts.push(<span key={`tail-${cursor}`}>{body.slice(cursor)}</span>);
  }

  return parts;
}

export default function ReaderStoryPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const storyId = String(params.storyId || "");
  const userId = (searchParams.get("user") || "").trim();

  const [story, setStory] = useState<StoryData | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadStory = async () => {
    if (!storyId) {
      setError("Missing story ID.");
      setLoading(false);
      return;
    }

    try {
      await fetch(`${API_BASE}/stories/${storyId}/render-if-needed/${userId}`, {
        method: "POST",
      }).catch(() => {});

      const res = await fetch(`${API_BASE}/stories/${storyId}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to load story");
      }

      setStory(data);
    } catch (err: any) {
      setError(err.message || "Failed to load story");
    } finally {
      setLoading(false);
    }
  };

  const loadUserProfile = async () => {
    if (!userId) return;

    try {
      const res = await fetch(`${API_BASE}/user-profiles/${userId}`);
      const data = await res.json();

      if (res.ok) {
        setUserProfile(data);
      }
    } catch {}
  };

  useEffect(() => {
    loadStory();
    loadUserProfile();
  }, [storyId, userId]);

  const renderedBody = useMemo(() => {
    if (!story?.latest_render?.body) return null;

    return buildBodySegments(
      story.latest_render.body,
      story.claims || [],
      story.sources || []
    );
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
        <div className="mx-auto max-w-5xl rounded-[28px] border border-slate-200 bg-white p-8 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          Loading story...
        </div>
      </main>
    );
  }

  if (error || !story) {
    return (
      <main
        className="min-h-screen px-6 py-8"
        style={{
          backgroundColor: "#f3f6fa",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div className="mx-auto max-w-5xl rounded-[28px] border border-slate-200 bg-white p-8 shadow-[0_10px_30px_rgba(15,23,42,0.06)] space-y-4">
          <div className="text-red-700">{error || "Story not found."}</div>
          <Link
            href={userId ? `/reader?user=${userId}` : "/reader"}
            className="inline-block rounded-xl border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Back to reader
          </Link>
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
              {userProfile?.name ? "Profile" : "Profile"}
            </Link>
          </div>
        </div>

        <article className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-[0_10px_30px_rgba(15,23,42,0.06)] space-y-7 md:p-10">
          <h1 className="text-4xl font-bold tracking-tight text-slate-950 leading-[1.15]">
            {story.latest_render?.headline ||
              story.story_cluster.title ||
              "Untitled story"}
          </h1>

          {story.story_cluster.image_url && (
            <div>
              <div className="overflow-hidden rounded-[24px] bg-slate-200">
                <img
                  src={story.story_cluster.image_url}
                  alt="Story hero"
                  className="h-[380px] w-full object-cover"
                />
              </div>
              <div className="pt-3 text-xs text-slate-500">
                {story.story_cluster.image_attribution ||
                  "Image attribution placeholder"}
              </div>
            </div>
          )}

          <div className="whitespace-pre-wrap text-[18px] leading-[1.15] text-slate-800">
            {renderedBody}
            {story.latest_render?.why_it_matters ? (
              <>
                {"\n\n"}
                {story.latest_render.why_it_matters}
              </>
            ) : null}
          </div>
        </article>
      </div>
    </main>
  );
}