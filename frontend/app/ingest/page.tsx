"use client";

import { useEffect, useMemo, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

const EDITORIAL_PROFILE_ID =
  "ee352af0-2ce9-49bf-9402-c6d6edb1c26c";

/* ================= TYPES ================= */

type Source = {
  id: string;
  title?: string | null;
  source_type: string;
  source_url?: string | null;
  source_strength_label?: string | null;
  is_canonical?: boolean | null;
};

type Claim = {
  id: string;
  source_id?: string | null;
  claim_text: string;
  normalized_claim_text?: string | null;
  story_order?: number | null;
};

type StoryCluster = {
  id: string;
  title: string;
  top_line?: string | null;
  editorial_status?: string | null;
  image_url?: string | null;
  image_attribution?: string | null;
};

type StoryDetail = {
  story_cluster: StoryCluster;
  sources: Source[];
  claims: Claim[];
  latest_render?: {
    headline?: string;
    body?: string;
  };
};

type DashboardStory = {
  story_cluster: StoryCluster;
  source_count: number;
  claim_count: number;
  canonical_claim_count: number;
  strength_score: number;
  latest_render?: {
    headline?: string;
  };
};

/* ================= HELPERS ================= */

function formatSourceType(type: string) {
  return type
    .split("_")
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

function getBackbone(claims: Claim[]) {
  const ordered = claims
    .slice()
    .sort((a, b) => (a.story_order || 999) - (b.story_order || 999));

  return [
    {
      label: "Lead",
      text: ordered.slice(0, 2).map((c) => c.normalized_claim_text || c.claim_text).join(" "),
    },
    {
      label: "Support",
      text: ordered.slice(2, 6).map((c) => c.normalized_claim_text || c.claim_text).join(" "),
    },
  ];
}

/* ================= COMPONENT ================= */

export default function Dashboard() {
  const [stories, setStories] = useState<DashboardStory[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<StoryDetail | null>(null);
  const [tab, setTab] = useState<"dashboard" | "publishable">("dashboard");

  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [heroAttr, setHeroAttr] = useState("");

  /* ===== LOAD ===== */

  const loadDashboard = async () => {
    const res = await fetch(`${API_BASE}/editorial/dashboard`);
    const data = await res.json();
    setStories(data.stories || []);
  };

  const loadStory = async (id: string) => {
    const res = await fetch(`${API_BASE}/stories/${id}`);
    const data = await res.json();
    setSelected(data);
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (selectedId) loadStory(selectedId);
  }, [selectedId]);

  /* ===== HERO UPLOAD ===== */

  const uploadHero = async () => {
    if (!selected || !heroFile) return;

    const form = new FormData();
    form.append("file", heroFile);
    form.append("attribution", heroAttr);

    await fetch(
      `${API_BASE}/stories/${selected.story_cluster.id}/hero-image`,
      { method: "POST", body: form }
    );

    setHeroFile(null);
    setHeroAttr("");
    loadStory(selected.story_cluster.id);
  };

  /* ===== UI ===== */

  return (
    <main className="p-6 space-y-6">
      <div className="flex gap-2">
        <button onClick={() => setTab("dashboard")}>Active</button>
        <button onClick={() => setTab("publishable")}>Publishable</button>
      </div>

      <div className="grid grid-cols-[300px_1fr] gap-6">
        {/* LEFT LIST */}
        <div>
          {stories.map((s) => (
            <div
              key={s.story_cluster.id}
              onClick={() => setSelectedId(s.story_cluster.id)}
              className="border p-3 mb-2 cursor-pointer"
            >
              <div>{s.story_cluster.top_line || s.story_cluster.title}</div>
              <div className="text-xs">
                {s.source_count} sources · {s.claim_count} claims
              </div>
            </div>
          ))}
        </div>

        {/* RIGHT PANEL */}
        <div>
          {!selected && <div>Select a story</div>}

          {selected && (
            <>
              {/* HEADER */}
              <div className="border p-5 mb-4">
                <h2>
                  {selected.story_cluster.top_line ||
                    selected.story_cluster.title}
                </h2>
              </div>

              {/* HERO UPLOAD */}
              {tab === "dashboard" && (
                <div className="border p-4 mb-4 space-y-3">
                  <div>Hero image</div>

                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) =>
                      setHeroFile(e.target.files?.[0] || null)
                    }
                  />

                  <input
                    placeholder="Attribution"
                    value={heroAttr}
                    onChange={(e) => setHeroAttr(e.target.value)}
                  />

                  <button onClick={uploadHero}>Upload</button>

                  {selected.story_cluster.image_url && (
                    <div>
                      <img
                        src={selected.story_cluster.image_url}
                        className="h-32"
                      />
                      <div className="text-xs">
                        {selected.story_cluster.image_attribution}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* BACKBONE */}
              <div className="border p-4 mb-4">
                <div>Editorial structure</div>
                {getBackbone(selected.claims).map((p, i) => (
                  <div key={i} className="mb-3">
                    <div className="text-xs uppercase">{p.label}</div>
                    <div>{p.text}</div>
                  </div>
                ))}
              </div>

              {/* SOURCES */}
              <div className="border p-4">
                <div>Sources</div>
                {selected.sources.map((s) => (
                  <div key={s.id} className="border p-2 mt-2">
                    {s.source_url ? (
                      <a href={s.source_url} target="_blank">
                        {s.title || formatSourceType(s.source_type)}
                      </a>
                    ) : (
                      s.title
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}