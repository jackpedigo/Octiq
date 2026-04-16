from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from fastapi import UploadFile, File, Form
from uuid import uuid4

from app.supabase_client import supabase
from app.services.ai_extraction import (
    analyze_source_for_strength_and_story_fields,
    generate_editorial_structure,
    render_story_from_cluster_and_profile,
)

router = APIRouter()


class StoryEditorialUpdate(BaseModel):
    editorial_status: Optional[str] = None
    is_homepage: Optional[bool] = None

class MergeStoryClusterRequest(BaseModel):
    target_story_cluster_id: str

class StoryEditorialAssetsUpdate(BaseModel):
    image_url: Optional[str] = None
    image_attribution: Optional[str] = None

def build_and_store_editorial_structure(story_cluster_id: str):
    cluster_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("id", story_cluster_id)
        .execute()
    )

    if not cluster_response.data:
        raise HTTPException(status_code=404, detail="Story cluster not found")

    cluster = cluster_response.data[0]

    source_links_response = (
        supabase.table("story_sources")
        .select("source_id")
        .eq("story_cluster_id", story_cluster_id)
        .execute()
    )

    source_ids = [row["source_id"] for row in source_links_response.data] if source_links_response.data else []

    sources = []
    if source_ids:
        sources_response = (
            supabase.table("sources")
            .select("*")
            .in_("id", source_ids)
            .execute()
        )
        sources = sources_response.data or []

    claim_links_response = (
        supabase.table("story_claims")
        .select("claim_id")
        .eq("story_cluster_id", story_cluster_id)
        .execute()
    )

    claim_ids = [row["claim_id"] for row in claim_links_response.data] if claim_links_response.data else []

    claims = []
    if claim_ids:
        claims_response = (
            supabase.table("claims")
            .select("*")
            .in_("id", claim_ids)
            .order("story_order")
            .execute()
        )
        claims = claims_response.data or []

    if not claims:
        return None

    structure = generate_editorial_structure(cluster, claims, sources)

    updated = (
        supabase.table("story_clusters")
        .update({
            "editorial_structure_json": structure,
            "editorial_structure_updated_at": datetime.utcnow().isoformat(),
        })
        .eq("id", story_cluster_id)
        .execute()
    )

    return updated.data[0] if updated.data else None

def create_story_cluster_from_source(source_id: str):
    source_response = (
        supabase.table("sources")
        .select("*")
        .eq("id", source_id)
        .execute()
    )

    if not source_response.data:
        raise HTTPException(status_code=404, detail="Source not found")

    source = source_response.data[0]

    claims_response = (
        supabase.table("claims")
        .select("*")
        .eq("source_id", source_id)
        .order("claim_order")
        .execute()
    )

    if not claims_response.data:
        raise HTTPException(status_code=404, detail="No claims found for this source")

    claims = claims_response.data
    story_fields = analyze_source_for_strength_and_story_fields(source)

    cluster_response = (
        supabase.table("story_clusters")
        .insert(
            {
                "title": story_fields.get("title") or source.get("title") or "Untitled story",
                "summary": story_fields.get("summary_seed"),
                "main_issue": story_fields.get("main_issue"),
                "event_type": story_fields.get("event_type"),
                "location": story_fields.get("location"),
                "date_reference": story_fields.get("date_reference"),
                "summary_seed": story_fields.get("summary_seed"),
                "interest_tags": story_fields.get("interest_tags", []),
                "status": "draft",
                "editorial_status": "draft",
                "content_updated_at": datetime.utcnow().isoformat(),
                "top_line": story_fields.get("summary_seed"),
            }
        )
        .execute()
    )

    story_cluster = cluster_response.data[0]
    story_cluster_id = story_cluster["id"]

    supabase.table("story_sources").insert(
        {
            "story_cluster_id": story_cluster_id,
            "source_id": source_id,
        }
    ).execute()

    core_claim_texts = {
        c.strip().lower()
        for c in story_fields.get("core_claims", [])
        if c and c.strip()
    }

    linked_claims = []
    story_order = 1

    for claim in claims:
        comparison_text = (
            claim.get("normalized_claim_text")
            or claim.get("claim_text")
            or ""
        ).strip().lower()

        is_core = comparison_text in core_claim_texts

        update_payload = {
            "is_core_claim": is_core,
            "verification_status": "core"
            if (is_core or claim.get("verification_status") == "core")
            else claim.get("verification_status") or "attributed_only",
            "story_order": story_order,
        }

        supabase.table("claims").update(update_payload).eq("id", claim["id"]).execute()

        link_response = (
            supabase.table("story_claims")
            .insert(
                {
                    "story_cluster_id": story_cluster_id,
                    "claim_id": claim["id"],
                    "is_core_claim": is_core,
                }
            )
            .execute()
        )

        linked_claims.append(link_response.data[0])
        story_order += 1

    build_and_store_editorial_structure(story_cluster_id)

    return {
        "story_cluster_id": story_cluster_id,
        "title": story_cluster["title"],
        "main_issue": story_cluster["main_issue"],
        "event_type": story_cluster["event_type"],
        "location": story_cluster["location"],
        "date_reference": story_cluster["date_reference"],
        "claims_linked": len(linked_claims),
        "core_claims_requested": story_fields.get("core_claims", []),
        "content_updated_at": story_cluster.get("content_updated_at")
    }

