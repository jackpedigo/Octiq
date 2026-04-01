from fastapi import APIRouter
from datetime import datetime
from app.supabase_client import supabase
from app.schemas import SourceCreate
from app.services.ai_extraction import (
    extract_claims_from_source,
    assess_source_strength,
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
            "title": None,
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
        strength = assess_source_strength(created_source)

        supabase.table("sources").update({
            "source_strength_score": strength.get("source_strength_score"),
            "source_strength_label": strength.get("source_strength_label"),
            "is_canonical": strength.get("is_canonical", False),
            "contains_verifiable_info": strength.get("contains_verifiable_info", False),
            "is_primarily_opinion": strength.get("is_primarily_opinion", False),
            "is_direct_evidence": strength.get("is_direct_evidence", False),
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

        supabase.table("claims").insert({
            "source_id": source_id,
            "claim_text": claim.get("claim_text"),
            "normalized_claim_text": claim.get("normalized_claim_text"),
            "support_excerpt": claim.get("support_excerpt"),
            "claim_type": claim.get("claim_type"),
            "claim_order": claim.get("claim_order"),
            "verification_status": verification_status,
            "support_count": 1 if created_source.get("is_canonical") else 0,
            "source_strength_at_ingest": created_source.get("source_strength_score"),
        }).execute()

    return {
        "source_id": source_id,
        "source_type": created_source.get("source_type"),
        "story_cluster_id": created_source.get("story_cluster_id"),
        "claims_created": len(claims),
        "source_strength_score": created_source.get("source_strength_score"),
        "source_strength_label": created_source.get("source_strength_label"),
        "is_canonical": created_source.get("is_canonical"),
    }
