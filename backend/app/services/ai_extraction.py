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

def generate_editorial_structure(cluster: dict, claims: list[dict], sources: list[dict]) -> dict:
    import json

    interests = cluster.get("interest_tags") or []
    if isinstance(interests, str):
        interests = [interests]

    claims_payload = []
    for claim in claims:
        claims_payload.append({
            "id": claim.get("id"),
            "source_id": claim.get("source_id"),
            "claim_text": claim.get("claim_text"),
            "normalized_claim_text": claim.get("normalized_claim_text"),
            "support_excerpt": claim.get("support_excerpt"),
            "verification_status": claim.get("verification_status"),
            "claim_type": claim.get("claim_type"),
            "support_count": claim.get("support_count"),
            "story_order": claim.get("story_order"),
            "is_core_claim": claim.get("is_core_claim"),
        })

    sources_payload = []
    for source in sources:
        sources_payload.append({
            "id": source.get("id"),
            "title": source.get("title"),
            "source_type": source.get("source_type"),
            "source_url": source.get("source_url"),
            "source_strength_score": source.get("source_strength_score"),
            "source_strength_label": source.get("source_strength_label"),
            "is_canonical": source.get("is_canonical"),
            "contains_verifiable_info": source.get("contains_verifiable_info"),
            "is_primarily_opinion": source.get("is_primarily_opinion"),
            "is_direct_evidence": source.get("is_direct_evidence"),
        })

    prompt = f"""
You are building the master editorial structure for a source-grounded straight-news story.

Do NOT write the final user-facing article.
Do NOT write a summary memo.
Do NOT write analysis.
Build the fullest justified editorial structure of the story so that later renders for different users can be generated from it.

Your output must represent:
- the shared truth structure of the story
- the strongest editorial ordering
- required vs optional story modules
- quote opportunities
- attribution plans
- highlight targets for source-linked attribution in user-facing stories

The structure should be as complete as the reporting justifies.
If the reporting supports 8-10 modules, include them.
If it only supports 4-5, include only those.
Do not artificially compress the story.

STORY CLUSTER
{json.dumps({
    "id": cluster.get("id"),
    "title": cluster.get("title"),
    "top_line": cluster.get("top_line"),
    "main_issue": cluster.get("main_issue"),
    "event_type": cluster.get("event_type"),
    "location": cluster.get("location"),
    "date_reference": cluster.get("date_reference"),
    "summary_seed": cluster.get("summary_seed"),
    "interest_tags": interests,
}, ensure_ascii=False)}

CLAIMS
{json.dumps(claims_payload, ensure_ascii=False)}

SOURCES
{json.dumps(sources_payload, ensure_ascii=False)}

EDITORIAL REQUIREMENTS
- Think like a top newsroom editor building the master story graph.
- Preserve inverted-pyramid logic.
- Identify the strongest lead-worthy facts.
- Identify the strongest nut-graf material.
- Distinguish support, procedural detail, official response, counterpoint, context, and closing material.
- Prefer direct quotes only when they materially strengthen the reporting.
- Include quote modules when useful, but do not force them.
- Mark modules as required only when they truly belong in every version of the story.
- Mark modules as optional when they should appear only in deeper or more specialized versions.
- Include source_ids and claim_ids for every module.
- Include attribution guidance for each module.
- Include highlight targets only for attributable phrases or direct quotes that should be source-linked in the reader experience.
- Never assign octiq_copy as a highlight target in the user-facing story.
- The standard_headline should be the newsroom/default headline for the dashboard/editorial view.
- The structure should support user-specific re-rendering later, so keep it modular.

ROLE TAXONOMY
Use only these module roles:
- lead
- nut_graf
- support
- quote_support
- procedural_detail
- official_response
- counterpoint
- context
- closing

OUTPUT
Return valid JSON in exactly this shape:

{{
  "version": 1,
  "story_core": {{
    "standard_headline": "string",
    "standard_deck": "string",
    "main_event": "string",
    "main_issue": "string",
    "location": "string",
    "date_reference": "string"
  }},
  "editorial_logic": {{
    "lead_angle": "string",
    "nut_graf_angle": "string",
    "default_tone": "straight_news",
    "default_priority_order": ["lead", "nut_graf", "support"]
  }},
  "modules": [
    {{
      "module_id": "m1",
      "role": "lead",
      "required": true,
      "priority": 100,
      "depth_eligibility": ["quick", "standard", "deep"],
      "interest_tags": ["politics"],
      "claim_ids": ["claim-id"],
      "source_ids": ["source-id"],
      "render_guidance": {{
        "prefer_quote": false,
        "allow_quote": true,
        "max_sentences_quick": 2,
        "max_sentences_standard": 3,
        "max_sentences_deep": 4,
        "headline_candidate": true
      }},
      "text_basis": "Rendered editorial-copy basis for this graf/module.",
      "attribution_plan": [
        {{
          "style": "records_show",
          "source_ids": ["source-id"]
        }}
      ],
      "highlight_targets": [
        {{
          "type": "attribution_clause",
          "target_text_basis": "according to court records",
          "source_ids": ["source-id"]
        }}
      ]
    }}
  ],
  "quote_bank": [
    {{
      "quote_id": "q1",
      "claim_id": "claim-id",
      "source_id": "source-id",
      "speaker": "string",
      "quote_text": "string",
      "priority": 100,
      "usable_roles": ["support", "quote_support"],
      "direct_quote_recommended": true
    }}
  ],
  "render_rules": {{
    "max_quotes_quick": 1,
    "max_quotes_standard": 2,
    "max_quotes_deep": 3,
    "must_include_roles": ["lead", "nut_graf", "closing"],
    "quick_optional_roles": [],
    "standard_optional_roles": ["support", "counterpoint"],
    "deep_optional_roles": ["support", "procedural_detail", "quote_support", "context", "counterpoint"]
  }}
}}

QUALITY BAR
- The structure must feel like the editorial plan for a serious news article.
- Do not output placeholder values.
- Do not include empty modules.
- Only include modules justified by the provided claims and sources.
"""

    response = client.responses.create(
        model="gpt-5-mini",
        input=prompt
    )

    output_text = _clean_json_output(response.output_text)

    try:
        return json.loads(output_text)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail=f"Model did not return valid JSON for editorial structure: {output_text}"
        )