def refresh_story_cluster_metadata(story_cluster_id: str):
    source_links_response = (
        supabase.table("story_sources")
        .select("source_id")
        .eq("story_cluster_id", story_cluster_id)
        .execute()
    )

    source_ids = [row["source_id"] for row in source_links_response.data] if source_links_response.data else []
    if not source_ids:
        return None

    sources_response = (
        supabase.table("sources")
        .select("*")
        .in_("id", source_ids)
        .execute()
    )

    sources = sources_response.data or []
    if not sources:
        return None

    canonical_source = next(
        (s for s in sources if s.get("source_type") == "octiq_copy"),
        sources[0]
    )

    story_fields = analyze_source_for_strength_and_story_fields(canonical_source)

    updated = (
        supabase.table("story_clusters")
        .update({
            "title": story_fields.get("title") or canonical_source.get("title") or "Untitled story",
            "top_line": story_fields.get("summary_seed") or story_fields.get("title") or canonical_source.get("title") or "Untitled story",
            "main_issue": story_fields.get("main_issue"),
            "event_type": story_fields.get("event_type"),
            "location": story_fields.get("location"),
            "date_reference": story_fields.get("date_reference"),
            "summary_seed": story_fields.get("summary_seed"),
            "interest_tags": story_fields.get("interest_tags", []),
            "content_updated_at": datetime.utcnow().isoformat(),
        })
        .eq("id", story_cluster_id)
        .execute()
    )

    return updated.data[0] if updated.data else None

def add_source_to_story_cluster(story_cluster_id: str, source_id: str):
    cluster_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("id", story_cluster_id)
        .execute()
    )

    if not cluster_response.data:
        raise HTTPException(status_code=404, detail="Story cluster not found")

    source_response = (
        supabase.table("sources")
        .select("*")
        .eq("id", source_id)
        .execute()
    )

    if not source_response.data:
        raise HTTPException(status_code=404, detail="Source not found")

    source_claims_response = (
        supabase.table("claims")
        .select("*")
        .eq("source_id", source_id)
        .order("claim_order")
        .execute()
    )

    if not source_claims_response.data:
        raise HTTPException(status_code=404, detail="No claims found for this source")

    source_claims = source_claims_response.data

    existing_source_link = (
        supabase.table("story_sources")
        .select("*")
        .eq("story_cluster_id", story_cluster_id)
        .eq("source_id", source_id)
        .execute()
    )

    if not existing_source_link.data:
        supabase.table("story_sources").insert(
            {
                "story_cluster_id": story_cluster_id,
                "source_id": source_id,
            }
        ).execute()

    existing_links_response = (
        supabase.table("story_claims")
        .select("claim_id")
        .eq("story_cluster_id", story_cluster_id)
        .execute()
    )

    existing_claim_ids = (
        {row["claim_id"] for row in existing_links_response.data}
        if existing_links_response.data
        else set()
    )

    all_claim_links_response = (
        supabase.table("story_claims")
        .select("claim_id")
        .eq("story_cluster_id", story_cluster_id)
        .execute()
    )

    current_claim_ids = (
        [row["claim_id"] for row in all_claim_links_response.data]
        if all_claim_links_response.data
        else []
    )

    max_story_order = 0
    if current_claim_ids:
        current_claims_response = (
            supabase.table("claims")
            .select("id,story_order")
            .in_("id", current_claim_ids)
            .execute()
        )
        current_claims = current_claims_response.data or []
        if current_claims:
            max_story_order = max((c.get("story_order") or 0) for c in current_claims)

    added_count = 0
    skipped_count = 0
    next_story_order = max_story_order + 1

    for claim in source_claims:
        if claim["id"] in existing_claim_ids:
            skipped_count += 1
            continue

        supabase.table("story_claims").insert(
            {
                "story_cluster_id": story_cluster_id,
                "claim_id": claim["id"],
                "is_core_claim": claim.get("is_core_claim", False),
            }
        ).execute()

        supabase.table("claims").update(
            {
                "story_order": next_story_order,
            }
        ).eq("id", claim["id"]).execute()

        next_story_order += 1
        added_count += 1

    supabase.table("story_clusters").update(
        {
            "content_updated_at": datetime.utcnow().isoformat(),
        }
    ).eq("id", story_cluster_id).execute()

    updated_cluster = None
    if added_count > 0:
        updated_cluster = refresh_story_cluster_metadata(story_cluster_id)

    structure_updated = False
    if added_count > 0:
        build_and_store_editorial_structure(story_cluster_id)
        structure_updated = True

    return {
        "story_cluster_id": story_cluster_id,
        "source_id": source_id,
        "claims_found_in_source": len(source_claims),
        "claims_added_to_cluster": added_count,
        "claims_skipped": skipped_count,
        "updated_cluster": updated_cluster,
        "structure_updated": structure_updated,
    }

