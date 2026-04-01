from pydantic import BaseModel
from typing import Optional, Literal

SourceType = Literal[
    "octiq_copy",
    "official_statement",
    "quote",
    "interview",
    "speech",
    "social_post",
    "document",
    "data_release",
    "news_article",
]

class SourceCreate(BaseModel):
    source_type: str
    raw_text: str

    story_cluster_id: Optional[str] = None
    title: Optional[str] = None

    source_date: Optional[str] = None
    source_time: Optional[str] = None
    source_url: Optional[str] = None

    speaker_name: Optional[str] = None
    speaker_entity: Optional[str] = None
    entity_name: Optional[str] = None
    platform: Optional[str] = None
    handle: Optional[str] = None
    outlet_name: Optional[str] = None
    document_type: Optional[str] = None
    issuing_body: Optional[str] = None

    file_url: Optional[str] = None
    file_type: Optional[str] = None

class UserProfileUpdate(BaseModel):
    name: Optional[str] = None
    state: Optional[str] = None
    interests: Optional[list[str]] = None
    depth_preference: Optional[str] = None
    vocabulary_level: Optional[str] = None
    evidence_visibility: Optional[str] = None
