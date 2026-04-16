import json
from fastapi import HTTPException
from app.openai_client import client

ALLOWED_INTEREST_TAGS = [
    "politics","economy","education","public_safety","health","environment",
    "technology","housing","transportation","labor","courts","immigration",
    "international","climate","business","media","culture","sports"
]

SOURCE_ANALYSIS_MODEL = "gpt-5-nano"
CLAIM_EXTRACTION_MODEL = "gpt-5-mini"
EDITORIAL_STRUCTURE_MODEL = "gpt-5-mini"
STORY_RENDER_MODEL = "gpt-5-mini"

def _clean_json_output(output_text: str) -> str:
    output_text = output_text.strip()

    if output_text.startswith("```"):
        output_text = output_text.replace("```json", "").replace("```", "").strip()

    return output_text

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

def analyze_source_for_strength_and_story_fields(source: dict) -> dict:
    if source.get("source_type") == "octiq_copy":
        return {
            "source_strength_score": 100,
            "source_strength_label": "canonical",
            "is_canonical": True,
            "contains_verifiable_info": True,
            "is_primarily_opinion": False,
            "is_direct_evidence": True,
            "title": source.get("title") or "Octiq Copy",
            "main_issue": None,
            "event_type": None,
            "location": None,
            "date_reference": None,
            "summary_seed": None,
            "interest_tags": [],
            "core_claims": [],
        }

    prompt = f"""
Analyze this source for both source strength and story-defining fields.

Return valid JSON in exactly this shape:

{{
  "source_strength_score": 0,
  "source_strength_label": "weak",
  "is_canonical": false,
  "contains_verifiable_info": false,
  "is_primarily_opinion": false,
  "is_direct_evidence": false,
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

Rules for source strength:
- Evaluate based on factuality, verifiability, directness, and usefulness to a reported story.
- Opinion-heavy material should score lower.
- Official statements, documents, data releases, and direct evidence can score higher.
- Social posts and quotes can be important but should not automatically be treated as verified fact.

Rules for story fields:
- Keep all story fields concise.
- Do not invent facts.
- interest_tags must only come from this list:
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
        model=SOURCE_ANALYSIS_MODEL,
        input=prompt
    )

    output_text = _clean_json_output(response.output_text)

    try:
        parsed = json.loads(output_text)
    except json.JSONDecodeError:
        raise HTTPException(500, f"Combined source analysis failed: {output_text}")

    parsed["interest_tags"] = [
        tag for tag in parsed.get("interest_tags", [])
        if tag in ALLOWED_INTEREST_TAGS
    ]

    return parsed

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
        model=CLAIM_EXTRACTION_MODEL,
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

def score_claim_for_editorial_priority(claim: dict, source_lookup: dict) -> int:
    score = 0

    verification_status = claim.get("verification_status")
    claim_type = claim.get("claim_type")
    support_count = claim.get("support_count") or 0
    is_core_claim = claim.get("is_core_claim", False)

    source = source_lookup.get(claim.get("source_id")) or {}
    source_strength = source.get("source_strength_score") or 0
    is_canonical = source.get("is_canonical", False)
    is_direct_evidence = source.get("is_direct_evidence", False)
    is_opinion = source.get("is_primarily_opinion", False)
    source_type = source.get("source_type")

    if verification_status == "core":
        score += 40
    elif verification_status == "supported":
        score += 28
    elif verification_status == "attributed_only":
        score += 10

    if is_core_claim:
        score += 20

    score += min(support_count * 4, 16)

    if is_canonical:
        score += 12

    if is_direct_evidence:
        score += 10

    if source_strength >= 90:
        score += 10
    elif source_strength >= 75:
        score += 6
    elif source_strength >= 60:
        score += 3

    if claim_type == "statistic":
        score += 8
    elif claim_type == "fact":
        score += 6
    elif claim_type == "official_position":
        score += 4
    elif claim_type == "denial":
        score += 3
    elif claim_type == "quote":
        score += 2
    elif claim_type == "context":
        score += 1

    if source_type == "octiq_copy":
        score += 12

    if is_opinion:
        score -= 8

    return score

def generate_editorial_structure(cluster: dict, claims: list[dict], sources: list[dict]) -> dict:
    import json

    interests = cluster.get("interest_tags") or []
    if isinstance(interests, str):
        interests = [interests]

    source_lookup = {source.get("id"): source for source in sources}

    sorted_claims = sorted(
        claims,
        key=lambda c: score_claim_for_editorial_priority(c, source_lookup),
        reverse=True
    )

    claims_payload = []
    for claim in sorted_claims:
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
            "editorial_priority_score": score_claim_for_editorial_priority(claim, source_lookup),
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

This is not the final article.
This is the newsroom master structure from which multiple user-specific versions will later be rendered.

Your job is to act like a top editor:
- identify the real lead
- identify the real nut graf
- distinguish essential support from optional support
- decide where direct quotes are actually worth using
- separate official response from criticism/counterpoint
- separate context from core reporting
- build a clean closing
- identify which attribution phrases or direct quotes should be source-linked in the reader experience

You must build the fullest justified version of the story.
Do not artificially shorten it.
If the reporting justifies many modules, include many modules.
If it does not, do not invent them.

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

EDITORIAL DECISION RULES

LEAD RULES
- The lead must be built from the strongest, best-supported, most newsworthy development.
- Do not lead with background, reaction, commentary, or secondary detail.
- Prefer scale + action + subject over thematic framing.

NUT GRAF RULES
- The nut graf should explain why the development matters in story terms.
- It should clarify scale, stakes, consequence, or institutional significance.
- It should not simply repeat the lead.

SUPPORT RULES
- Support modules should contain reporting that materially advances the story.
- Do not create support modules that merely restate earlier material.
- Prioritize verified facts, numbers, procedural specifics, and concrete developments.

QUOTE RULES
- Quotes should be used only when they materially strengthen the reporting.
- Prefer direct quotes when they add authority, specificity, or voice that paraphrase would weaken.
- Do not fill the quote_bank with weak or decorative quotes.
- A strong quote should usually come from a meaningful source, not generic commentary.
- If a quote is emotionally vivid but factually weak, do not prioritize it over stronger reporting.
- Do not overpopulate quote modules.

OFFICIAL RESPONSE RULES
- Official response modules should contain the formal defense, explanation, or institutional position.
- Keep this separate from factual support modules.

COUNTERPOINT RULES
- Counterpoint modules should capture denial, contradiction, challenge, or criticism that materially belongs in the story.
- Do not confuse counterpoint with general context.

CONTEXT RULES
- Context modules should help the reader situate the event, but they should not displace core reporting.
- Context should be used when it is genuinely necessary and supported.

CLOSING RULES
- Closing modules should end on a grounded, reportorial point.
- Prefer a still-unresolved fact, next step, or current-status point.
- Do not end on vague color or thematic language.

HIGHLIGHT TARGET RULES
- Only create highlight targets for phrases that should be source-linked in the reader experience.
- Good highlight targets include:
  - direct quotes
  - “according to ...” clauses
  - “X said” / “the agency said” / “the filing says”
  - direct source-invoking attribution language
- Do not create highlight targets for generic factual prose.
- Do not create highlight targets for octiq_copy.
- highlight target text should be concise and likely to appear naturally in the eventual render.

MODULE QUALITY RULES
- Every module must have a distinct editorial purpose.
- Do not produce multiple modules that do the same job.
- Each module's text_basis should read like clean editorial copy for that graf, not like notes or claims pasted together.
- text_basis should be publication-quality backbone copy.

ROLE TAXONOMY
Use only:
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
      "text_basis": "string",
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

STRICT QUALITY BAR
- Do not output empty modules.
- Do not output duplicate modules.
- Do not output weak quotes in quote_bank unless they are truly useful.
- Do not make every module required.
- Preserve a realistic newsroom hierarchy.
- Make the structure strong enough that later user renders can vary meaningfully without losing editorial discipline.
"""

    response = client.responses.create(
        model=EDITORIAL_STRUCTURE_MODEL,
        input=prompt
    )

    output_text = _clean_json_output(response.output_text)

    try:
        parsed = json.loads(output_text)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail=f"Model did not return valid JSON for editorial structure: {output_text}"
        )

    modules = parsed.get("modules") or []

    # remove duplicate/empty modules
    cleaned_modules = []
    seen_texts = set()

    for module in modules:
        text_basis = (module.get("text_basis") or "").strip()
        if not text_basis:
            continue

        normalized = " ".join(text_basis.lower().split())
        if normalized in seen_texts:
            continue

        seen_texts.add(normalized)
        cleaned_modules.append(module)

    # ensure priorities descend cleanly
    cleaned_modules.sort(key=lambda m: m.get("priority", 0), reverse=True)
    parsed["modules"] = cleaned_modules

    # tighten quote bank to only quotes that map to selected module roles
    quote_bank = parsed.get("quote_bank") or []
    valid_roles = {m.get("role") for m in cleaned_modules}

    cleaned_quotes = []
    seen_quotes = set()

    for quote in sorted(quote_bank, key=lambda q: q.get("priority", 0), reverse=True):
        quote_text = (quote.get("quote_text") or "").strip()
        if not quote_text:
            continue

        if quote_text.lower() in seen_quotes:
            continue

        usable_roles = set(quote.get("usable_roles") or [])
        if usable_roles and not usable_roles.intersection(valid_roles):
            continue

        seen_quotes.add(quote_text.lower())
        cleaned_quotes.append(quote)

    parsed["quote_bank"] = cleaned_quotes[:5]

    return parsed

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
        priority = module.get("priority", 0)

        if depth_eligibility and depth not in depth_eligibility:
            continue

        include = False

        if required or role in must_include_roles:
            include = True
        elif role in optional_roles and priority >= 60:
            include = True
        elif interests and module_interests.intersection(interests) and priority >= 45:
            include = True
        elif depth == "deep" and priority >= 75:
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

    # prefer explicitly recommended direct quotes
    eligible_quotes.sort(
        key=lambda q: (
            1 if q.get("direct_quote_recommended") else 0,
            q.get("priority", 0)
        ),
        reverse=True
    )

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
            model=STORY_RENDER_MODEL,
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

STRUCTURE EXECUTION RULE

- Each selected module should map to one paragraph.
- Do not merge multiple modules into one paragraph.
- Do not split a module across multiple paragraphs unless depth requires it.
- Preserve the module order.

PARAGRAPH DISCIPLINE

- Each paragraph should do one job only:
  lead, nut graf, support, procedural detail, response, counterpoint, context, or close.
- Do not mix multiple roles in one paragraph.

QUOTE PRIORITY

- If a selected quote is clearly the strongest expression of a point, use it directly rather than paraphrasing.
- Prefer embedding one strong quote within a paragraph over summarizing multiple weaker statements.

ANALYSIS CONTROL

- Do not introduce analysis or implications unless they are explicitly supported by claims or attributed sources.
- Avoid sentences that generalize beyond the reporting.
- Do not write like an analyst or commentator.

ENDING RULE

- End on a concrete, reportable fact or clearly supported unresolved point.
- Do not end with analysis, dual framing, or generalized implications.
- Prefer:
  - current status
  - pending review
  - unresolved question grounded in reporting

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
        model=STORY_RENDER_MODEL,
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