def match_or_create_story_cluster(source_id: str):
    source_response = (
        supabase.table("sources")
        .select("*")
        .eq("id", source_id)
        .execute()
    )

    if not source_response.data:
        raise HTTPException(status_code=404, detail="Source not found")

    source = source_response.data[0]
    story_fields = analyze_source_for_strength_and_story_fields(source)

    main_issue = (story_fields.get("main_issue") or "").strip().lower()
    event_type = (story_fields.get("event_type") or "").strip().lower()
    location = (story_fields.get("location") or "").strip().lower()

    clusters_response = supabase.table("story_clusters").select("*").execute()
    clusters = clusters_response.data or []

    best_match = None
    best_score = -1

    for cluster in clusters:
        score = 0

        cluster_issue = (cluster.get("main_issue") or "").strip().lower()
        cluster_event_type = (cluster.get("event_type") or "").strip().lower()
        cluster_location = (cluster.get("location") or "").strip().lower()

        if main_issue and cluster_issue and main_issue == cluster_issue:
            score += 3

        if event_type and cluster_event_type and event_type == cluster_event_type:
            score += 2

        if location and cluster_location and location == cluster_location:
            score += 2

        if score > best_score:
            best_score = score
            best_match = cluster

    if best_match and best_score >= 4:
        add_result = add_source_to_story_cluster(best_match["id"], source_id)
        return {
            "action": "matched_existing_cluster",
            "match_score": best_score,
            "story_cluster_id": best_match["id"],
            "cluster_title": best_match["title"],
            "story_fields": story_fields,
            "add_result": add_result,
        }

    create_result = create_story_cluster_from_source(source_id)
    return {
        "action": "created_new_cluster",
        "match_score": best_score,
        "story_fields": story_fields,
        "create_result": create_result,
    }


@router.delete("/stories/{story_cluster_id}")
def delete_story_cluster(story_cluster_id: str):
    cluster_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("id", story_cluster_id)
        .execute()
    )

    if not cluster_response.data:
        raise HTTPException(status_code=404, detail="Story cluster not found")

    supabase.table("story_claims").delete().eq("story_cluster_id", story_cluster_id).execute()
    supabase.table("story_sources").delete().eq("story_cluster_id", story_cluster_id).execute()
    supabase.table("story_renders").delete().eq("story_cluster_id", story_cluster_id).execute()
    supabase.table("sources").update({"story_cluster_id": None}).eq("story_cluster_id", story_cluster_id).execute()
    supabase.table("story_clusters").delete().eq("id", story_cluster_id).execute()

    return {
        "message": "Story cluster deleted",
        "story_cluster_id": story_cluster_id,
    }

