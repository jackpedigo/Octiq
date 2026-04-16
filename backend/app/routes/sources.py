from fastapi import APIRouter
from datetime import datetime
from app.supabase_client import supabase
from app.schemas import SourceCreate
from app.routes.stories import add_source_to_story_cluster, match_or_create_story_cluster
from app.services.ai_extraction import (
    analyze_source_for_strength_and_story_fields,
    extract_claims_from_source,
)

router = APIRouter()


@router.post("/sources/ingest")
def ingest_source(source: SourceCreate):
    now = datetime.utcnow()

    if source.source_type == "octiq_copy":
        source_payload = {
            "source_type": "octiq_copy",
            "raw_text": source.raw_text,
            "story_cluster_id": source.story_cluster_id,
            "source_date": now.date().isoformat(),
            "source_time": now.strftime("%H:%M:%S"),
            "title": "Octiq Copy",
            "source_url": None,
            "file_url": source.file_url,
            "file_type": source.file_type,
            "is_canonical": True,
            "source_strength_score": 100,
            "source_strength_label": "canonical",
            "contains_verifiable_info": True,
            "is_primarily_opinion": False,
            "is_direct_evidence": True,
        }
    else:
        source_payload = {
            "source_type": source.source_type,
            "story_cluster_id": source.story_cluster_id,
            "title": source.title,
            "raw_text": source.raw_text,
            "source_date": source.source_date or now.date().isoformat(),
            "source_time": source.source_time or now.strftime("%H:%M:%S"),
            "source_url": source.source_url,
            "speaker_name": source.speaker_name,
            "speaker_entity": source.speaker_entity,
            "entity_name": source.entity_name,
            "platform": source.platform,
            "handle": source.handle,
            "outlet_name": source.outlet_name,
            "document_type": source.document_type,
            "issuing_body": source.issuing_body,
            "file_url": source.file_url,
            "file_type": source.file_type,
        }

    insert_response = supabase.table("sources").insert(source_payload).execute()
    created_source = insert_response.data[0]
    source_id = created_source["id"]

    if created_source["source_type"] != "octiq_copy":
        analysis = analyze_source_for_strength_and_story_fields(created_source)

        supabase.table("sources").update({
            "source_strength_score": analysis.get("source_strength_score"),
            "source_strength_label": analysis.get("source_strength_label"),
            "is_canonical": analysis.get("is_canonical", False),
            "contains_verifiable_info": analysis.get("contains_verifiable_info", False),
            "is_primarily_opinion": analysis.get("is_primarily_opinion", False),
            "is_direct_evidence": analysis.get("is_direct_evidence", False),
        }).eq("id", source_id).execute()

        created_source = (
            supabase.table("sources")
            .select("*")
            .eq("id", source_id)
            .execute()
            .data[0]
    )

    claims = extract_claims_from_source(created_source)

    for claim in claims:
        verification_status = (
            "core" if created_source.get("is_canonical") else "attributed_only"
        )
        is_core_claim = (
                True if created_source.get("is_canonical") else False
        )

        supabase.table("claims").insert({
            "source_id": source_id,
            "claim_text": claim.get("claim_text"),
            "normalized_claim_text": claim.get("normalized_claim_text"),
            "support_excerpt": claim.get("support_excerpt"),
            "claim_type": claim.get("claim_type"),
            "claim_order": claim.get("claim_order"),
            "verification_status": verification_status,
            "is_core_claim": is_core_claim,
            "support_count": 1 if created_source.get("is_canonical") else 0,
            "source_strength_at_ingest": created_source.get("source_strength_score"),
})      .execute()

    cluster_result = None

    if source.story_cluster_id:
        cluster_result = add_source_to_story_cluster(source.story_cluster_id, source_id)
    else:
        cluster_result = match_or_create_story_cluster(source_id)

    return {
        "source_id": source_id,
        "source_type": created_source.get("source_type"),
        "story_cluster_id": source.story_cluster_id if source.story_cluster_id else (
            cluster_result.get("story_cluster_id")
            or cluster_result.get("create_result", {}).get("story_cluster_id")
            or cluster_result.get("add_result", {}).get("story_cluster_id")
        ),
        "claims_created": len(claims),
        "source_strength_score": created_source.get("source_strength_score"),
        "source_strength_label": created_source.get("source_strength_label"),
        "is_canonical": created_source.get("is_canonical"),
        "cluster_result": cluster_result,
    }
