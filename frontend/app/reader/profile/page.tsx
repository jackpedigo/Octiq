"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const API_BASE = "http://127.0.0.1:8000";

const STATES = [
  { name: "Alabama", abbr: "AL" },
  { name: "Alaska", abbr: "AK" },
  { name: "Arizona", abbr: "AZ" },
  { name: "Arkansas", abbr: "AR" },
  { name: "California", abbr: "CA" },
  { name: "Colorado", abbr: "CO" },
  { name: "Connecticut", abbr: "CT" },
  { name: "Delaware", abbr: "DE" },
  { name: "Florida", abbr: "FL" },
  { name: "Georgia", abbr: "GA" },
  { name: "Hawaii", abbr: "HI" },
  { name: "Idaho", abbr: "ID" },
  { name: "Illinois", abbr: "IL" },
  { name: "Indiana", abbr: "IN" },
  { name: "Iowa", abbr: "IA" },
  { name: "Kansas", abbr: "KS" },
  { name: "Kentucky", abbr: "KY" },
  { name: "Louisiana", abbr: "LA" },
  { name: "Maine", abbr: "ME" },
  { name: "Maryland", abbr: "MD" },
  { name: "Massachusetts", abbr: "MA" },
  { name: "Michigan", abbr: "MI" },
  { name: "Minnesota", abbr: "MN" },
  { name: "Mississippi", abbr: "MS" },
  { name: "Missouri", abbr: "MO" },
  { name: "Montana", abbr: "MT" },
  { name: "Nebraska", abbr: "NE" },
  { name: "Nevada", abbr: "NV" },
  { name: "New Hampshire", abbr: "NH" },
  { name: "New Jersey", abbr: "NJ" },
  { name: "New Mexico", abbr: "NM" },
  { name: "New York", abbr: "NY" },
  { name: "North Carolina", abbr: "NC" },
  { name: "North Dakota", abbr: "ND" },
  { name: "Ohio", abbr: "OH" },
  { name: "Oklahoma", abbr: "OK" },
  { name: "Oregon", abbr: "OR" },
  { name: "Pennsylvania", abbr: "PA" },
  { name: "Rhode Island", abbr: "RI" },
  { name: "South Carolina", abbr: "SC" },
  { name: "South Dakota", abbr: "SD" },
  { name: "Tennessee", abbr: "TN" },
  { name: "Texas", abbr: "TX" },
  { name: "Utah", abbr: "UT" },
  { name: "Vermont", abbr: "VT" },
  { name: "Virginia", abbr: "VA" },
  { name: "Washington", abbr: "WA" },
  { name: "West Virginia", abbr: "WV" },
  { name: "Wisconsin", abbr: "WI" },
  { name: "Wyoming", abbr: "WY" },
];

const NEWS_BEATS = [
  "Politics",
  "Economy",
  "Education",
  "Public Safety",
  "Health",
  "Environment",
  "Technology",
  "Housing",
  "Transportation",
  "Labor",
  "Courts",
  "Immigration",
  "International",
  "Climate",
  "Business",
  "Media",
  "Culture",
  "Sports",
];

function stateNameToAbbr(name: string) {
  return STATES.find((s) => s.name === name)?.abbr || "";
}

function stateAbbrToName(abbr: string) {
  return STATES.find((s) => s.abbr === abbr)?.name || "";
}

function normalizeInterestForStorage(label: string) {
  return label.toLowerCase().replace(/\s+/g, "_");
}

function normalizeInterestForDisplay(value: string) {
  return NEWS_BEATS.find(
    (beat) => normalizeInterestForStorage(beat) === value
  ) || value;
}

function computeEvidenceVisibility(
  depth: string,
  newsLiteracy: string
): "low" | "medium" | "high" {
  if (depth === "deep") return "high";
  if (depth === "quick") return newsLiteracy === "expert" ? "medium" : "low";
  if (newsLiteracy === "expert") return "high";
  if (newsLiteracy === "standard") return "medium";
  return "medium";
}

export default function ReaderProfilePage() {
  const searchParams = useSearchParams();
  const userId = searchParams.get("user") || "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [name, setName] = useState("");
  const [stateName, setStateName] = useState("");
  const [depth, setDepth] = useState("");
  const [newsLiteracy, setNewsLiteracy] = useState("");
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);

  const computedEvidenceVisibility = useMemo(() => {
    return computeEvidenceVisibility(depth, newsLiteracy);
  }, [depth, newsLiteracy]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!userId) {
        setError("Missing user profile ID.");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/user-profiles/${userId}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.detail || "Failed to load user profile");
        }

        setName(data.name || "");
        setStateName(stateAbbrToName(data.state || ""));
        setDepth(data.depth_preference || "");
        setNewsLiteracy(data.vocabulary_level || "");
        setSelectedInterests(
          (data.interests || []).map((x: string) => normalizeInterestForDisplay(x))
        );
      } catch (err: any) {
        setError(err.message || "Failed to load profile");
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [userId]);

  const toggleInterest = (beat: string) => {
    setSelectedInterests((prev) =>
      prev.includes(beat)
        ? prev.filter((x) => x !== beat)
        : [...prev, beat]
    );
  };

  const saveProfile = async () => {
    if (!userId) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        state: stateNameToAbbr(stateName),
        interests: selectedInterests.map(normalizeInterestForStorage),
        depth_preference: depth,
        vocabulary_level: newsLiteracy,
        evidence_visibility: computedEvidenceVisibility,
      };

      const res = await fetch(`${API_BASE}/user-profiles/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to save profile");
      }

      setSuccess("Profile updated successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen px-6 py-12" style={{ backgroundColor: "#1F0954" }}>
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm">
          Loading profile...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-12" style={{ backgroundColor: "#1F0954" }}>
        <div className="rounded-3xl bg-white p-8 shadow-sm space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-slate-500">Profile</div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                {name || "Unnamed user"}
              </h1>
              <div className="mt-2 text-sm text-slate-500 font-mono">{userId}</div>
            </div>

            <div className="flex gap-2">
              <Link
                href={`/reader?user=${userId}`}
                className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
              >
                Back to Feed
              </Link>
              <Link
                href="/reader"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
              >
                Logout
              </Link>
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {success}
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">State</span>
              <select
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
                className="w-full rounded-2xl border px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="">Select a state</option>
                {STATES.map((state) => (
                  <option key={state.abbr} value={state.name}>
                    {state.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Depth</span>
              <select
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
                className="w-full rounded-2xl border px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="">Select</option>
                <option value="quick">Quick</option>
                <option value="standard">Standard</option>
                <option value="deep">Deep</option>
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">
                News Literacy
              </span>
              <select
                value={newsLiteracy}
                onChange={(e) => setNewsLiteracy(e.target.value)}
                className="w-full rounded-2xl border px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="">Select</option>
                <option value="simple">Novice</option>
                <option value="standard">Standard</option>
                <option value="expert">Junkie</option>
              </select>
            </label>

          <div className="space-y-3">
            <div className="text-sm font-medium text-slate-700">Interests</div>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {NEWS_BEATS.map((beat) => {
                const selected = selectedInterests.includes(beat);
                return (
                  <button
                    key={beat}
                    type="button"
                    onClick={() => toggleInterest(beat)}
                    className={`rounded-2xl border px-4 py-3 text-sm text-left transition ${
                      selected
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    {beat}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={saveProfile}
              disabled={saving}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save profile"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}