def get_profile_interests(profile: dict) -> list[str]:
    interests = profile.get("interests") or []
    if isinstance(interests, str):
        interests = [interests]
    return interests


def select_editorial_modules_for_profile(editorial_structure: dict, profile: dict) -> list[dict]:
    modules = editorial_structure.get("modules") or []
    render_rules = editorial_structure.get("render_rules") or {}

    depth = profile.get("depth_preference", "standard")
    interests = set(get_profile_interests(profile))

    must_include_roles = set(render_rules.get("must_include_roles") or [])

    if depth == "quick":
        optional_roles = set(render_rules.get("quick_optional_roles") or [])
    elif depth == "deep":
        optional_roles = set(render_rules.get("deep_optional_roles") or [])
    else:
        optional_roles = set(render_rules.get("standard_optional_roles") or [])

    selected = []

    for module in modules:
        role = module.get("role")
        required = module.get("required", False)
        depth_eligibility = set(module.get("depth_eligibility") or [])
        module_interests = set(module.get("interest_tags") or [])

        if depth_eligibility and depth not in depth_eligibility:
            continue

        include = False

        if required or role in must_include_roles:
            include = True
        elif role in optional_roles:
            include = True
        elif interests and module_interests.intersection(interests):
            include = True

        if include:
            selected.append(module)

    # preserve editorial hierarchy by priority descending
    selected.sort(key=lambda m: m.get("priority", 0), reverse=True)
    return selected


def select_quotes_for_profile(editorial_structure: dict, profile: dict, selected_modules: list[dict]) -> list[dict]:
    quote_bank = editorial_structure.get("quote_bank") or []
    depth = profile.get("depth_preference", "standard")

    render_rules = editorial_structure.get("render_rules") or {}
    if depth == "quick":
        max_quotes = render_rules.get("max_quotes_quick", 1)
    elif depth == "deep":
        max_quotes = render_rules.get("max_quotes_deep", 3)
    else:
        max_quotes = render_rules.get("max_quotes_standard", 2)

    selected_roles = {m.get("role") for m in selected_modules}

    eligible_quotes = [
        q for q in quote_bank
        if set(q.get("usable_roles") or []).intersection(selected_roles)
    ]

    eligible_quotes.sort(key=lambda q: q.get("priority", 0), reverse=True)
    return eligible_quotes[:max_quotes]


def build_structure_render_payload(editorial_structure: dict, profile: dict) -> dict:
    selected_modules = select_editorial_modules_for_profile(editorial_structure, profile)
    selected_quotes = select_quotes_for_profile(editorial_structure, profile, selected_modules)

    return {
        "story_core": editorial_structure.get("story_core") or {},
        "editorial_logic": editorial_structure.get("editorial_logic") or {},
        "selected_modules": selected_modules,
        "selected_quotes": selected_quotes,
        "render_rules": editorial_structure.get("render_rules") or {},
    }

def collect_highlight_targets_from_modules(selected_modules: list[dict]) -> list[dict]:
    highlight_targets = []

    for module in selected_modules:
        module_targets = module.get("highlight_targets") or []
        for target in module_targets:
            source_ids = target.get("source_ids") or []
            if source_ids:
                highlight_targets.append({
                    "type": target.get("type"),
                    "target_text_basis": target.get("target_text_basis"),
                    "source_ids": source_ids,
                    "module_id": module.get("module_id"),
                    "role": module.get("role"),
                })

    return highlight_targets

