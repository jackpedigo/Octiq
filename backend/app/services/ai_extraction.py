import json
from fastapi import HTTPException
from app.openai_client import client

ALLOWED_INTEREST_TAGS = [
    "politics","economy","education","public_safety","health","environment",
    "technology","housing","transportation","labor","courts","immigration",
    "international","climate","business","media","culture","sports"
]


def _clean(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = text.replace("```json", "").replace("```", "").strip()
    return text


# -----------------------------------
# SOURCE STRENGTH ASSESSMENT
# -----------------------------------

def assess_source_strength(source: dict):
    prompt = f"""
Evaluate the strength of this source.

Return JSON:

{{
 "source_strength_score": 0-100,
 "source_strength_label": "weak|moderate|strong|canonical",
 "contains_verifiable_info": true/false,
 "is_primarily_opinion": true/false,
 "is_direct_evidence": true/false
}}

Rules:
- Official docs = strong
- First-hand data = strong
- Social posts = weak unless evidence
- Opinion = weak
- Octiq copy = canonical

Text:
{source["raw_text"]}
"""

    response = client.responses.create(
        model="gpt-5-mini",
        input=prompt
    )

    try:
        return json.loads(_clean(response.output_text))
    except:
        raise HTTPException(500, "Source assessment failed")


# -----------------------------------
# CLAIM EXTRACTION
# -----------------------------------

def extract_claims_from_source(source: dict):
    prompt = f"""
Extract only the meaningful, story-relevant claims from this source.

Return JSON:

{{
  "claims": [
    {{
      "claim_text": "source-grounded claim text",
      "normalized_claim_text": "clean editorial version of the claim",
      "support_excerpt": "exact excerpt from source",
      "claim_type": "quote|reported_fact|statement|internal_copy|data_point",
      "claim_order": 1
    }}
  ]
}}

Rules:
- No minimum and no maximum number of claims.
- Extract only claims that matter to the story.
- If the source contains little or nothing materially useful to the story, return zero claims.
- Claims should reflect what was said or indicated.
- normalized_claim_text should be rewritten in clean editorial language and should not copy source phrasing.
- support_excerpt should remain exact.
- If a direct quote is essential, keep the quote exact in support_excerpt and classify claim_type appropriately.
- Do not include fluff, scene-setting, or generic language.

Source type:
{source.get("source_type")}

Source title:
{source.get("title")}

Source text:
{source.get("raw_text")}
"""

    response = client.responses.create(
        model="gpt-5-mini",
        input=prompt
    )

    try:
        parsed = json.loads(_clean(response.output_text))
    except:
        raise HTTPException(500, "Claim extraction failed")

    claims = parsed.get("claims", [])
    unique_claims = []
    seen = set()

    for claim in claims:
        key = (claim.get("normalized_claim_text") or claim.get("claim_text") or "").strip().lower()
        if key and key not in seen:
            seen.add(key)
            unique_claims.append(claim)

    return unique_claims

# -----------------------------------
# RENDER STORY
# -----------------------------------

def extract_story_fields_from_source(source: dict):
    prompt = f"""
Extract the major story-defining fields from this source.

Return JSON in exactly this shape:

{{
  "title": "short event title",
  "main_issue": "main issue/topic",
  "event_type": "type of event",
  "location": "city/state/country or null",
  "date_reference": "date or time reference or null",
  "summary_seed": "1-2 sentence summary",
  "interest_tags": ["politics", "public_safety"],
  "core_claims": [
    "claim 1",
    "claim 2"
  ]
}}

Rules:
- Keep it concise.
- No invented facts.
- interest_tags must only come from:
  {", ".join(ALLOWED_INTEREST_TAGS)}
- core_claims should reflect the strongest story-relevant claims.
- Rewrite in normalized editorial language, not copied phrasing.

Source type:
{source.get("source_type")}

Source title:
{source.get("title")}

Source text:
{source.get("raw_text")}
"""

    response = client.responses.create(
        model="gpt-5-mini",
        input=prompt
    )

    try:
        parsed = json.loads(_clean(response.output_text))
    except:
        raise HTTPException(500, "Story field extraction failed")

    parsed["interest_tags"] = [
        tag for tag in parsed.get("interest_tags", [])
        if tag in ALLOWED_INTEREST_TAGS
    ]

    return parsed

def assess_source_strength(source: dict):
    if source.get("source_type") == "octiq_copy":
        return {
            "source_strength_score": 100,
            "source_strength_label": "canonical",
            "is_canonical": True,
            "contains_verifiable_info": True,
            "is_primarily_opinion": False,
            "is_direct_evidence": True,
        }

    prompt = f"""
Evaluate the strength of this source.

Return JSON:

{{
  "source_strength_score": 0,
  "source_strength_label": "weak",
  "is_canonical": false,
  "contains_verifiable_info": false,
  "is_primarily_opinion": false,
  "is_direct_evidence": false
}}

Rules:
- Evaluate based on factuality, verifiability, directness, and usefulness to a reported story.
- Opinion-heavy material should score lower.
- Official statements, documents, data releases, and direct evidence can score higher.
- Social posts and quotes can be important but should not automatically be treated as verified fact.

Source type:
{source.get("source_type")}

Source title:
{source.get("title")}

Source text:
{source.get("raw_text")}
"""

    response = client.responses.create(
        model="gpt-5-mini",
        input=prompt
    )

    try:
        return json.loads(_clean(response.output_text))
    except:
        raise HTTPException(500, "Source assessment failed")

def build_render_instructions(profile: dict) -> str:
    depth = profile.get("depth_preference", "standard")
    vocab = profile.get("vocabulary_level", "standard")
    evidence = profile.get("evidence_visibility", "medium")
    interests = profile.get("interests", [])

    instructions = []

    if depth == "quick":
        instructions.append("Keep the article concise with minimal context.")
    elif depth == "deep":
        instructions.append("Provide deeper context and connect claims more fully.")
    else:
        instructions.append("Use standard article depth appropriate for a general reader.")

    if vocab == "simple":
        instructions.append("Use plain, accessible language.")
    elif vocab == "expert":
        instructions.append("Use more precise and technical language when appropriate.")
    else:
        instructions.append("Use standard news language.")

    if evidence == "low":
        instructions.append("Do not emphasize sourcing explicitly.")
    elif evidence == "high":
        instructions.append("Make sourcing more visible when supported by claims.")
    else:
        instructions.append("Lightly reference sourcing where natural.")

    if interests:
        instructions.append(
            f"Emphasize angles relevant to: {', '.join(interests)} when supported by claims."
        )

    return "\n".join(f"- {x}" for x in instructions)

def render_story_from_cluster_and_profile(cluster, claims, profile):
    interests = profile.get("interests") or []
    if isinstance(interests, str):
        interests = [interests]

    claims_text = "\n".join(
        [
            f"- {c.get('normalized_claim_text') or c.get('claim_text')}"
            for c in claims
            if c.get("normalized_claim_text") or c.get("claim_text")
        ]
    )

    render_instructions = build_render_instructions({
        "depth_preference": profile.get("depth_preference", "standard"),
        "vocabulary_level": profile.get("vocabulary_level", "standard"),
        "evidence_visibility": profile.get("evidence_visibility", "medium"),
        "interests": interests,
    })

    prompt = f"""
You are writing a source-grounded news article for a specific user.

Your job is to write a clean, publishable news story using ONLY the story metadata and claims below.

Do not add facts not supported by the claims.
Do not overwrite source-grounded meaning unless the claims justify it.
Do not speculate, infer motives, infer significance, or add background unless it is directly supported by the provided claims.

The article must still reflect the user's preferences, including depth, vocabulary, evidence visibility, and interests when relevant and supported by the claims.

USER PREFERENCES
- Depth preference: {profile.get("depth_preference", "standard")}
- Vocabulary level: {profile.get("vocabulary_level", "standard")}
- Evidence visibility: {profile.get("evidence_visibility", "medium")}
- Interests: {", ".join(interests) if interests else "none"}

PREFERENCE INSTRUCTIONS
{render_instructions}

STORY METADATA
- Title: {cluster.get("title")}
- Main issue: {cluster.get("main_issue")}
- Event type: {cluster.get("event_type")}
- Location: {cluster.get("location")}
- Date reference: {cluster.get("date_reference")}
- Summary seed: {cluster.get("summary_seed")}

CLAIMS
{claims_text}

CORE WRITING GOAL
Write this like a strong straight-news story that could be filed to an editor at a serious newsroom.
It should read like the article itself, not like a memo, synthesis, explainer scaffold, analyst brief, or structured summary.

NEWSROOM STYLE RULES
- Write in normal news prose.
- Use the inverted pyramid structure.
- Start with the most important and best-supported development.
- Follow with the strongest supporting facts in descending order of importance.
- Keep the story flowing naturally from paragraph to paragraph.
- Do not segment the article into named sections.
- Do not use labels such as "Lead," "Supporting claims," "Additional facts," or "Why it matters."
- Do not write like an outline.
- Do not write like a case summary.
- Do not write like a briefing memo.
- Favor concrete reporting over abstraction.
- Use active voice where possible.
- Keep paragraphs reasonably tight.
- Use direct, restrained, reportorial language.

ATTRIBUTION RULES
- Attribute information clearly, but naturally.
- Do not repeat attribution formulaically in every sentence once the sourcing of a set of facts is already clear.
- Avoid repetitive phrasing such as "according to investigators," "the bureau said," "authorities said," or similar in back-to-back sentences unless necessary.
- Vary attribution naturally when needed.
- If a claim comes from a quote, social post, interview, speech, or official statement, preserve attribution.
- Do not convert attributed statements into unattributed facts.
- If a direct quote is used, identify the speaker clearly.

QUOTE RULES
- Use only the strongest or most necessary quotes.
- Do not stack multiple quotes when paraphrased reporting would be cleaner.
- Preserve direct quotes when they are important and supported by the claims.
- Do not paraphrase quotes in a misleading way.

STRUCTURE RULES
- The story should feel like one continuous article.
- Include a natural nut graf or significance paragraph only when supported by the claims.
- Do not append a visible explainer section to the article body.
- Any significance should be woven naturally into the article, especially in the middle or closing paragraphs.
- If relevant user-interest-specific information is supported by the claims, weave it into the article naturally rather than separating it out.
- User interests may shape emphasis only when relevant and supported by the claims. They must never change the underlying facts.

EDITORIAL RULES
- Generate the headline from the most important and best-supported development in the claims, not necessarily the cluster title.
- Only include information directly supported by the provided claims.
- Do not infer causes, motivations, wider implications, trend lines, or political meaning unless explicitly supported.
- Do not introduce broad framing unless it is justified by the source material.
- Do not over-explain the reporting process itself unless that process is genuinely newsworthy.
- Avoid bureaucratic or legalistic phrasing when simpler news language would do.
- Do not use em dashes.

TONE CALIBRATION
- The prose should feel human, restrained, and reportorial.
- It should sound like a filed article draft, not like ChatGPT explaining the news.
- It should not sound inflated, academic, or overly systematic.
- It should not sound like it is summarizing documents for a user.
- It should sound like the article itself.

LENGTH RULES
- If the claims support a full story, write a full coherent article.
- If the claims support only a brief, write a shorter but still natural article.
- Do not pad the story with unsupported context.
- Depth preference should affect how much context and connective explanation is included, but never at the expense of factual discipline.

OUTPUT RULES
Return valid JSON in exactly this shape:
{{
  "headline": "string",
  "summary": "string",
  "body": "string",
  "why_it_matters": "string"
}}

FIELD RULES
- headline: sharp, factual, and newsy
- summary: 1-2 sentence deck-style summary in news language
- body: the full article in flowing news prose with no section labels
- why_it_matters: brief and restrained; write it like a concise nut graf, not like an analysis memo
"""

    response = client.responses.create(
        model="gpt-5-mini",
        input=prompt
    )

    try:
        return json.loads(_clean(response.output_text))
    except:
        raise HTTPException(500, "Render failed")