@router.post("/stories/{story_cluster_id}/render/{user_profile_id}")
def render_story_for_user(story_cluster_id: str, user_profile_id: str):
    cluster_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("id", story_cluster_id)
        .execute()
    )

    if not cluster_response.data:
        raise HTTPException(status_code=404, detail="Story cluster not found")

    cluster = cluster_response.data[0]

    profile_response = (
        supabase.table("user_profiles")
        .select("*")
        .eq("id", user_profile_id)
        .execute()
    )

    if not profile_response.data:
        raise HTTPException(status_code=404, detail="User profile not found")

    profile = profile_response.data[0]

    claim_links_response = (
        supabase.table("story_claims")
        .select("claim_id")
        .eq("story_cluster_id", story_cluster_id)
        .execute()
    )

    if not claim_links_response.data:
        raise HTTPException(
            status_code=404,
            detail="No claims linked to this story cluster",
        )

    claim_ids = [row["claim_id"] for row in claim_links_response.data]

    claims_response = (
        supabase.table("claims")
        .select("*")
        .in_("id", claim_ids)
        .order("story_order")
        .execute()
    )

    claims = claims_response.data or []
    rendered = render_story_from_cluster_and_profile(cluster, claims, profile)

    render_response = (
        supabase.table("story_renders")
        .insert(
            {
                "story_cluster_id": story_cluster_id,
                "user_profile_id": user_profile_id,
                "headline": rendered["headline"],
                "summary": rendered["summary"],
                "body": rendered["body"],
                "why_it_matters": rendered["why_it_matters"],
                "highlight_targets_json": rendered.get("highlight_targets", []),
                "render_mode": "personalized_article"
            }
        )
        .execute()
        
    )

    return {
        "story_cluster_id": story_cluster_id,
        "user_profile_id": user_profile_id,
        "render_id": render_response.data[0]["id"],
        "headline": rendered["headline"],
        "summary": rendered["summary"],
        "body": rendered["body"],
        "why_it_matters": rendered["why_it_matters"],
    }

@router.post("/stories/{story_cluster_id}/hero-image")
async def upload_story_hero_image(
    story_cluster_id: str,
    file: UploadFile = File(...),
    attribution: str = Form("")
):
    cluster_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("id", story_cluster_id)
        .execute()
    )

    if not cluster_response.data:
        raise HTTPException(status_code=404, detail="Story cluster not found")

    allowed_types = {"image/jpeg", "image/png"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only JPG and PNG images are allowed")

    extension = ".jpg" if file.content_type == "image/jpeg" else ".png"
    file_path = f"story-hero-images/{story_cluster_id}/{uuid4()}{extension}"

    file_bytes = await file.read()

    upload_response = supabase.storage.from_("images").upload(
        file_path,
        file_bytes,
        {"content-type": file.content_type}
    )

    # some supabase clients return None on success, so just fetch public URL after upload
    public_url = supabase.storage.from_("images").get_public_url(file_path)

    updated = (
        supabase.table("story_clusters")
        .update({
            "image_url": public_url,
            "image_attribution": attribution or None,
            "content_updated_at": datetime.utcnow().isoformat(),
        })
        .eq("id", story_cluster_id)
        .execute()
    )

    return {
        "message": "Hero image uploaded",
        "image_url": public_url,
        "image_attribution": attribution,
        "story_cluster": updated.data[0] if updated.data else None,
    }

@router.post("/stories/{story_cluster_id}/merge")
def merge_story_cluster(story_cluster_id: str, payload: MergeStoryClusterRequest):
    source_cluster_id = story_cluster_id
    target_cluster_id = payload.target_story_cluster_id

    if source_cluster_id == target_cluster_id:
        raise HTTPException(status_code=400, detail="Source and target cluster cannot be the same")

    source_cluster_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("id", source_cluster_id)
        .execute()
    )
    if not source_cluster_response.data:
        raise HTTPException(status_code=404, detail="Source story cluster not found")

    target_cluster_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("id", target_cluster_id)
        .execute()
    )
    if not target_cluster_response.data:
        raise HTTPException(status_code=404, detail="Target story cluster not found")

    source_links_response = (
        supabase.table("story_sources")
        .select("*")
        .eq("story_cluster_id", source_cluster_id)
        .execute()
    )
    source_links = source_links_response.data or []

    existing_target_source_links_response = (
        supabase.table("story_sources")
        .select("source_id")
        .eq("story_cluster_id", target_cluster_id)
        .execute()
    )
    existing_target_source_ids = {
        row["source_id"] for row in (existing_target_source_links_response.data or [])
    }

    moved_sources = 0
    for link in source_links:
        if link["source_id"] not in existing_target_source_ids:
            supabase.table("story_sources").insert({
                "story_cluster_id": target_cluster_id,
                "source_id": link["source_id"],
            }).execute()
            moved_sources += 1

        supabase.table("sources").update({
            "story_cluster_id": target_cluster_id
        }).eq("id", link["source_id"]).execute()

    source_claim_links_response = (
        supabase.table("story_claims")
        .select("*")
        .eq("story_cluster_id", source_cluster_id)
        .execute()
    )
    source_claim_links = source_claim_links_response.data or []

    existing_target_claim_links_response = (
        supabase.table("story_claims")
        .select("claim_id")
        .eq("story_cluster_id", target_cluster_id)
        .execute()
    )
    existing_target_claim_ids = {
        row["claim_id"] for row in (existing_target_claim_links_response.data or [])
    }

    moved_claims = 0
    for link in source_claim_links:
        if link["claim_id"] not in existing_target_claim_ids:
            supabase.table("story_claims").insert({
                "story_cluster_id": target_cluster_id,
                "claim_id": link["claim_id"],
                "is_core_claim": link.get("is_core_claim", False),
            }).execute()
            moved_claims += 1

    supabase.table("story_claims").delete().eq("story_cluster_id", source_cluster_id).execute()
    supabase.table("story_sources").delete().eq("story_cluster_id", source_cluster_id).execute()
    supabase.table("story_renders").delete().eq("story_cluster_id", source_cluster_id).execute()
    supabase.table("story_clusters").delete().eq("id", source_cluster_id).execute()

    supabase.table("story_clusters").update({
        "content_updated_at": datetime.utcnow().isoformat()
    }).eq("id", target_cluster_id).execute()

    return {
        "message": "Story cluster merged",
        "deleted_story_cluster_id": source_cluster_id,
        "target_story_cluster_id": target_cluster_id,
        "sources_moved": moved_sources,
        "claims_moved": moved_claims,
    }

