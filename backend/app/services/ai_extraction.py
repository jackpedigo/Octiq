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
You are writing a source-grounded straight-news article for a specific user.

Your job is to write copy that reads like a strong filed story from a serious newsroom: clear, restrained, concrete, and publication-ready.

Use ONLY the story metadata and claims below.
Do not add facts not supported by the claims.
Do not speculate.
Do not infer motives, causes, trend lines, or implications unless they are directly supported by the claims.
Do not inject unattributed opinion.
Do not write like an explainer, memo, synthesis note, analyst brief, or AI summary.
Write the article itself.

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

CORE NEWSROOM STANDARD
Write in a way that is:
- accurate
- fair
- direct
- concise
- readable
- structurally disciplined
- free of hype
- free of filler
- free of AI voice

The article must feel like filed reporting, not generated commentary.

INVERTED PYRAMID REQUIREMENT
- Open with the most important, best-supported development.
- Put the strongest verified facts highest in the story.
- Follow with the most important supporting details.
- Then add relevant context and secondary details.
- End cleanly, without trailing off into vague commentary.

NUT GRAF REQUIREMENT
- Within the first 3 to 5 paragraphs, make clear why the development matters in context.
- This should read like a natural nut graf in a news story, not like an analysis section or “why it matters” box.
- If the significance is not sufficiently supported by the claims, do not force it.

ATTRIBUTION DISCIPLINE
- Attribute information clearly, but do not over-attribute every sentence.
- Once a paragraph’s sourcing is established, continue naturally unless a new attribution is required.
- Avoid repetitive structures such as:
  “X said ...”
  “Y said ...”
  “Z said ...”
  in consecutive sentences.
- Consolidate attribution when appropriate.
- Preserve attribution for quotes, interviews, speeches, social posts, statements, filings, records, and documents.
- Do not turn attributed claims into unattributed facts.

QUOTE RULES
- Prefer direct quotes when they materially strengthen the reporting.
- Use quotes when they add authority, specificity, or voice that paraphrase would weaken.
- Preserve exact wording when the claims support it.
- Do not use quotes merely for decoration.
- If a direct quote is clearly the strongest available reporting element, prefer it over paraphrase.
- Identify the speaker clearly and naturally.
- Do not stack multiple weak quotes when one strong quote will do.
- Full sentence quotes must be their own separate paragraphs.

STYLE RULES
- Prefer short, declarative sentences.
- Prefer concrete reporting over abstract framing.
- Use active voice where possible.
- Keep paragraphs tight.
- Avoid bureaucratic, legalistic, and inflated phrasing where simpler news language works.
- Avoid throat-clearing.
- Avoid scene-setting unless it materially advances the reporting.
- Do not use section headers.
- Do not write “Lead,” “Support,” “Context,” “Why it matters,” or any other labels.
- Do not use bullet points.
- Do not use em dashes.
- When a quote is genuinely ontributive or core to the story, prefer using the direct quote to a claim or summary about it.

TONE RULES
- Sound like a skilled reporter writing for an editor.
- Do not sound impressed by the material.
- Do not sound academic.
- Do not sound like you are explaining the article to the user.
- Do not sound like you are summarizing source packets.
- Do not sound like a chatbot.
- Do not use vague newsroom cliches like “raises questions,” “underscores,” “spotlights,” or “comes as” unless they are clearly the cleanest phrasing and directly supported.

ANTI-AI VOICE RULES
Avoid these common failure modes:
- repetitive attribution
- repetitive sentence openings
- mechanical transitions
- padded context
- generic closing paragraphs
- inflated language
- obvious synthesis phrasing such as “according to the information provided”
- analyst-style wording such as “this development suggests”
- empty framing such as “the situation highlights”

USER-PREFERENCE CALIBRATION
- User preferences may affect depth, tone, vocabulary, and emphasis.
- User interests may shape emphasis only when supported by the claims.
- User interests must never change the underlying facts, structure of verification, or meaning of the story.
- If the user prefers deeper coverage, add more context and connective reporting, not fluff.
- If the user prefers simpler language, simplify wording without flattening factual precision.

ENDING RULE
- End on a grounded, reportorial line.
- Prefer a clean final fact, consequence, or unresolved reported point.
- Do not end on vague observer reaction unless that reaction is itself clearly newsworthy.
- Do not append a separate analysis section.

HEADLINE RULE
- Write a sharp, factual, newsworthy headline based on the strongest supported development.
- The headline should sound like a real story headline, not a topic label or essay title.

SUMMARY RULE
- Write a 1-2 sentence deck-style summary in clean news language.
- It should sound like display copy under a headline, not a recap memo.

OUTPUT RULE
Return valid JSON in exactly this shape:
{{
  "headline": "string",
  "summary": "string",
  "body": "string",
  "why_it_matters": "string"
}}

FIELD RULES
- headline: factual, tight, newsy
- summary: short deck
- body: full article in flowing newsroom prose
- why_it_matters: brief and restrained; write this like an internal nut-graf-style summary, not like an opinion section
"""

    response = client.responses.create(
        model="gpt-5-mini",
        input=prompt
    )

    try:
        return json.loads(_clean(response.output_text))
    except:
        raise HTTPException(500, "Render failed")
