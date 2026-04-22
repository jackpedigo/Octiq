"use client";

import { useEffect, useMemo, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
const EDITORIAL_PROFILE_ID = "ee352af0-2ce9-49bf-9402-c6d6edb1c26c";

type Source = {
  id: string;
  title?: string | null;
  source_type: string;
  source_date?: string | null;
  source_time?: string | null;
  source_url?: string | null;
  file_url?: string | null;
  file_type?: string | null;
  raw_text?: string | null;
  source_strength_score?: number | null;
  source_strength_label?: string | null;
  is_canonical?: boolean | null;
  contains_verifiable_info?: boolean | null;
  is_primarily_opinion?: boolean | null;
  is_direct_evidence?: boolean | null;
};

type Claim = {
  id: string;
  source_id?: string | null;
  claim_text: string;
  normalized_claim_text?: string | null;
  support_excerpt?: string | null;
  is_core_claim?: boolean;
  verification_status?: string | null;
  claim_type?: string | null;
  support_count?: number | null;
  story_order?: number | null;
};

type StoryCluster = {
  id: string;
  title: string;
  top_line?: string | null;
  main_issue?: string | null;
  event_type?: string | null;
  location?: string | null;
  date_reference?: string | null;
  summary_seed?: string | null;
  story_nucleus?: string | null;
  editorial_status?: string | null;
  is_homepage?: boolean | null;
  latest_editor_note?: string | null;
  latest_editor_note_type?: string | null;
  image_url?: string | null;
  image_attribution?: string | null;
};

type StoryDetail = {
  story_cluster: StoryCluster;
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

type DashboardStory = {
  story_cluster: StoryCluster;
  source_count: number;
  claim_count: number;
  canonical_claim_count: number;
  strength_score: number;
  latest_render?: {
    id: string;
    headline?: string | null;
    summary?: string | null;
    body?: string | null;
    why_it_matters?: string | null;
    user_profile_id?: string | null;
  } | null;
};

const SOURCE_TYPES = [
  "octiq_copy",
  "official_statement",
  "quote",
  "interview",
  "speech",
  "social_post",
  "document",
  "data_release",
  "news_article",
];

function formatSourceType(type: string) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusPill(status?: string | null) {
  if (status === "core") return "Core";
  if (status === "supported") return "Supported";
  if (status === "attributed_only") return "Attributed";
  return status || "Unclassified";
}

function buildMissingList(item: DashboardStory, detail: StoryDetail | null) {
  const missing: string[] = [];

  if (item.canonical_claim_count === 0) {
    missing.push("No canonical claims are currently anchoring this story.");
  }
  if (item.source_count < 2) {
    missing.push("Needs more sourcing depth.");
  }
  if (item.claim_count < 4) {
    missing.push("Needs a stronger base of story-relevant claims.");
  }
  if (detail && !detail.story_cluster.location) {
    missing.push("Location framing is still thin.");
  }
  if (detail && !detail.story_cluster.date_reference) {
    missing.push("Time or date framing could be clearer.");
  }

  if (missing.length === 0) {
    missing.push("Structurally solid. Ready for stronger editorial judgment.");
  }

  return missing;
}

function getStoryBackboneParagraphs(claims: Claim[]) {
  const ordered = claims
    .slice()
    .sort((a, b) => (a.story_order || 999) - (b.story_order || 999));

  const lead = ordered.slice(0, 2);
  const nutGraf = ordered.slice(2, 4);
  const keyReporting = ordered.slice(4, 8);
  const context = ordered.slice(8, 12);

  const buildParagraph = (items: Claim[]) =>
    items
      .map((claim) => claim.normalized_claim_text || claim.claim_text)
      .filter(Boolean)
      .join(" ");

  return [
    { label: "Lead", claims: lead, text: buildParagraph(lead) },
    { label: "Nut graf", claims: nutGraf, text: buildParagraph(nutGraf) },
    {
      label: "Key reporting",
      claims: keyReporting,
      text: buildParagraph(keyReporting),
    },
    {
      label: "Context / background",
      claims: context,
      text: buildParagraph(context),
    },
  ].filter((section) => section.claims.length > 0 && section.text.trim());
}

function getSourcesForClaims(claims: Claim[], sources: Source[]) {
  const sourceMap = new Map<string, Source>();

  for (const claim of claims) {
    const source = sources.find((s) => s.id === claim.source_id);
    if (source) {
      sourceMap.set(source.id, source);
    }
  }

  return Array.from(sourceMap.values());
}

function StoryBackboneView({
  claims,
  sources,
}: {
  claims: Claim[];
  sources: Source[];
}) {
  const paragraphs = getStoryBackboneParagraphs(claims);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm space-y-6">
      <h3 className="text-xl font-semibold text-slate-950">
        Editorial structure
      </h3>

      <div className="space-y-5">
        {paragraphs.length > 0 ? (
          paragraphs.map((section, index) => {
            const sectionSources = getSourcesForClaims(section.claims, sources);

            return (
              <div
                key={`${section.label}-${index}`}
                className="rounded-2xl border border-slate-200 p-5"
              >
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {section.label}
                </div>

                <div className="text-[15px] leading-[1.6] text-slate-800">
                  {section.text}
                </div>

                {sectionSources.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {sectionSources.map((source) => (
                      <a
                        key={source.id}
                        href={source.source_url || "#"}
                        target={source.source_url ? "_blank" : undefined}
                        rel={source.source_url ? "noreferrer" : undefined}
                        className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-slate-200"
                        style={{
                          pointerEvents: source.source_url ? "auto" : "none",
                          opacity: source.source_url ? 1 : 0.7,
                        }}
                      >
                        {source.title || formatSourceType(source.source_type)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="text-sm text-slate-500">
            No structured backbone available yet.
          </div>
        )}
      </div>
    </div>
  );
}

function SourceCard({ source }: { source: Source }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative rounded-2xl border border-slate-200 p-4"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-slate-900">
          {source.source_url ? (
            <a
              href={source.source_url}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
              style={{ color: "#1F0954" }}
            >
              {source.title || formatSourceType(source.source_type)}
            </a>
          ) : (
            source.title || formatSourceType(source.source_type)
          )}
        </div>

        {source.source_strength_label && (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
            {source.source_strength_label}
          </span>
        )}
      </div>

      <div className="mt-1 text-sm text-slate-600">
        {formatSourceType(source.source_type)}
        {source.source_date ? ` · ${source.source_date}` : ""}
        {source.source_time ? ` ${source.source_time}` : ""}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {source.is_canonical ? (
          <span className="rounded-full bg-[#1F0954]/10 px-3 py-1 text-[#1F0954]">
            Canonical
          </span>
        ) : null}
        {source.contains_verifiable_info ? (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
            Verifiable
          </span>
        ) : null}
        {source.is_direct_evidence ? (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
            Direct evidence
          </span>
        ) : null}
        {source.is_primarily_opinion ? (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
            Opinion-heavy
          </span>
        ) : null}
      </div>

      {hovered && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[420px] max-w-[90vw] rounded-2xl border bg-white p-4 shadow-xl">
          <div className="text-xs text-slate-500">
            {formatSourceType(source.source_type)}
          </div>

          <div className="mt-1 text-sm font-semibold text-slate-900">
            {source.title || formatSourceType(source.source_type)}
          </div>

          {source.raw_text && (
            <div className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-sm text-slate-700">
              {source.raw_text}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            {source.source_url && (
              <a
                href={source.source_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
                style={{ color: "#FFA166" }}
              >
                Open source
              </a>
            )}

            {source.file_url && (
              <a
                href={source.file_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
                style={{ color: "#FFA166" }}
              >
                Open file
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OctiqEditorialDashboard() {
  const [tab, setTab] = useState<"dashboard" | "publishable" | "ingest">(
    "dashboard"
  );

  const [dashboardStories, setDashboardStories] = useState<DashboardStory[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState("");
  const [selectedStory, setSelectedStory] = useState<StoryDetail | null>(null);

  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [rendering, setRendering] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [continueNote, setContinueNote] = useState("");
  const [storyNotes, setStoryNotes] = useState<Record<string, string>>({});

  const [sourceType, setSourceType] = useState("octiq_copy");
  const [storyClusterId, setStoryClusterId] = useState("");
  const [title, setTitle] = useState("");
  const [rawText, setRawText] = useState("");
  const [sourceDate, setSourceDate] = useState("");
  const [sourceTime, setSourceTime] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [speakerName, setSpeakerName] = useState("");
  const [speakerEntity, setSpeakerEntity] = useState("");
  const [entityName, setEntityName] = useState("");
  const [platform, setPlatform] = useState("");
  const [handle, setHandle] = useState("");
  const [outletName, setOutletName] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [issuingBody, setIssuingBody] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<any>(null);

  const [mergeTargetId, setMergeTargetId] = useState("");
  const [deletingCluster, setDeletingCluster] = useState(false);
  const [mergingCluster, setMergingCluster] = useState(false);

  const [showRenderedPreview, setShowRenderedPreview] = useState(false);

  const [heroImageFile, setHeroImageFile] = useState<File | null>(null);
  const [heroImageAttribution, setHeroImageAttribution] = useState("");
  const [uploadingHeroImage, setUploadingHeroImage] = useState(false);

  const [clusterOptions, setClusterOptions] = useState<
    Array<{ id: string; title: string }>
  >([]);

  const [showNewStoryPanel, setShowNewStoryPanel] = useState(false);
  const [newStoryNucleus, setNewStoryNucleus] = useState("");
  const [newStoryTitle, setNewStoryTitle] = useState("");
  const [creatingStory, setCreatingStory] = useState(false);

  const [showClusterIngestPanel, setShowClusterIngestPanel] = useState(false);
  const [batchSources, setBatchSources] = useState<any[]>([
    {
      source_type: "octiq_copy",
      title: "",
      raw_text: "",
      source_date: "",
      source_time: "",
      source_url: "",
      speaker_name: "",
      speaker_entity: "",
      entity_name: "",
      platform: "",
      handle: "",
      outlet_name: "",
      document_type: "",
      issuing_body: "",
      file_url: "",
      file_type: "",
    },
  ]);
  const [batchIngesting, setBatchIngesting] = useState(false);

  const dashboardOnlyStories = useMemo(
    () =>
      dashboardStories.filter(
        (s) =>
          s.story_cluster.editorial_status !== "publishable" &&
          !s.story_cluster.is_homepage
      ),
    [dashboardStories]
  );

  const publishableStories = useMemo(
    () =>
      dashboardStories.filter(
        (s) =>
          s.story_cluster.editorial_status === "publishable" ||
          s.story_cluster.is_homepage
      ),
    [dashboardStories]
  );

  const visibleStories =
    tab === "publishable" ? publishableStories : dashboardOnlyStories;

  const selectedDashboardStory = useMemo(
    () =>
      dashboardStories.find(
        (story) => story.story_cluster.id === selectedStoryId
      ) || null,
    [dashboardStories, selectedStoryId]
  );

  const showTitleField = useMemo(() => {
    return [
      "official_statement",
      "document",
      "data_release",
      "news_article",
    ].includes(sourceType);
  }, [sourceType]);

  const isOctiqCopy = sourceType === "octiq_copy";
  const isSpeechLike = ["quote", "interview", "speech"].includes(sourceType);
  const isSocial = sourceType === "social_post";
  const isOfficial = sourceType === "official_statement";
  const isNewsArticle = sourceType === "news_article";
  const isDocument = sourceType === "document";
  const isDataRelease = sourceType === "data_release";

  const loadDashboard = async () => {
    setLoadingDashboard(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/editorial/dashboard`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to load dashboard");
      }

      const stories: DashboardStory[] = data.stories || [];
      setDashboardStories(stories);

      const nextVisible =
        tab === "publishable"
          ? stories.filter(
              (s) =>
                s.story_cluster.editorial_status === "publishable" ||
                s.story_cluster.is_homepage
            )
          : stories.filter(
              (s) =>
                s.story_cluster.editorial_status !== "publishable" &&
                !s.story_cluster.is_homepage
            );

      if (nextVisible.length > 0) {
        const keepCurrent = nextVisible.some(
          (s) => s.story_cluster.id === selectedStoryId
        );
        setSelectedStoryId(
          keepCurrent ? selectedStoryId : nextVisible[0].story_cluster.id
        );
      } else {
        setSelectedStoryId("");
        setSelectedStory(null);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load dashboard");
    } finally {
      setLoadingDashboard(false);
    }
  };

  const loadClusterOptions = async () => {
    try {
      const res = await fetch(`${API_BASE}/editorial/dashboard`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to load clusters");
      }

      const options = (data.stories || []).map((item: any) => ({
        id: item.story_cluster.id,
        title:
          item.story_cluster.top_line ||
          item.latest_render?.headline ||
          item.story_cluster.title ||
          "Untitled cluster",
      }));

      setClusterOptions(options);
    } catch (err: any) {
      setError(err.message || "Failed to load clusters");
    }
  };

  const createNewStory = async () => {
    if (!newStoryNucleus.trim()) {
      setError("Enter a story nucleus first.");
      return;
    }

    setCreatingStory(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`${API_BASE}/stories/create-from-nucleus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story_nucleus: newStoryNucleus.trim(),
          title: newStoryTitle.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to create story");
      }

      setShowNewStoryPanel(false);
      setNewStoryNucleus("");
      setNewStoryTitle("");

      await loadDashboard();
      await loadClusterOptions();

      if (data.story_cluster_id) {
        setSelectedStoryId(data.story_cluster_id);
        await loadStory(data.story_cluster_id);
      }

      setSuccess("Story cluster created.");
    } catch (err: any) {
      setError(err.message || "Failed to create story");
    } finally {
      setCreatingStory(false);
    }
  };

  const openBatchIngestForSelectedStory = () => {
    if (!selectedStory) return;
    setBatchSources([
      {
        source_type: "octiq_copy",
        title: "",
        raw_text: "",
        source_date: "",
        source_time: "",
        source_url: "",
        speaker_name: "",
        speaker_entity: "",
        entity_name: "",
        platform: "",
        handle: "",
        outlet_name: "",
        document_type: "",
        issuing_body: "",
        file_url: "",
        file_type: "",
      },
    ]);
    setShowClusterIngestPanel(true);
  };

  const updateBatchSource = (
    index: number,
    field: string,
    value: string
  ) => {
    setBatchSources((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    );
  };

  const addBatchSourceRow = () => {
    setBatchSources((prev) => [
      ...prev,
      {
        source_type: "octiq_copy",
        title: "",
        raw_text: "",
        source_date: "",
        source_time: "",
        source_url: "",
        speaker_name: "",
        speaker_entity: "",
        entity_name: "",
        platform: "",
        handle: "",
        outlet_name: "",
        document_type: "",
        issuing_body: "",
        file_url: "",
        file_type: "",
      },
    ]);
  };

  const removeBatchSourceRow = (index: number) => {
    setBatchSources((prev) => prev.filter((_, i) => i !== index));
  };

  const submitBatchIngest = async () => {
    if (!selectedStory) return;

    const cleanedSources = batchSources
      .map((source) => ({
        ...source,
        title: source.title || null,
        raw_text: source.raw_text || "",
        source_date: source.source_date || null,
        source_time: source.source_time || null,
        source_url: source.source_url || null,
        speaker_name: source.speaker_name || null,
        speaker_entity: source.speaker_entity || null,
        entity_name: source.entity_name || null,
        platform: source.platform || null,
        handle: source.handle || null,
        outlet_name: source.outlet_name || null,
        document_type: source.document_type || null,
        issuing_body: source.issuing_body || null,
        file_url: source.file_url || null,
        file_type: source.file_type || null,
      }))
      .filter((source) => source.raw_text.trim());

    if (cleanedSources.length === 0) {
      setError("Add at least one source with raw text.");
      return;
    }

    setBatchIngesting(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(
        `${API_BASE}/stories/${selectedStory.story_cluster.id}/ingest-batch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sources: cleanedSources }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to ingest sources");
      }

      setShowClusterIngestPanel(false);
      await loadDashboard();
      await loadClusterOptions();
      await loadStory(selectedStory.story_cluster.id);

      setSuccess("Sources ingested into story cluster.");
    } catch (err: any) {
      setError(err.message || "Failed to ingest sources");
    } finally {
      setBatchIngesting(false);
    }
  };

  const loadStory = async (id: string) => {
    setLoadingSelected(true);
    setError("");

    try {
      const profileIdForView =
        tab === "publishable" ? EDITORIAL_PROFILE_ID : "";

      const url = profileIdForView
        ? `${API_BASE}/stories/${id}?user_profile_id=${encodeURIComponent(
            profileIdForView
          )}`
        : `${API_BASE}/stories/${id}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to load story");
      }

      setSelectedStory(data);
    } catch (err: any) {
      setError(err.message || "Failed to load story");
    } finally {
      setLoadingSelected(false);
    }
  };

  useEffect(() => {
    loadDashboard();
    loadClusterOptions();
  }, []);

  useEffect(() => {
    const nextVisible =
      tab === "publishable" ? publishableStories : dashboardOnlyStories;

    if (nextVisible.length > 0) {
      const keepCurrent = nextVisible.some(
        (s) => s.story_cluster.id === selectedStoryId
      );
      if (!keepCurrent) {
        setSelectedStoryId(nextVisible[0].story_cluster.id);
      }
    } else {
      setSelectedStoryId("");
      setSelectedStory(null);
    }
  }, [tab, publishableStories, dashboardOnlyStories, selectedStoryId]);

  useEffect(() => {
    if (selectedStoryId && (tab === "dashboard" || tab === "publishable")) {
      setShowRenderedPreview(false);
      loadStory(selectedStoryId);
    }
  }, [selectedStoryId, tab]);

  const updateEditorialStatus = async (
    storyId: string,
    editorial_status: "draft" | "publishable" | "published",
    is_homepage: boolean
  ) => {
    const res = await fetch(`${API_BASE}/stories/${storyId}/editorial`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editorial_status, is_homepage }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to update story");
  };

  const deleteSelectedCluster = async () => {
    if (!selectedStory) return;

    const ok = window.confirm(
      "Delete this story cluster? This will remove the cluster and its linked renders."
    );
    if (!ok) return;

    setDeletingCluster(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(
        `${API_BASE}/stories/${selectedStory.story_cluster.id}`,
        { method: "DELETE" }
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to delete story cluster");
      }

      setSelectedStory(null);
      setSelectedStoryId("");
      await loadDashboard();
      await loadClusterOptions();
      setSuccess("Story cluster deleted.");
    } catch (err: any) {
      setError(err.message || "Failed to delete story cluster");
    } finally {
      setDeletingCluster(false);
    }
  };

  const mergeSelectedCluster = async () => {
    if (!selectedStory) return;
    if (!mergeTargetId.trim()) {
      setError("Enter a target story cluster ID to merge into.");
      return;
    }

    setMergingCluster(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(
        `${API_BASE}/stories/${selectedStory.story_cluster.id}/merge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_story_cluster_id: mergeTargetId.trim(),
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to merge story cluster");
      }

      setMergeTargetId("");
      setSelectedStory(null);
      setSelectedStoryId("");
      await loadDashboard();
      await loadClusterOptions();
      setSuccess("Story cluster merged successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to merge story cluster");
    } finally {
      setMergingCluster(false);
    }
  };

  const renderSelectedStory = async () => {
    if (!selectedStory) return;
    if (
      !EDITORIAL_PROFILE_ID ||
      EDITORIAL_PROFILE_ID.includes("PASTE_YOUR")
    ) {
      setError("Set EDITORIAL_PROFILE_ID in ingest/page.tsx first.");
      return;
    }

    setRendering(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(
        `${API_BASE}/stories/${selectedStory.story_cluster.id}/render-if-needed/${EDITORIAL_PROFILE_ID}`,
        { method: "POST" }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to render story");
      }

      await loadDashboard();
      await loadClusterOptions();
      await loadStory(selectedStory.story_cluster.id);
      setShowRenderedPreview(true);
      setSuccess("Publishable review render generated.");
    } catch (err: any) {
      setError(err.message || "Failed to render story");
    } finally {
      setRendering(false);
    }
  };

  const uploadHeroImage = async () => {
    if (!selectedStory) return;
    if (!heroImageFile) {
      setError("Choose a JPG or PNG image first.");
      return;
    }

    setUploadingHeroImage(true);
    setError("");
    setSuccess("");

    try {
      const formData = new FormData();
      formData.append("file", heroImageFile);
      formData.append("attribution", heroImageAttribution);

      const res = await fetch(
        `${API_BASE}/stories/${selectedStory.story_cluster.id}/hero-image`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to upload hero image");
      }

      setHeroImageFile(null);
      setHeroImageAttribution("");

      await loadDashboard();
      await loadStory(selectedStory.story_cluster.id);

      setSuccess("Hero image uploaded successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to upload hero image");
    } finally {
      setUploadingHeroImage(false);
    }
  };

  const markPublishable = async () => {
    if (!selectedStory) return;
    if (
      !EDITORIAL_PROFILE_ID ||
      EDITORIAL_PROFILE_ID.includes("PASTE_YOUR")
    ) {
      setError("Set EDITORIAL_PROFILE_ID in ingest/page.tsx first.");
      return;
    }

    setPublishing(true);
    setError("");
    setSuccess("");

    try {
      await updateEditorialStatus(
        selectedStory.story_cluster.id,
        "publishable",
        false
      );
      await loadDashboard();

      setTab("publishable");
      setSelectedStoryId(selectedStory.story_cluster.id);

      const res = await fetch(
        `${API_BASE}/stories/${selectedStory.story_cluster.id}/render-if-needed/${EDITORIAL_PROFILE_ID}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to render publishable story");
      }

      await loadDashboard();
      await loadClusterOptions();
      await loadStory(selectedStory.story_cluster.id);
      setSuccess("Story marked publishable and rendered for editorial review.");
    } catch (err: any) {
      setError(err.message || "Failed to update story");
    } finally {
      setPublishing(false);
    }
  };

  const publishToHomepage = async () => {
    if (!selectedStory) return;

    setPublishing(true);
    setError("");
    setSuccess("");

    try {
      await updateEditorialStatus(
        selectedStory.story_cluster.id,
        "published",
        true
      );
      await loadDashboard();
      await loadClusterOptions();
      await loadStory(selectedStory.story_cluster.id);
      setSuccess("Story published to homepage.");
    } catch (err: any) {
      setError(err.message || "Failed to publish story");
    } finally {
      setPublishing(false);
    }
  };

  const continueBuilding = async () => {
    if (!selectedStory) return;

    setPublishing(true);
    setError("");
    setSuccess("");

    try {
      await updateEditorialStatus(selectedStory.story_cluster.id, "draft", false);

      if (continueNote.trim()) {
        setStoryNotes((prev) => ({
          ...prev,
          [selectedStory.story_cluster.id]: continueNote.trim(),
        }));
      }

      setContinueNote("");
      await loadDashboard();
      await loadClusterOptions();
      setTab("dashboard");
      setSuccess("Story moved back to dashboard for continued building.");
    } catch (err: any) {
      setError(err.message || "Failed to move story back to dashboard");
    } finally {
      setPublishing(false);
    }
  };

const getResolvedClusterId = (data: any) => {
  return (
    data.story_cluster_id ||
    data.cluster_result?.story_cluster_id ||
    data.cluster_result?.create_result?.story_cluster_id ||
    data.cluster_result?.add_result?.story_cluster_id ||
    null
  );
};  
const handleIngest = async () => {
  setIngesting(true);
  setError("");
  setSuccess("");
  setIngestResult(null);

  try {
    const payload = {
      source_type: sourceType,
      story_cluster_id: storyClusterId || null,
      title: showTitleField ? title || null : null,
      raw_text: rawText,
      source_date: isOctiqCopy ? null : sourceDate || null,
      source_time: isOctiqCopy ? null : sourceTime || null,
      source_url: sourceUrl || null,
      speaker_name: speakerName || null,
      speaker_entity: speakerEntity || null,
      entity_name: entityName || null,
      platform: platform || null,
      handle: handle || null,
      outlet_name: outletName || null,
      document_type: documentType || null,
      issuing_body: issuingBody || null,
      file_url: selectedFile ? URL.createObjectURL(selectedFile) : null,
      file_type: selectedFile ? selectedFile.type : null,
    };

    const res = await fetch(`${API_BASE}/sources/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Failed to ingest source");
    }

    setIngestResult(data);
    setSuccess("Source ingested successfully.");

    const resolvedClusterId =
      getResolvedClusterId(data) ||
      storyClusterId ||
      selectedStoryId ||
      null;

    if (resolvedClusterId) {
      setStoryClusterId(resolvedClusterId);
    }

    await loadDashboard();
    await loadClusterOptions();

    if (resolvedClusterId) {
      setTab("dashboard");
      setSelectedStoryId(resolvedClusterId);
      await loadStory(resolvedClusterId);
    }

    setTitle("");
    setRawText("");
    setSourceDate("");
    setSourceTime("");
    setSourceUrl("");
    setSpeakerName("");
    setSpeakerEntity("");
    setEntityName("");
    setPlatform("");
    setHandle("");
    setOutletName("");
    setDocumentType("");
    setIssuingBody("");
    setSelectedFile(null);
  } catch (err: any) {
    setError(err.message || "Failed to ingest source");
  } finally {
    setIngesting(false);
  }
};

  return (
    <main
      className="min-h-screen px-6 py-8"
      style={{
        backgroundColor: "#f3f6fa",
        fontFamily: "Helvetica, Arial, sans-serif",
      }}
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <div
          className="rounded-[28px] px-6 py-5 shadow-[0_14px_34px_rgba(31,9,84,0.18)]"
          style={{ backgroundColor: "#1F0954" }}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm text-white/70">Octiq News</div>
              <h1 className="text-3xl font-semibold tracking-tight text-white">
                Editorial Dashboard
              </h1>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setTab("dashboard")}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  tab === "dashboard"
                    ? "bg-white text-slate-900"
                    : "bg-white/10 text-white"
                }`}
              >
                Active
              </button>
              <button
                onClick={() => setTab("publishable")}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  tab === "publishable"
                    ? "bg-white text-slate-900"
                    : "bg-white/10 text-white"
                }`}
              >
                Publishable
              </button>
              <button
                onClick={() => setShowNewStoryPanel((prev) => !prev)}
                className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900"
              >
                + New Story
              </button>
              <button
                onClick={() => setTab("ingest")}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  tab === "ingest"
                    ? "bg-white text-slate-900"
                    : "bg-white/10 text-white"
                }`}
              >
                Ingest Source
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-green-700">
            {success}
          </div>
        )}

{showNewStoryPanel && (
  <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm space-y-4">
    <h3 className="text-xl font-semibold text-slate-950">Create new story</h3>

    <label className="space-y-2 block">
      <div className="text-sm font-medium">Working title (optional)</div>
      <input
        value={newStoryTitle}
        onChange={(e) => setNewStoryTitle(e.target.value)}
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
        placeholder="Working title"
      />
    </label>

    <label className="space-y-2 block">
      <div className="text-sm font-medium">Story nucleus</div>
      <textarea
        value={newStoryNucleus}
        onChange={(e) => setNewStoryNucleus(e.target.value)}
        rows={4}
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
        placeholder="Write 1–2 sentences describing the core of the story. This will guide source ingest and claim extraction."
      />
    </label>

    <div className="flex gap-3">
      <button
        onClick={createNewStory}
        disabled={creatingStory}
        className="rounded-full px-5 py-3 font-medium text-slate-950 disabled:opacity-50"
        style={{ backgroundColor: "#FFA166" }}
      >
        {creatingStory ? "Creating..." : "Create story"}
      </button>

      <button
        onClick={() => setShowNewStoryPanel(false)}
        className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm hover:bg-slate-50"
      >
        Cancel
      </button>
    </div>
  </div>
)}


        {(tab === "dashboard" || tab === "publishable") && (
          <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm text-slate-500">
                  {tab === "publishable"
                    ? "Publishable stories"
                    : "Active stories"}
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  {tab === "publishable"
                    ? "Stories marked publishable or already on homepage remain here for final review."
                    : "Draft stories and active non-publishable stories appear here automatically."}
                </div>
              </div>

              {loadingDashboard && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-600 shadow-sm">
                  Loading dashboard...
                </div>
              )}

              {!loadingDashboard && visibleStories.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-600 shadow-sm">
                  {tab === "publishable"
                    ? "No publishable stories yet."
                    : "No active stories found."}
                </div>
              )}

              <div className="space-y-3">
                {visibleStories.map((item) => {
                  const story = item.story_cluster;
                  const active = selectedStoryId === story.id;

                  return (
                    <button
                      key={story.id}
                      onClick={() => setSelectedStoryId(story.id)}
                      className={`w-full rounded-[24px] border p-4 text-left shadow-sm transition ${
                        active
                          ? "border-[#1F0954] bg-[#1F0954] text-white"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div
                        className={`text-xs ${
                          active ? "text-white/70" : "text-slate-500"
                        }`}
                      >
                        {story.editorial_status || "draft"}
                        {story.is_homepage ? " · on website" : ""}
                      </div>

                      <div className="mt-1 font-semibold leading-tight">
                        {story.top_line ||
                          item.latest_render?.headline ||
                          story.title ||
                          "Untitled story"}
                      </div>

                      <div
                        className={`mt-3 text-xs ${
                          active ? "text-white/75" : "text-slate-600"
                        }`}
                      >
                        {item.source_count} sources · {item.claim_count} claims ·{" "}
                        {item.canonical_claim_count} canonical
                      </div>

                      <div
                        className={`mt-1 text-xs ${
                          active ? "text-white/75" : "text-slate-600"
                        }`}
                      >
                        Editorial strength: {item.strength_score}%
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="space-y-6">
              {loadingSelected && (
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm text-slate-600">
                  Loading story...
                </div>
              )}

              {!loadingSelected && !selectedStory && (
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm text-slate-600">
                  Select a story to open the editorial view.
                </div>
              )}

              {!loadingSelected && selectedStory && selectedDashboardStory && (
                <>
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm space-y-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="text-sm text-slate-500">
                        {tab === "publishable" ? "Publishable review" : "Story cluster"}
                      </div>

                      <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
                        {selectedStory.story_cluster.top_line ||
                          selectedDashboardStory.latest_render?.headline ||
                          selectedStory.story_cluster.title ||
                          "Untitled story"}
                      </h2>

                      <div className="flex flex-wrap gap-2 text-sm text-slate-600">
                        <span className="rounded-full bg-slate-100 px-3 py-1">
                          {selectedStory.story_cluster.editorial_status || "draft"}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1">
                          {selectedDashboardStory.source_count} sources
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1">
                          {selectedDashboardStory.claim_count} claims
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1">
                          {selectedDashboardStory.canonical_claim_count} canonical claims
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1">
                          Strength {selectedDashboardStory.strength_score}%
                        </span>
                      </div>

                      {selectedStory.story_cluster.story_nucleus && (
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                          <strong>Nucleus:</strong> {selectedStory.story_cluster.story_nucleus}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {tab === "dashboard" && (
                        <>
                          <button
                            onClick={markPublishable}
                            disabled={publishing}
                            className="rounded-full px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
                            style={{ backgroundColor: "#FFA166" }}
                          >
                            {publishing ? "Updating..." : "Mark publishable"}
                          </button>

                          <button
                            onClick={openBatchIngestForSelectedStory}
                            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
                          >
                            Ingest source
                          </button>

                          <button
                            onClick={deleteSelectedCluster}
                            disabled={deletingCluster}
                            className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            {deletingCluster ? "Deleting..." : "Delete cluster"}
                          </button>
                        </>
                      )}

                      {tab === "publishable" && (
                        <>
                          <button
                            onClick={renderSelectedStory}
                            disabled={rendering}
                            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                          >
                            {rendering ? "Rendering..." : "Render full review version"}
                          </button>

                          <button
                            onClick={publishToHomepage}
                            disabled={publishing}
                            className="rounded-full px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
                            style={{ backgroundColor: "#FFA166" }}
                          >
                            {publishing ? "Publishing..." : "Publish to Homepage"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {(tab === "dashboard" || tab === "publishable") &&
                    selectedStory.story_cluster.image_url && (
                      <div className="space-y-2">
                        <img
                          src={selectedStory.story_cluster.image_url}
                          alt="Hero preview"
                          className="h-32 rounded-2xl object-cover"
                        />
                        {selectedStory.story_cluster.image_attribution && (
                          <div className="text-xs text-slate-500">
                            {selectedStory.story_cluster.image_attribution}
                          </div>
                        )}
                      </div>
                    )}

                  {tab === "dashboard" && (
                    <div className="text-slate-600">
                      This view shows the story backbone as copy organized in
                      inverted-pyramid order.
                    </div>
                  )}

                  {tab === "publishable" && (
                    <div className="text-slate-600">
                      This view shows the structured backbone of the story. Use
                      {" "}“Render full review version”{" "}
                      only when you want to preview the editorial-profile article.
                    </div>
                  )}
                </div>

                  {tab === "publishable" && showRenderedPreview && (
                    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                      <h3 className="text-xl font-semibold text-slate-950">
                        Rendered review version
                      </h3>

                      {selectedStory.latest_render ? (
                        <>
                          {selectedStory.latest_render.headline && (
                            <h4 className="text-2xl font-semibold leading-[1.2] text-slate-950">
                              {selectedStory.latest_render.headline}
                            </h4>
                          )}

                          {selectedStory.latest_render.summary && (
                            <p className="text-lg text-slate-700">
                              {selectedStory.latest_render.summary}
                            </p>
                          )}

                          <div className="whitespace-pre-wrap text-slate-800 leading-[1.5]">
                            {selectedStory.latest_render.body ||
                              "No rendered body yet."}
                          </div>
                        </>
                      ) : (
                        <div className="text-slate-600">
                          No rendered article available yet.
                        </div>
                      )}
                    </div>
                  )}

                  {tab === "dashboard" && (
                    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                      <h3 className="text-xl font-semibold text-slate-950">
                        Hero image
                      </h3>

                      <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
                        <input
                          type="file"
                          accept="image/png,image/jpeg"
                          onChange={(e) =>
                            setHeroImageFile(e.target.files?.[0] || null)
                          }
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
                        />

                        <input
                          value={heroImageAttribution}
                          onChange={(e) =>
                            setHeroImageAttribution(e.target.value)
                          }
                          placeholder="Image attribution"
                          className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                        />

                        <button
                          onClick={uploadHeroImage}
                          disabled={uploadingHeroImage}
                          className="rounded-full px-5 py-3 font-medium text-slate-950 disabled:opacity-50"
                          style={{ backgroundColor: "#FFA166" }}
                        >
                          {uploadingHeroImage ? "Uploading..." : "Add image"}
                        </button>
                      </div>

                    </div>
                  )}

                  {tab === "dashboard" && showClusterIngestPanel && selectedStory && (
                    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm space-y-6">
                      <div>
                        <div className="text-sm text-slate-500">Batch ingest</div>
                        <h3 className="text-xl font-semibold text-slate-950">
                          Add sources to this story
                        </h3>
                        <p className="mt-1 text-sm text-slate-600">
                          All sources added here will be assigned automatically to this cluster.
                          Cluster signals and structure will refresh once after the batch completes.
                        </p>
                      </div>

                      <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        <strong>Story nucleus:</strong>{" "}
                        {selectedStory.story_cluster.story_nucleus || "—"}
                      </div>

                      <div className="space-y-6">
                        {batchSources.map((source, index) => {
                          const isBatchOctiqCopy = source.source_type === "octiq_copy";
                          const isBatchSpeechLike = ["quote", "interview", "speech"].includes(
                            source.source_type
                          );
                          const isBatchSocial = source.source_type === "social_post";
                          const isBatchOfficial = source.source_type === "official_statement";
                          const isBatchNewsArticle = source.source_type === "news_article";
                          const isBatchDocument = source.source_type === "document";
                          const isBatchDataRelease = source.source_type === "data_release";
                          const showBatchTitleField = [
                            "official_statement",
                            "document",
                            "data_release",
                            "news_article",
                          ].includes(source.source_type);

                          return (
                            <div
                              key={index}
                              className="rounded-2xl border border-slate-200 p-4 space-y-4"
                            >
                              <div className="flex items-center justify-between">
                                <div className="font-medium text-slate-900">
                                  Source {index + 1}
                                </div>

                                {batchSources.length > 1 && (
                                  <button
                                    onClick={() => removeBatchSourceRow(index)}
                                    className="text-sm text-red-600 hover:underline"
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>

                              <div className="grid gap-4 md:grid-cols-2">
                                <label className="space-y-2">
                                  <div className="text-sm font-medium">Source type</div>
                                  <select
                                    value={source.source_type}
                                    onChange={(e) =>
                                      updateBatchSource(index, "source_type", e.target.value)
                                    }
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                  >
                                    {SOURCE_TYPES.map((type) => (
                                      <option key={type} value={type}>
                                        {formatSourceType(type)}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                {showBatchTitleField ? (
                                  <label className="space-y-2">
                                    <div className="text-sm font-medium">Title</div>
                                    <input
                                      value={source.title}
                                      onChange={(e) =>
                                        updateBatchSource(index, "title", e.target.value)
                                      }
                                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                      placeholder="Source title"
                                    />
                                  </label>
                                ) : (
                                  <div />
                                )}
                              </div>

                              {!isBatchOctiqCopy && (
                                <div className="grid gap-4 md:grid-cols-2">
                                  <label className="space-y-2">
                                    <div className="text-sm font-medium">Source date (optional)</div>
                                    <input
                                      type="date"
                                      value={source.source_date}
                                      onChange={(e) =>
                                        updateBatchSource(index, "source_date", e.target.value)
                                      }
                                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                    />
                                  </label>

                                  <label className="space-y-2">
                                    <div className="text-sm font-medium">Source time (optional)</div>
                                    <input
                                      type="time"
                                      value={source.source_time}
                                      onChange={(e) =>
                                        updateBatchSource(index, "source_time", e.target.value)
                                      }
                                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                    />
                                  </label>
                                </div>
                              )}

                              {!isBatchOctiqCopy && (
                                <label className="space-y-2 block">
                                  <div className="text-sm font-medium">Source URL (optional)</div>
                                  <input
                                    value={source.source_url}
                                    onChange={(e) =>
                                      updateBatchSource(index, "source_url", e.target.value)
                                    }
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                    placeholder="https://..."
                                  />
                                </label>
                              )}

                              {isBatchSpeechLike && (
                                <div className="grid gap-4 md:grid-cols-2">
                                  <label className="space-y-2">
                                    <div className="text-sm font-medium">Speaker name</div>
                                    <input
                                      value={source.speaker_name}
                                      onChange={(e) =>
                                        updateBatchSource(index, "speaker_name", e.target.value)
                                      }
                                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                      placeholder="Jane Smith"
                                    />
                                  </label>

                                  <label className="space-y-2">
                                    <div className="text-sm font-medium">Speaker entity</div>
                                    <input
                                      value={source.speaker_entity}
                                      onChange={(e) =>
                                        updateBatchSource(index, "speaker_entity", e.target.value)
                                      }
                                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                      placeholder="Agency or organization"
                                    />
                                  </label>
                                </div>
                              )}

                              {isBatchOfficial && (
                                <label className="space-y-2 block">
                                  <div className="text-sm font-medium">Entity name</div>
                                  <input
                                    value={source.entity_name}
                                    onChange={(e) =>
                                      updateBatchSource(index, "entity_name", e.target.value)
                                    }
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                    placeholder="Issuing organization"
                                  />
                                </label>
                              )}

                              {isBatchSocial && (
                                <div className="grid gap-4 md:grid-cols-3">
                                  <label className="space-y-2">
                                    <div className="text-sm font-medium">Platform</div>
                                    <input
                                      value={source.platform}
                                      onChange={(e) =>
                                        updateBatchSource(index, "platform", e.target.value)
                                      }
                                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                      placeholder="X"
                                    />
                                  </label>

                                  <label className="space-y-2">
                                    <div className="text-sm font-medium">Account / speaker name</div>
                                    <input
                                      value={source.speaker_name}
                                      onChange={(e) =>
                                        updateBatchSource(index, "speaker_name", e.target.value)
                                      }
                                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                      placeholder="Account name"
                                    />
                                  </label>

                                  <label className="space-y-2">
                                    <div className="text-sm font-medium">Handle</div>
                                    <input
                                      value={source.handle}
                                      onChange={(e) =>
                                        updateBatchSource(index, "handle", e.target.value)
                                      }
                                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                      placeholder="@handle"
                                    />
                                  </label>
                                </div>
                              )}

                              {isBatchNewsArticle && (
                                <label className="space-y-2 block">
                                  <div className="text-sm font-medium">Outlet name</div>
                                  <input
                                    value={source.outlet_name}
                                    onChange={(e) =>
                                      updateBatchSource(index, "outlet_name", e.target.value)
                                    }
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                    placeholder="Outlet name"
                                  />
                                </label>
                              )}

                              {isBatchDocument && (
                                <div className="grid gap-4 md:grid-cols-2">
                                  <label className="space-y-2">
                                    <div className="text-sm font-medium">Document type</div>
                                    <input
                                      value={source.document_type}
                                      onChange={(e) =>
                                        updateBatchSource(index, "document_type", e.target.value)
                                      }
                                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                      placeholder="Court filing"
                                    />
                                  </label>

                                  <label className="space-y-2">
                                    <div className="text-sm font-medium">Issuing body</div>
                                    <input
                                      value={source.issuing_body}
                                      onChange={(e) =>
                                        updateBatchSource(index, "issuing_body", e.target.value)
                                      }
                                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                      placeholder="Issuing body"
                                    />
                                  </label>
                                </div>
                              )}

                              {isBatchDataRelease && (
                                <label className="space-y-2 block">
                                  <div className="text-sm font-medium">Issuing body</div>
                                  <input
                                    value={source.issuing_body}
                                    onChange={(e) =>
                                      updateBatchSource(index, "issuing_body", e.target.value)
                                    }
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                    placeholder="Issuing body"
                                  />
                                </label>
                              )}

                              <label className="space-y-2 block">
                                <div className="text-sm font-medium">
                                  {isBatchOctiqCopy ? "Octiq copy" : "Raw text"}
                                </div>
                                <textarea
                                  value={source.raw_text}
                                  onChange={(e) =>
                                    updateBatchSource(index, "raw_text", e.target.value)
                                  }
                                  rows={8}
                                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                                  placeholder={
                                    isBatchOctiqCopy
                                      ? "Paste Octiq canonical copy here..."
                                      : "Paste full source text here..."
                                  }
                                />
                              </label>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={addBatchSourceRow}
                          className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm hover:bg-slate-50"
                        >
                          + Add another source
                        </button>

                        <button
                          onClick={submitBatchIngest}
                          disabled={batchIngesting}
                          className="rounded-full px-5 py-3 font-medium text-slate-950 disabled:opacity-50"
                          style={{ backgroundColor: "#FFA166" }}
                        >
                          {batchIngesting ? "Ingesting..." : "Save batch and update story"}
                        </button>

                        <button
                          onClick={() => setShowClusterIngestPanel(false)}
                          className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm hover:bg-slate-50"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  )}

                  {tab === "dashboard" && (
                    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                      <h3 className="text-xl font-semibold text-slate-950">
                        Merge into another cluster
                      </h3>
                      <p className="text-sm text-slate-600">
                        Move this cluster’s linked sources and claims into an
                        existing story cluster, then delete this one.
                      </p>

                      <div className="flex flex-col gap-3 md:flex-row">
                        <select
                          value={mergeTargetId}
                          onChange={(e) => setMergeTargetId(e.target.value)}
                          className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                        >
                          <option value="">Select target story cluster</option>
                          {clusterOptions
                            .filter(
                              (cluster) =>
                                cluster.id !== selectedStory.story_cluster.id
                            )
                            .map((cluster) => (
                              <option key={cluster.id} value={cluster.id}>
                                {cluster.title}
                              </option>
                            ))}
                        </select>

                        <button
                          onClick={mergeSelectedCluster}
                          disabled={mergingCluster}
                          className="rounded-full border border-slate-200 bg-white px-4 py-3 text-sm hover:bg-slate-50 disabled:opacity-50"
                        >
                          {mergingCluster ? "Merging..." : "Merge cluster"}
                        </button>
                      </div>
                    </div>
                  )}

                  {tab === "dashboard" &&
                    storyNotes[selectedStory.story_cluster.id] && (
                      <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 shadow-sm">
                        <div className="text-sm font-medium text-red-700">
                          Continue Building Note
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-red-800">
                          {storyNotes[selectedStory.story_cluster.id]}
                        </div>
                      </div>
                    )}

                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="space-y-6">
                      <StoryBackboneView
                        claims={selectedStory.claims}
                        sources={selectedStory.sources}
                      />

                      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                        <h3 className="text-xl font-semibold text-slate-950">
                          Sources attached
                        </h3>

                        <div className="space-y-3">
                          {selectedStory.sources.map((source) => (
                            <SourceCard key={source.id} source={source} />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                        <h3 className="text-xl font-semibold text-slate-950">
                          What’s missing
                        </h3>
                        <div className="space-y-2 text-sm text-slate-700">
                          {buildMissingList(
                            selectedDashboardStory,
                            selectedStory
                          ).map((item, index) => (
                            <div key={index}>• {item}</div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                        <h3 className="text-xl font-semibold text-slate-950">
                          Cluster signals
                        </h3>
                        <div className="space-y-2 text-sm text-slate-700">
                          <div>
                            <strong>Top line:</strong>{" "}
                            {selectedStory.story_cluster.top_line || "—"}
                          </div>
                          <div>
                            <strong>Main issue:</strong>{" "}
                            {selectedStory.story_cluster.main_issue || "—"}
                          </div>
                          <div>
                            <strong>Event type:</strong>{" "}
                            {selectedStory.story_cluster.event_type || "—"}
                          </div>
                          <div>
                            <strong>Location:</strong>{" "}
                            {selectedStory.story_cluster.location || "—"}
                          </div>
                          <div>
                            <strong>Date reference:</strong>{" "}
                            {selectedStory.story_cluster.date_reference || "—"}
                          </div>
                          <div>
                            <strong>Homepage:</strong>{" "}
                            {selectedStory.story_cluster.is_homepage
                              ? "Yes"
                              : "No"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {tab === "publishable" && (
                    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                      <h3 className="text-xl font-semibold text-slate-950">
                        Continue Building
                      </h3>
                      <p className="text-sm text-slate-600">
                        If this is not ready, add a note for what should be
                        improved and move it back to the dashboard.
                      </p>
                      <textarea
                        value={continueNote}
                        onChange={(e) => setContinueNote(e.target.value)}
                        rows={5}
                        placeholder="Leave editorial notes here..."
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                      />
                      <button
                        onClick={continueBuilding}
                        disabled={publishing}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                      >
                        {publishing ? "Updating..." : "Continue Building"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        )}

        {tab === "ingest" && (
          <div className="mx-auto max-w-4xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm space-y-6">
            <div>
              <div className="text-sm text-slate-500">Source ingest</div>
              <h2 className="text-2xl font-semibold text-slate-950">
                Add source to story system
              </h2>
              <p className="mt-1 text-slate-600">
                Save source material, assess evidence strength, extract only
                story-relevant claims, and attach them to an existing or new
                story cluster.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <div className="text-sm font-medium">Source type</div>
                <select
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                >
                  {SOURCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {formatSourceType(type)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <div className="text-sm font-medium">
                  Story cluster (optional)
                </div>
                <select
                  value={storyClusterId}
                  onChange={(e) => setStoryClusterId(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                >
                  <option value="">Create or match automatically</option>
                  {clusterOptions.map((cluster) => (
                    <option key={cluster.id} value={cluster.id}>
                      {cluster.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {showTitleField && !isOctiqCopy && (
              <label className="space-y-2 block">
                <div className="text-sm font-medium">Title</div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                  placeholder="Source title"
                />
              </label>
            )}

            {!isOctiqCopy && (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <div className="text-sm font-medium">
                    Source date (optional)
                  </div>
                  <input
                    type="date"
                    value={sourceDate}
                    onChange={(e) => setSourceDate(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </label>

                <label className="space-y-2">
                  <div className="text-sm font-medium">
                    Source time (optional)
                  </div>
                  <input
                    type="time"
                    value={sourceTime}
                    onChange={(e) => setSourceTime(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </label>
              </div>
            )}

            {!isOctiqCopy && (
              <label className="space-y-2 block">
                <div className="text-sm font-medium">Source URL (optional)</div>
                <input
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                  placeholder="https://..."
                />
              </label>
            )}

            {isSpeechLike && (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <div className="text-sm font-medium">Speaker name</div>
                  <input
                    value={speakerName}
                    onChange={(e) => setSpeakerName(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                    placeholder="Jane Smith"
                  />
                </label>

                <label className="space-y-2">
                  <div className="text-sm font-medium">Speaker entity</div>
                  <input
                    value={speakerEntity}
                    onChange={(e) => setSpeakerEntity(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                    placeholder="Agency or organization"
                  />
                </label>
              </div>
            )}

            {isOfficial && (
              <label className="space-y-2 block">
                <div className="text-sm font-medium">Entity name</div>
                <input
                  value={entityName}
                  onChange={(e) => setEntityName(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                  placeholder="Issuing organization"
                />
              </label>
            )}

            {isSocial && (
              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-2">
                  <div className="text-sm font-medium">Platform</div>
                  <input
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                    placeholder="X"
                  />
                </label>

                <label className="space-y-2">
                  <div className="text-sm font-medium">
                    Account / speaker name
                  </div>
                  <input
                    value={speakerName}
                    onChange={(e) => setSpeakerName(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                    placeholder="Account name"
                  />
                </label>

                <label className="space-y-2">
                  <div className="text-sm font-medium">Handle</div>
                  <input
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                    placeholder="@handle"
                  />
                </label>
              </div>
            )}

            {isNewsArticle && (
              <label className="space-y-2 block">
                <div className="text-sm font-medium">Outlet name</div>
                <input
                  value={outletName}
                  onChange={(e) => setOutletName(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                  placeholder="Outlet name"
                />
              </label>
            )}

            {isDocument && (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <div className="text-sm font-medium">Document type</div>
                  <input
                    value={documentType}
                    onChange={(e) => setDocumentType(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                    placeholder="Court filing"
                  />
                </label>

                <label className="space-y-2">
                  <div className="text-sm font-medium">Issuing body</div>
                  <input
                    value={issuingBody}
                    onChange={(e) => setIssuingBody(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                    placeholder="Issuing body"
                  />
                </label>
              </div>
            )}

            {isDataRelease && (
              <label className="space-y-2 block">
                <div className="text-sm font-medium">Issuing body</div>
                <input
                  value={issuingBody}
                  onChange={(e) => setIssuingBody(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                  placeholder="Issuing body"
                />
              </label>
            )}

            <label className="space-y-2 block">
              <div className="text-sm font-medium">
                {isOctiqCopy ? "Octiq copy" : "Raw text"}
              </div>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={12}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
                placeholder={
                  isOctiqCopy
                    ? "Paste Octiq canonical copy here..."
                    : "Paste full source text here..."
                }
              />
            </label>

            <label className="space-y-2 block">
              <div className="text-sm font-medium">
                Upload file (PDF, JPG, MP4, MP3)
              </div>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.mp4,.mp3"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
              />
            </label>

            <div className="flex gap-3">
              <button
                onClick={handleIngest}
                disabled={ingesting}
                className="rounded-full px-5 py-3 font-medium text-slate-950 disabled:opacity-50"
                style={{ backgroundColor: "#FFA166" }}
              >
                {ingesting ? "Ingesting..." : "Add source"}
              </button>
            </div>

            {ingestResult && (
              <pre className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                {JSON.stringify(ingestResult, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </main>
  );
}