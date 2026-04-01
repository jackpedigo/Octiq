"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type HomepageStory = {
  id: string;
  title: string;
  main_issue?: string;
  location?: string;
  summary_seed?: string;
  date_reference?: string;
  image_url?: string | null;
  latest_render?: {
    headline?: string | null;
    summary?: string | null;
  } | null;
};

const API_BASE = "http://127.0.0.1:8000";

export default function OctiqReaderApp() {
  const searchParams = useSearchParams();

  const [userProfileId, setUserProfileId] = useState("");
  const [submittedUserId, setSubmittedUserId] = useState("");
  const [stories, setStories] = useState<HomepageStory[]>([]);
  const [homeLoading, setHomeLoading] = useState(false);
  const [error, setError] = useState("");
  const [userProfile, setUserProfile] = useState<any>(null);

  const loadUserProfile = async (id: string) => {
    const cleanId = id.trim();
    if (!cleanId) {
      throw new Error("Missing user profile ID");
    }

    const res = await fetch(`${API_BASE}/user-profiles/${cleanId}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Failed to load user profile");
    }

    setUserProfile(data);
  };

  const loadHomepage = async (id: string) => {
    setHomeLoading(true);
    setError("");
    setStories([]);

    try {
      const res = await fetch(`${API_BASE}/homepage/${id}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to load homepage");
      }

      setStories((data.stories || []).slice(0, 5));
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setHomeLoading(false);
    }
  };

  useEffect(() => {
    const urlUser = searchParams.get("user");
    if (!urlUser || submittedUserId) return;

    const cleanUser = urlUser.trim();
    setUserProfileId(cleanUser);
    setSubmittedUserId(cleanUser);

    loadUserProfile(cleanUser).catch((err) => {
      setError(err.message || "Failed to load user profile");
    });

    loadHomepage(cleanUser);
  }, [searchParams, submittedUserId]);

  const handleEnter = () => {
    if (!userProfileId.trim()) {
      setError("Enter a user profile ID to continue.");
      return;
    }

    const cleanId = userProfileId.trim();
    setSubmittedUserId(cleanId);

    loadUserProfile(cleanId).catch((err) => {
      setError(err.message || "Failed to load user profile");
    });

    loadHomepage(cleanId);
  };

  const firstName = useMemo(() => {
    const name = userProfile?.name || "";
    return name.trim().split(" ")[0] || "there";
  }, [userProfile]);

  const headlineLine = useMemo(() => {
    const headlines = stories
      .map((story) => story.latest_render?.headline || story.title || "Untitled story")
      .filter(Boolean);

    if (headlines.length === 0) {
      return `Hi, ${firstName}! Thank you for trusting Octiq. Here’s what you should know today.`;
    }

    return `Hi, ${firstName}! Thank you for trusting Octiq. Here’s what you should know today.`;
  }, [stories, firstName]);

  if (!submittedUserId) {
    return (
      <main
        className="min-h-screen flex items-center justify-center px-6"
        style={{
          background:
            "linear-gradient(180deg, #1F0954 0%, #2b0d73 100%)",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur space-y-5">
          <img
            src="/octiq-news-logo.png"
            alt="Octiq"
            className="mx-auto h-24 md:h-28 object-contain"
          />

          <div className="space-y-4">
            <input
              value={userProfileId}
              onChange={(e) => setUserProfileId(e.target.value)}
              placeholder="Octiq ID"
              className="w-full rounded-2xl border border-white/20 bg-white px-4 py-3 text-slate-900 outline-none focus:ring-2 focus:ring-orange-300"
            />

            <button
              onClick={handleEnter}
              className="w-full rounded-2xl px-4 py-3 font-medium text-slate-950 transition"
              style={{ backgroundColor: "#FFA166" }}
            >
              Login
            </button>

            {error && (
              <div className="rounded-2xl border border-red-300 bg-red-100 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
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
      <div className="mx-auto max-w-6xl space-y-6">
        <div
          className="rounded-[28px] px-6 py-5 shadow-[0_14px_34px_rgba(31,9,84,0.18)]"
          style={{ backgroundColor: "#1F0954" }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="w-24" />

            <img
              src="/octiq-news-logo.png"
              alt="OCTIQ News"
              className="h-20 object-contain md:h-24"
            />

            <Link
              href={
                submittedUserId
                  ? `/reader/profile?user=${submittedUserId}`
                  : "/reader/profile"
              }
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100"
            >
              Profile
            </Link>
          </div>
        </div>

        <div
          className="rounded-[24px] border px-5 py-4 shadow-sm"
          style={{
            backgroundColor: "#fff7f1",
            borderColor: "#ffd1b0",
          }}
        >
          <div
            className="text-sm font-medium leading-[1.35] md:text-[15px]"
            style={{ color: "#7a3b00" }}
          >
            {headlineLine}
          </div>
        </div>

        {homeLoading && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-600 shadow-sm">
            Loading homepage...
          </div>
        )}

        {!homeLoading && stories.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-600 shadow-sm">
            No homepage stories available yet.
          </div>
        )}

        <div className="space-y-4">
          {stories.map((story) => {
            const headline =
              story.latest_render?.headline || story.title || "Untitled story";

            return (
              <Link
                key={story.id}
                href={`/reader/story/${story.id}?user=${submittedUserId}`}
                className="group block rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition hover:-translate-y-[1px] hover:border-[#1F0954]/15 hover:shadow-[0_16px_38px_rgba(31,9,84,0.10)]"
              >
                <div className="flex flex-col gap-4 md:flex-row">
                  <div className="h-40 w-full shrink-0 overflow-hidden rounded-2xl bg-slate-200 md:h-32 md:w-52">
                    {story.image_url ? (
                      <img
                        src={story.image_url}
                        alt={headline}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                        Image
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-2xl font-bold leading-[1.15] text-slate-950">
                      {headline}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}