def render_story_from_cluster_and_profile(cluster: dict, claims: list[dict], profile: dict) -> dict:
    interests = get_profile_interests(profile)

    editorial_structure = cluster.get("editorial_structure_json") or {}

    render_instructions = build_render_instructions({
        "depth_preference": profile.get("depth_preference", "standard"),
        "vocabulary_level": profile.get("vocabulary_level", "standard"),
        "evidence_visibility": profile.get("evidence_visibility", "medium"),
        "interests": interests,
    })

    # fallback for older clusters that do not yet have editorial structure
    if not editorial_structure or not editorial_structure.get("modules"):
        claims_text = "\n".join(
            [
                f"- {c.get('normalized_claim_text') or c.get('claim_text')}"
                for c in claims
                if c.get("normalized_claim_text") or c.get("claim_text")
            ]
        )

        prompt = f"""
You are writing a source-grounded straight-news article for a specific user.

Use ONLY the story metadata and claims below.
Do not add facts not supported by the claims.

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

Write a straight-news article in inverted-pyramid form.
Use direct quotes when materially useful.
Return valid JSON in exactly this shape:
{{
  "headline": "string",
  "summary": "string",
  "body": "string",
  "why_it_matters": "string"
}}
"""
        response = client.responses.create(
            model="gpt-5-mini",
            input=prompt
        )

        output_text = _clean_json_output(response.output_text)

        try:
            parsed = json.loads(output_text)
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail=f"Model did not return valid JSON: {output_text}")

        return {
            "headline": parsed.get("headline", cluster.get("title") or "Generated story"),
            "summary": parsed.get("summary", ""),
            "body": parsed.get("body", ""),
            "why_it_matters": parsed.get("why_it_matters", ""),
            "highlight_targets": [],
        }

    structure_payload = build_structure_render_payload(editorial_structure, profile)

    prompt = f"""
You are writing a source-grounded straight-news article for a specific user.

You are NOT writing from raw source material.
You are writing from a pre-built editorial structure that represents the fullest justified newsroom understanding of the story.

Your job is to produce a user-specific version of the article while preserving:
- the underlying verified facts
- the editorial logic of the story
- the general role ordering of the selected modules
- the attribution logic already built into the structure

You may adjust:
- article length
- sentence density
- vocabulary
- how much optional context appears
- whether selected quote modules are surfaced more directly
- emphasis of user-relevant modules when supported by the story

You may NOT:
- invent facts
- reorder the story into a fundamentally different editorial logic
- flatten meaningful quote opportunities into bland paraphrase when a direct quote is clearly stronger
- ignore required modules
- change the underlying meaning of the story

USER PREFERENCES
- Depth preference: {profile.get("depth_preference", "standard")}
- Vocabulary level: {profile.get("vocabulary_level", "standard")}
- Evidence visibility: {profile.get("evidence_visibility", "medium")}
- Interests: {", ".join(interests) if interests else "none"}

PREFERENCE INSTRUCTIONS
{render_instructions}

EDITORIAL STRUCTURE PAYLOAD
{json.dumps(structure_payload, ensure_ascii=False)}

WRITING REQUIREMENTS
- Write a real article, not an outline.
- Preserve inverted-pyramid structure.
- Keep the story clear, direct, and newsroom-quality.
- Use the selected modules as the article spine.
- The final article should feel coherent and naturally written, not modular or stitched together.
- Use direct quotes where they materially strengthen the reporting.
- Do not overload the story with quotes.
- Preserve attribution naturally and avoid repetitive attribution phrasing.
- If a quote is selected and valuable, prefer using it rather than flattening it into paraphrase.
- The dashboard standard headline is not necessarily the user headline; generate a user-facing headline appropriate to this user's settings.

OUTPUT
Return valid JSON in exactly this shape:
{{
  "headline": "string",
  "summary": "string",
  "body": "string",
  "why_it_matters": "string"
}}
"""

    response = client.responses.create(
        model="gpt-5-mini",
        input=prompt
    )

    output_text = _clean_json_output(response.output_text)

    try:
        parsed = json.loads(output_text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"Model did not return valid JSON: {output_text}")

    return {
        "headline": parsed.get(
            "headline",
            editorial_structure.get("story_core", {}).get("standard_headline")
            or cluster.get("title")
            or "Generated story"
        ),
        "summary": parsed.get("summary", ""),
        "body": parsed.get("body", ""),
        "why_it_matters": parsed.get("why_it_matters", ""),
        "highlight_targets": structure_payload.get("highlight_targets", []),
    }