@router.get("/stories/{story_cluster_id}")
def get_story(story_cluster_id: str, user_profile_id: str | None = None):
    cluster_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("id", story_cluster_id)
        .execute()
    )

    if not cluster_response.data:
        raise HTTPException(status_code=404, detail="Story cluster not found")

    cluster = cluster_response.data[0]

    sources_response = (
        supabase.table("story_sources")
        .select("source_id")
        .eq("story_cluster_id", story_cluster_id)
        .execute()
    )

    source_ids = (
        [s["source_id"] for s in sources_response.data]
        if sources_response.data
        else []
    )

    sources = []
    if source_ids:
        sources_result = (
            supabase.table("sources")
            .select(
                "id,title,source_type,source_url,source_date,source_time,"
                "source_strength_score,source_strength_label,is_canonical,"
                "contains_verifiable_info,is_primarily_opinion,is_direct_evidence,"
                "file_url,file_type"
            )
            .in_("id", source_ids)
            .execute()
        )
        sources = sources_result.data or []

    claim_links = (
        supabase.table("story_claims")
        .select("claim_id,is_core_claim")
        .eq("story_cluster_id", story_cluster_id)
        .execute()
    )

    claim_ids = [c["claim_id"] for c in claim_links.data] if claim_links.data else []

    claims = []

    if claim_ids:
        claims_result = (
            supabase.table("claims")
            .select(
                "id,source_id,claim_text,normalized_claim_text,support_excerpt,"
                "is_core_claim,verification_status,claim_type,support_count,story_order"
            )
            .in_("id", claim_ids)
            .order("story_order")
            .execute()
        )

        claims = claims_result.data or []

    claims = [
        c for c in claims
        if c.get("verification_status") in {"supported", "core"}
        or c.get("is_core_claim")
    ]

    claims = sorted(claims, key=lambda c: c.get("story_order") or 999)

    render_query = (
        supabase.table("story_renders")
        .select("*")
        .eq("story_cluster_id", story_cluster_id)
    )

    if user_profile_id:
        render_query = render_query.eq("user_profile_id", user_profile_id)

    render_response = (
        render_query
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    latest_render = render_response.data[0] if render_response.data else None

    return {
        "story_cluster": cluster,
        "sources": sources,
        "claims": claims,
        "editorial_structure": cluster.get("editorial_structure_json"),
        "latest_render": latest_render,
    }


@router.patch("/stories/{story_cluster_id}/publish")
def publish_story(
    story_cluster_id: str,
    status: str = "publishable",
    is_homepage: bool = False,
):
    if status not in ["draft", "publishable", "published"]:
        raise HTTPException(status_code=400, detail="Invalid status")

    supabase.table("story_clusters").update(
        {
            "editorial_status": status,
            "is_homepage": is_homepage,
        }
    ).eq("id", story_cluster_id).execute()

    return {
        "story_cluster_id": story_cluster_id,
        "editorial_status": status,
        "is_homepage": is_homepage,
    }


@router.patch("/stories/{story_cluster_id}/editorial")
def update_story_editorial(story_cluster_id: str, payload: StoryEditorialUpdate):
    cluster_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("id", story_cluster_id)
        .execute()
    )

    if not cluster_response.data:
        raise HTTPException(status_code=404, detail="Story cluster not found")

    updates = {}

    if payload.editorial_status is not None:
        allowed_statuses = {"draft", "publishable", "published"}
        if payload.editorial_status not in allowed_statuses:
            raise HTTPException(status_code=400, detail="Invalid editorial_status")
        updates["editorial_status"] = payload.editorial_status

    if payload.is_homepage is not None:
        updates["is_homepage"] = payload.is_homepage

    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided to update")

    updated = (
        supabase.table("story_clusters")
        .update(updates)
        .eq("id", story_cluster_id)
        .execute()
    )

    return {
        "message": "Story editorial fields updated",
        "story_cluster": updated.data[0],
    }


@router.get("/homepage/{user_profile_id}")
def get_homepage(user_profile_id: str):
    profile_response = (
        supabase.table("user_profiles")
        .select("*")
        .eq("id", user_profile_id)
        .execute()
    )

    if not profile_response.data:
        raise HTTPException(status_code=404, detail="User not found")

    profile = profile_response.data[0]

    interests = profile.get("interests") or []
    if isinstance(interests, str):
        interests = [interests]

    user_state = (profile.get("state") or "").lower()

    stories_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("editorial_status", "published")
        .eq("is_homepage", True)
        .execute()
    )

    stories = stories_response.data or []

    def score_story(story):
        score = 0
        issue = (story.get("main_issue") or "").lower()
        location = (story.get("location") or "").lower()
        story_tags = story.get("interest_tags") or []

        if user_state and user_state in location:
            score += 2

        for interest in interests:
            if interest.lower() in [tag.lower() for tag in story_tags]:
                score += 2
            elif interest.lower() in issue:
                score += 1

        return score

    sorted_stories = sorted(stories, key=score_story, reverse=True)
    results = []

    for story in sorted_stories:
        render_response = (
            supabase.table("story_renders")
            .select("headline,summary,created_at")
            .eq("story_cluster_id", story["id"])
            .eq("user_profile_id", user_profile_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        latest_render = render_response.data[0] if render_response.data else None

        results.append(
            {
                "id": story["id"],
                "title": story.get("title"),
                "main_issue": story.get("main_issue"),
                "location": story.get("location"),
                "summary_seed": story.get("summary_seed"),
                "date_reference": story.get("date_reference"),
                "image_url": story.get("image_url"),
                "latest_render": {
                    "headline": latest_render.get("headline"),
                    "summary": latest_render.get("summary"),
                }
                if latest_render
                else None,
            }
        )

    return {
        "user_interests": interests,
        "user_state": profile.get("state"),
        "stories": results,
    }


@router.post("/homepage/render-sync/{user_profile_id}")
def render_sync_homepage(user_profile_id: str):
    profile_response = (
        supabase.table("user_profiles")
        .select("*")
        .eq("id", user_profile_id)
        .execute()
    )

    if not profile_response.data:
        raise HTTPException(status_code=404, detail="User not found")

    profile = profile_response.data[0]

    stories_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("editorial_status", "published")
        .eq("is_homepage", True)
        .execute()
    )

    stories = stories_response.data or []
    rendered_count = 0

    for story in stories:
        story_id = story["id"]

        render_response = (
            supabase.table("story_renders")
            .select("*")
            .eq("story_cluster_id", story_id)
            .eq("user_profile_id", user_profile_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        latest_render = render_response.data[0] if render_response.data else None
        cluster_updated_at = story.get("content_updated_at")
        render_created_at = latest_render.get("created_at") if latest_render else None

        should_render = False

        if not latest_render:
            should_render = True
        elif cluster_updated_at and render_created_at and cluster_updated_at > render_created_at:
            should_render = True

        if should_render:
            claim_links = (
                supabase.table("story_claims")
                .select("claim_id")
                .eq("story_cluster_id", story_id)
                .execute()
            )

            claim_ids = [c["claim_id"] for c in claim_links.data] if claim_links.data else []

            claims = []
            if claim_ids:
                claims_response = (
                    supabase.table("claims")
                    .select("*")
                    .in_("id", claim_ids)
                    .order("story_order")
                    .execute()
                )
                claims = claims_response.data or []

            rendered = render_story_from_cluster_and_profile(story, claims, profile)

            supabase.table("story_renders").insert(
                {
                    "story_cluster_id": story_id,
                    "user_profile_id": user_profile_id,
                    "headline": rendered["headline"],
                    "summary": rendered["summary"],
                    "body": rendered["body"],
                    "why_it_matters": rendered["why_it_matters"],
                    "render_mode": "personalized_article",
                }
            ).execute()

            rendered_count += 1

    return {
        "message": "Render sync complete",
        "stories_checked": len(stories),
        "stories_rendered": rendered_count,
    }


@router.get("/editorial/dashboard")
def get_editorial_dashboard():
    stories_response = (
        supabase.table("story_clusters")
        .select("*")
        .in_("editorial_status", ["draft", "published", "publishable"])
        .order("created_at", desc=True)
        .execute()
    )

    stories = stories_response.data or []
    results = []

    for story in stories:
        story_id = story["id"]

        sources_response = (
            supabase.table("story_sources")
            .select("source_id")
            .eq("story_cluster_id", story_id)
            .execute()
        )
        source_ids = (
            [row["source_id"] for row in sources_response.data]
            if sources_response.data
            else []
        )

        sources = []
        if source_ids:
            source_result = (
                supabase.table("sources")
                .select(
                    "id,title,source_type,source_strength_score,source_strength_label,"
                    "is_canonical,contains_verifiable_info,is_primarily_opinion,"
                    "is_direct_evidence"
                )
                .in_("id", source_ids)
                .execute()
            )
            sources = source_result.data or []

        claim_links_response = (
            supabase.table("story_claims")
            .select("claim_id,is_core_claim")
            .eq("story_cluster_id", story_id)
            .execute()
        )
        claim_ids = (
            [row["claim_id"] for row in claim_links_response.data]
            if claim_links_response.data
            else []
        )

        claims = []
        if claim_ids:
            claims_result = (
                supabase.table("claims")
                .select("id,is_core_claim,verification_status")
                .in_("id", claim_ids)
                .execute()
            )
            claims = claims_result.data or []

        source_count = len(sources)
        claim_count = len(claims)
        canonical_claim_count = len([c for c in claims if c.get("is_core_claim")])

        supported_claim_count = len(
            [c for c in claims if c.get("verification_status") in {"supported", "core"}]
        )
        core_claim_count = len(
            [c for c in claims if c.get("verification_status") == "core"]
        )
        strong_source_count = len(
            [s for s in sources if (s.get("source_strength_score") or 0) >= 75]
        )
        canonical_source_count = len([s for s in sources if s.get("is_canonical")])

        strength_score = (
            canonical_source_count * 28
            + core_claim_count * 16
            + supported_claim_count * 8
            + strong_source_count * 6
            + min(source_count, 5) * 2
        )

        if canonical_source_count == 0:
            strength_score = min(strength_score, 58)
        elif canonical_source_count == 1:
            strength_score = min(strength_score, 74)
        elif canonical_source_count == 2:
            strength_score = min(strength_score, 84)

        if (
            canonical_source_count >= 2
            and core_claim_count >= 3
            and strong_source_count >= 3
        ):
            strength_score = max(strength_score, 90)

        strength_score = min(100, strength_score)

        latest_render_response = (
            supabase.table("story_renders")
            .select("*")
            .eq("story_cluster_id", story_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        latest_render = (
            latest_render_response.data[0] if latest_render_response.data else None
        )

        results.append(
            {
                "story_cluster": story,
                "source_count": source_count,
                "claim_count": claim_count,
                "canonical_claim_count": canonical_claim_count,
                "strength_score": strength_score,
                "latest_render": latest_render,
            }
        )

    return {"stories": results}


@router.post("/stories/{story_cluster_id}/render-if-needed/{user_profile_id}")
def render_if_needed(story_cluster_id: str, user_profile_id: str):
    cluster_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("id", story_cluster_id)
        .execute()
    )

    if not cluster_response.data:
        raise HTTPException(status_code=404, detail="Story cluster not found")

    cluster = cluster_response.data[0]

    latest_response = (
        supabase.table("story_renders")
        .select("*")
        .eq("story_cluster_id", story_cluster_id)
        .eq("user_profile_id", user_profile_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    latest_render = latest_response.data[0] if latest_response.data else None

    if latest_render and cluster.get("content_updated_at") <= latest_render.get("created_at"):
        return latest_render

    claim_links_response = (
        supabase.table("story_claims")
        .select("claim_id")
        .eq("story_cluster_id", story_cluster_id)
        .execute()
    )

    claim_ids = (
        [row["claim_id"] for row in claim_links_response.data]
        if claim_links_response.data
        else []
    )

    claims = []
    if claim_ids:
        claims_response = (
            supabase.table("claims")
            .select("*")
            .in_("id", claim_ids)
            .order("story_order")
            .execute()
        )
        claims = claims_response.data or []

    profile_response = (
        supabase.table("user_profiles")
        .select("*")
        .eq("id", user_profile_id)
        .execute()
    )

    if not profile_response.data:
        raise HTTPException(status_code=404, detail="User profile not found")

    profile = supabase.table("user_profiles").select("*").eq("id", user_profile_id).execute().data[0]

    if not cluster.get("editorial_structure_json"):
        build_and_store_editorial_structure(story_cluster_id)

        cluster = (
            supabase.table("story_clusters")
            .select("*")
            .eq("id", story_cluster_id)
            .execute()
            .data[0]
        )

    rendered = render_story_from_cluster_and_profile(cluster, claims, profile)
    insert = (
        supabase.table("story_renders")
        .insert(
            {
                "story_cluster_id": story_cluster_id,
                "user_profile_id": user_profile_id,
                "headline": rendered["headline"],
                "summary": rendered["summary"],
                "body": rendered["body"],
                "why_it_matters": rendered["why_it_matters"],
                "highlight_targets_json": rendered.get("highlight_targets", []),
            }
        )
        .execute()
    )

    return insert.data[0]

@router.patch("/stories/{story_cluster_id}/editorial-assets")
def update_story_editorial_assets(story_cluster_id: str, payload: StoryEditorialAssetsUpdate):
    cluster_response = (
        supabase.table("story_clusters")
        .select("*")
        .eq("id", story_cluster_id)
        .execute()
    )

    if not cluster_response.data:
        raise HTTPException(status_code=404, detail="Story cluster not found")

    updates = {}

    if payload.image_url is not None:
        updates["image_url"] = payload.image_url

    if payload.image_attribution is not None:
        updates["image_attribution"] = payload.image_attribution

    if not updates:
        raise HTTPException(status_code=400, detail="No asset fields provided")

    updates["content_updated_at"] = datetime.utcnow().isoformat()

    updated = (
        supabase.table("story_clusters")
        .update(updates)
        .eq("id", story_cluster_id)
        .execute()
    )

    return {
        "message": "Story editorial assets updated",
        "story_cluster": updated.data[0],
    }

@router.post("/stories/{story_cluster_id}/hero-image")
async def upload_hero_image(story_cluster_id: str, file: UploadFile, attribution: str):
    path = f"story-images/{story_cluster_id}/{file.filename}"

    supabase.storage.from_("images").upload(path, file.file)

    public_url = supabase.storage.from_("images").get_public_url(path)

    supabase.table("story_clusters").update({
        "image_url": public_url,
        "image_attribution": attribution,
        "content_updated_at": datetime.utcnow().isoformat()
    }).eq("id", story_cluster_id).execute()

    return {"image_url": public_url}
