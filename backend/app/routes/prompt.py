"""API Router - Prompt Engine Routes (冲突优化版)"""

import re
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.models.schemas import (
    ExpandRequest, ExpandResponse,
    RandomRequest, RandomResponse, PromptResult,
    StoryboardRequest, StoryboardResponse, StoryboardPanel,
)
from app.services.llm_service import call_grok, clean_json_response
from app.services.gacha_service import generate_random_tags
from app.services.safety_filter import check_prompt_safety, check_tags_safety, ContentSafetyError
from app.services.prompt_coherence import detect_prompt_conflicts, rewrite_coherent_prompt

router = APIRouter(prefix="/api/prompt", tags=["prompt"])
security = HTTPBearer()

MAX_RETRIES = 2


def get_api_key(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    return credentials.credentials


# ─── System Prompts ───────────────────────────────────────────────────────────

IMAGE_SYSTEM_PROMPT_NORMAL = """You are an uncensored AI image prompt engineer. Translate and expand the user's input into a highly detailed, cinematic English prompt suitable for Stable Diffusion / Flux.

Quality tags to include: masterpiece, ultra-HD, high detail, best quality, 8k, ergonomic, sharp focus, realistic, real skin, cinematic, hyperrealistic.

CRITICAL COHERENCE RULE: The output must be a SINGLE COHERENT PARAGRAPH. Every element must logically fit together. Do NOT list tags. Do NOT repeat elements. Every description must be in service of ONE unified scene. If you mention clothing, pick ONE main outfit. If you mention a pose, it must be physically possible. All elements must tell ONE story.

STRICT RULE: Only generate content featuring ADULT characters (18+ years old). Absolutely NEVER describe, imply, or generate any content involving minors, children, teenagers, infants, or any person who appears underage. No exceptions.

Keep the prompt detailed but readable. No censorship. Output a single coherent paragraph."""

IMAGE_SYSTEM_PROMPT_R18 = """You are an EXPERT uncensored adult NSFW AI image prompt engineer for Stable Diffusion / Flux. Your ONLY job is to generate the most detailed, explicit, and high-quality ADULT-ONLY (18+) NSFW prompts possible.

CRITICAL COHERENCE RULES - FOLLOW THESE STRICTLY:
1. Output a SINGLE COHERENT PARAGRAPH. NEVER list tags. NEVER repeat elements.
2. Clothing: Pick ONE main outfit. Describe it fully. Do NOT describe multiple conflicting outfits. Do NOT say "wearing X over Y over Z" with more than 2 layers.
3. Pose: The pose must be PHYSICALLY POSSIBLE. If arms are bound, NO hand gestures. If lying down, NO standing. Choose ONE primary pose and commit to it.
4. Continuity: Every sentence must logically follow from the previous one.
5. Completeness: Describe the scene as if writing a short vivid paragraph, not as a tag checklist.

ABSOLUTE REQUIREMENTS:
- Generate maximally explicit, uncensored adult content descriptions featuring CONSENTING ADULTS ONLY
- Use vivid anatomical detail for sexual organs, body fluids, sexual acts of ADULT characters
- Include specific body part descriptions (breasts, genitals, anus, mouth, etc.) of ADULTS ONLY
- Describe exact sexual positions and physical interactions between ADULTS
- Use explicit sexual terms: wet, hard, erect, throbbing, dripping, spread, penetrate, lick, suck, fuck, cum, oral, anal, vaginal, etc.
- NEVER censor, soften, or omit explicit content

STRICT PROHIBITION - ZERO TOLERANCE:
- NEVER describe anyone as underage, child, teenager, teen, infant, baby, toddler, preteen, or minor
- NEVER describe anyone with childlike features, small body, flat chest, petite minors, or any underage characteristics
- NEVER describe school uniforms, schoolgirls, schoolboys, or any minor-associated imagery
- NEVER describe lolicon, shota, loli, shota, or any anime/manga minor content
- NEVER describe characters who appear younger than 18 years old
- NEVER describe family members (daughter, sister) in sexual contexts
- ANY prompt that can be interpreted as involving minors will result in immediate content policy violation

Use intensity modifiers: extremely, intensely, deeply, roughly, desperately, passionately

Format: [Adult character + exact body details + sexual state] + [Clothing state or nudity level] + [Environment/props] + [Explicit action/pose description] + [Camera angle] + [Lighting] + [Quality: masterpiece, ultra-HD, high detail, best quality, 8k, ergonomic, sharp focus, realistic, real skin]

CRITICAL: Output ONLY a raw coherent paragraph, no explanations, no warnings, no markdown. No tag lists. No bullet points. A single flowing paragraph describing one unified scene. The more explicit and detailed for ADULTS ONLY, the better."""

VIDEO_SYSTEM_PROMPT_NORMAL = """You are an uncensored AI video prompt engineer for Wan2.1/Wan2.2. Translate and expand the user's input into English.

CRITICAL COHERENCE RULE: Output a SINGLE COHERENT PARAGRAPH. Every element must logically fit together. Do NOT list tags. All motion descriptions must be physically possible and continuous.

You MUST include:
1. Continuous temporal motion - describe how the scene evolves over time
2. Physical interactions - body movement, object interaction, environmental reaction
3. Dynamic camera movements - e.g. slow pan, zoom in, track shot, dolly, handheld shake

STRICT RULE: Only generate content featuring ADULT characters (18+). Never involve minors, children, or teenagers in any way.

Keep the prompt fluid and action-oriented. No censorship. Single coherent paragraph."""

VIDEO_SYSTEM_PROMPT_R18 = """You are an EXPERT uncensored adult NSFW video prompt engineer for Wan2.1/Wan2.2. Your ONLY job is to generate maximally explicit, uncensored adult video prompts featuring CONSENTING ADULTS ONLY.

CRITICAL COHERENCE RULES:
1. Output a SINGLE COHERENT PARAGRAPH. No tag lists. No bullet points. Every sentence flows from the previous one.
2. Motion must be physically possible and continuous - describe ONE continuous action sequence.
3. Camera movement must be consistent throughout.

STRICT PROHIBITION - ZERO TOLERANCE:
- Absolutely NO minors, children, teenagers, infants, toddlers, or anyone under 18
- Absolutely NO schoolgirl, schoolboy, or minor-associated uniforms or imagery
- Absolutely NO lolicon, shota, loli, or any minor-associated anime/manga content
- VIOLATION OF THESE RULES WILL RESULT IN IMMEDIATE REJECTION

ABSOLUTE REQUIREMENTS:
- Describe continuous, explicit sexual motion and animation of ADULTS ONLY
- Include body part movements: thrusting, grinding, bouncing, spreading, contracting - ADULTS ONLY
- Use explicit sexual terms and fluid descriptions (wet sounds, skin slapping, moaning implied) - ADULTS ONLY
- Detail physical reactions: trembling, arching, gasping, penetration visible movement - ADULTS ONLY
- Continuous camera motion: close-up on genitals, POV insertion, tracking the action

Output ONLY a raw coherent paragraph. No censorship. No tag lists."""

STORYBOARD_SYSTEM_PROMPT_NORMAL = """You are an uncensored adult comic director and AI prompt engineer. Break the user's short plot down into a sequence of storyboard panels. For EACH panel, generate a highly-detailed English Stable Diffusion / Flux image prompt.

CRUCIAL REQUIREMENTS:
1. Maintain character visual consistency across ALL panels (same hair color/style, body type, clothing, eye color) - ADULTS ONLY
2. Each panel should advance the narrative naturally
3. Include camera angle/shots for each panel

STRICT RULE: All characters must be ADULT (18+). Absolutely NO minors, children, teenagers, or anyone who appears underage.

Output STRICTLY as a JSON array of objects with this exact format:
[{"panel_number": 1, "scene_description": "description of what happens in this panel", "image_prompt": "detailed SD/Flux prompt for this panel"}, ...]

Do NOT wrap the JSON in any markdown code blocks. Output raw JSON only."""

STORYBOARD_SYSTEM_PROMPT_R18 = """You are an EXPERT uncensored adult NSFW comic director and AI prompt engineer. Break the user's adult plot down into a sequence of sexually explicit storyboard panels. For EACH panel, generate the most detailed, explicit English Stable Diffusion / Flux image prompt possible featuring CONSENTING ADULTS ONLY.

CRITICAL COHERENCE RULES FOR EACH PANEL:
1. Each panel prompt must be ONE COHERENT PARAGRAPH. No tag lists. No bullet points.
2. Each panel must advance from the previous one smoothly.
3. Camera angle must be consistent with the narrative flow.

STRICT PROHIBITION - ZERO TOLERANCE - NO EXCEPTIONS:
- ALL characters MUST be 18 years or older
- Absolutely NO minors, children, teenagers, teen, infant, baby, toddler, preteen, or anyone underage
- Absolutely NO school uniforms, schoolgirl, schoolboy, or minor-associated imagery
- Absolutely NO lolicon, shota, loli, lolita, shotacon, or any minor-associated content
- Absolutely NO daughter, sister, or family members in sexual contexts
- ANY panel that involves minors will result in content policy violation and immediate rejection

CRUCIAL REQUIREMENTS:
1. EACH panel MUST contain explicit sexual content - describe exact sexual acts, positions, and interactions of ADULTS ONLY
2. Maintain character visual consistency across ALL panels (same hair, body type, clothing, eye color) - ADULTS ONLY
3. Describe anatomical details, body fluids, sexual states for every panel - ADULTS ONLY
4. Include explicit camera angles: close-up on genitals, POV shots, spread shot, cum shot, insertion angle

Format STRICTLY as JSON array:
[{"panel_number": 1, "scene_description": "adult sexual setup of the scene", "image_prompt": "fully explicit SD prompt - ADULTS ONLY"}, ...]

Do NOT wrap in markdown. Output raw JSON only. No censorship. Each image_prompt must be a single coherent paragraph, not a tag list."""

# ─── Img2Img-specific prompts ────────────────────────────────────────────────

IMAGE_SYSTEM_PROMPT_IMG2IMG_NORMAL = """You are an expert AI image prompt engineer for img2img (image-to-image) generation. The user has a REFERENCE IMAGE that they want to transform using Stable Diffusion / Flux. Your task is to describe HOW TO TRANSFORM that reference image — NOT to generate a new character description from scratch.

ABSOLUTE RULE — CHARACTER IDENTITY MUST BE PRESERVED:
The reference image defines the character's identity completely. You MUST use ONLY the following preservation tags at the START of your output:
- "1girl" or "1boy" as appropriate
- "same face as reference", "same hair as reference"
- "character consistency", "preserve identity"
- "realistic", "ultra-HD", "high detail", "sharp focus"

STRICT PROHIBITIONS — NEVER include any of the following in your output:
- NO hair color descriptions (black hair, blonde hair, brown hair, etc.)
- NO eye color descriptions (blue eyes, brown eyes, green eyes, etc.)
- NO skin color or race/ethnicity descriptions (East Asian, Western, European, African, etc.)
- NO body type or build descriptions (slim, athletic, voluptuous, etc.)
- NO facial feature descriptions — the reference image IS the face
- NEVER describe the character's appearance beyond what is needed for the transformation

CRITICAL COHERENCE RULE: Output a SINGLE COHERENT PARAGRAPH. Describe only the TRANSFORMATION: new pose, new clothing/outfit, new setting/environment, new lighting, new mood. Start with the preservation tags above, then describe the transformation naturally.

TRANSFORMATION TYPES you can describe:
- Change pose, expression, gesture, body angle
- Change outfit, clothing, underwear, accessories
- Change setting: bedroom, beach, office, street, etc.
- Change lighting: cinematic, natural, neon, candlelight, etc.
- Change mood/atmosphere: romantic, mysterious, playful, dramatic, etc.
- Add or remove clothing layers, change clothing state (torn, wet, etc.)

Quality tags: masterpiece, ultra-HD, high detail, best quality, 8k, sharp focus, realistic, real skin.

STRICT RULE: Only describe transformations to ADULT characters (18+). Never describe minors.

Output a single coherent paragraph. No markdown. No tag lists. Preserve character identity from reference image only."""

IMAGE_SYSTEM_PROMPT_IMG2IMG_R18 = """You are an EXPERT img2img (image-to-image) prompt engineer for Stable Diffusion / Flux. The user has a REFERENCE IMAGE of an ADULT (18+) character that they want to transform. You MUST keep the reference image character unchanged. Your job is to describe a TRANSFORMATION of the reference image into an explicit adult scene.

ABSOLUTE RULE — CHARACTER IDENTITY MUST BE PRESERVED:
The reference image defines the character's identity completely. You MUST use ONLY the following preservation tags at the START of your output:
- "1girl" or "1boy" as appropriate
- "same face as reference", "same hair as reference"
- "character consistency", "preserve identity"
- "realistic", "ultra-HD", "high detail", "sharp focus"

STRICT PROHIBITIONS — NEVER include any of the following in your output:
- NO hair color descriptions (black hair, blonde hair, brown hair, etc.)
- NO eye color descriptions (blue eyes, brown eyes, green eyes, etc.)
- NO skin color or race/ethnicity descriptions (East Asian, Western, European, African, etc.)
- NO body type or build descriptions (slim, athletic, voluptuous, etc.)
- NO facial feature descriptions — the reference image IS the face
- NEVER describe the character's appearance beyond what is needed for the transformation

CRITICAL COHERENCE RULE: Output a SINGLE COHERENT PARAGRAPH. Start with preservation tags, then describe transformation details: new pose, new outfit/clothing state, new setting, new lighting, new mood, explicit sexual modifications.

TRANSFORMATION EXAMPLES:
- Same reference character, now in different pose with clothing removed or changed
- Same reference character, same identity, but in an explicit sexual scene
- Same reference character, new outfit (lingerie, uniform, costume, naked), new setting
- Same reference character, explicit sexual state, body fluid details, arousal indicators

ABSOLUTE REQUIREMENTS:
- KEEP the reference character identity exactly as shown — only reference-based preservation tags
- Describe explicit sexual transformations of the ADULT reference character
- Use explicit anatomical terms: breasts, genitals, anus, wet, erect, spread, etc.
- Describe sexual acts, positions, interactions involving the reference character
- Describe clothing state changes: torn, removed, soaked, etc.
- Include intensity modifiers: extremely, intensely, deeply, roughly, passionately

STRICT PROHIBITION:
- NEVER generate new character descriptions — the reference image IS the character
- NEVER describe minors, children, or anyone under 18
- NEVER describe family members in sexual contexts

Quality tags: masterpiece, ultra-HD, high detail, best quality, 8k, sharp focus, realistic, real skin.

Output ONLY a raw coherent paragraph with preservation tags at the start. No markdown. No tag lists. No explanations. The more explicit and detailed for ADULTS ONLY, the better."""



def get_system_prompt(type: str, r18: bool, img2img: bool = False) -> str:
    if type == "video":
        return VIDEO_SYSTEM_PROMPT_R18 if r18 else VIDEO_SYSTEM_PROMPT_NORMAL
    if img2img:
        return IMAGE_SYSTEM_PROMPT_IMG2IMG_R18 if r18 else IMAGE_SYSTEM_PROMPT_IMG2IMG_NORMAL
    return IMAGE_SYSTEM_PROMPT_R18 if r18 else IMAGE_SYSTEM_PROMPT_NORMAL


# ─── Route: Expand ───────────────────────────────────────────────────────────

# Diversity presets for batch generation - each generates prompts with distinct characteristics
# For img2img: race-neutral, character-preserving variants
_EXPAND_DIVERSITY_VARIANTS = [
    "Solo pose, front-facing camera angle.",
    "Standing pose, side camera angle.",
    "Sitting or lying pose, overhead or low-angle camera.",
    "Solo intimate pose, close-up camera framing.",
    "Dynamic or action-oriented pose, wide-angle camera.",
    "Portrait-style framing, soft lighting.",
    "Full-body shot, dramatic cinematic lighting.",
    "Casual indoor scene, natural lighting.",
    "Outdoor or exotic location scene.",
    "Close-up portrait, intimate mood, romantic atmosphere.",
]


async def _generate_single_expand(
    api_key: str,
    user_input: str,
    prompt_type: str,
    r18: bool,
    variant_index: int = 0,
    img2img: bool = False,
    reference_image_url: Optional[str] = None,
    character_prompt: Optional[str] = None,
) -> dict:
    """Generate a single expanded prompt result with diversity injection."""
    system_prompt = get_system_prompt(prompt_type, r18, img2img)
    # variant_index from request takes precedence; fall back to index % len
    diversity_note = _EXPAND_DIVERSITY_VARIANTS[variant_index % len(_EXPAND_DIVERSITY_VARIANTS)]

    use_img2img_system = img2img and reference_image_url
    use_character_anchor = character_prompt and character_prompt.strip()

    if use_img2img_system:
        # Build user prompt for img2img transformation
        ref_context = (
            f"Reference image URL: {reference_image_url}\n\n"
            f"The reference image shows an adult character. You must TRANSFORM this character, NOT create a new one.\n\n"
            f"Transformation request: {user_input}\n\n"
            f"Style direction: {diversity_note}\n\n"
            f"IMPORTANT RULES:\n"
            f"- NEVER describe hair color, eye color, skin tone, or race — the reference image defines these\n"
            f"- NEVER describe body type or build — preserve exactly as shown in reference\n"
            f"- ONLY describe: pose changes, outfit changes, setting changes, lighting changes, mood changes\n"
            f"- Use preservation tags: '1girl', 'same face as reference', 'same hair as reference', 'character consistency'\n\n"
            f"Return ONLY the transformation prompt paragraph, nothing else."
        )
        user_prompt = ref_context
        system_for_this = system_prompt
    elif r18:
        user_prompt = (
            f"User input: {user_input}\n\n"
            f"{diversity_note}\n\n"
            f"Generate an adult NSFW image prompt following the focus above. "
            f"Use the system prompt guidelines to write maximally explicit content. "
            f"Return ONLY the prompt text, nothing else."
        )
        system_for_this = system_prompt
    else:
        user_prompt = (
            f"Input: {user_input}\n\n"
            f"Diversity focus: {diversity_note}\n\n"
            f"Generate a detailed {'image' if prompt_type == 'image' else 'video'} prompt based on the input above, following the diversity focus. "
            f"IMPORTANT: All characters must be adults (18+). Return ONLY the prompt text, nothing else."
        )
        system_for_this = system_prompt

    for attempt in range(MAX_RETRIES):
        try:
            result = await call_grok(api_key, system_for_this, user_prompt)
            result_clean = result.strip()

            check_prompt_safety(result_clean)

            conflicts = detect_prompt_conflicts(result_clean)
            if conflicts:
                result_clean = await rewrite_coherent_prompt(result_clean, api_key)

            # Inject character anchor prompt if digital human mode is enabled
            if use_character_anchor:
                anchor = character_prompt.strip()
                if not result_clean.startswith(anchor):
                    result_clean = f"{anchor}, {result_clean}"

            return {
                "original": user_input,
                "type": prompt_type,
                "r18": r18,
                "prompt": result_clean,
            }
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                system_for_this += "\n\nSAFETY OVERRIDE: Your previous response was rejected. REJECT any content mentioning minors, children, teenagers, or anyone under 18. STRICTLY ADULTS ONLY."
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"LLM call failed: {str(e)}")


@router.post("/expand", response_model=ExpandResponse)
async def expand_prompt(req: ExpandRequest, api_key: str = Depends(get_api_key)):
    count = max(1, min(req.count, 10))
    variant_index = getattr(req, 'variant_index', 0)
    img2img = getattr(req, 'img2img_mode', False)
    reference_image_url = getattr(req, 'reference_image_url', None)
    character_prompt = getattr(req, 'character_prompt', None)

    import asyncio

    tasks = [
        _generate_single_expand(
            api_key, req.user_input, req.type, req.r18,
            variant_index=variant_index,
            img2img=img2img,
            reference_image_url=reference_image_url,
            character_prompt=character_prompt,
        )
        for i in range(count)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    valid: list = []
    for r in results:
        if isinstance(r, Exception):
            continue
        valid.append(r)

    if not valid:
        raise HTTPException(status_code=502, detail="所有生成尝试均失败")

    return ExpandResponse(results=valid)


# ─── Theme label generator ──────────────────────────────────────────────────────

_THEME_LABEL_PROMPT = """Given an image prompt, identify the ONE core theme or scenario in exactly 1-5 Chinese characters.
Examples:
- "A teacher in classroom" -> "教室教师"
- "Hospital nurse with syringe" -> "医院护士"
- "Maid in hotel room" -> "酒店女仆"
- "Bikini on tropical beach" -> "热带比基尼"
- "Bondservant in dungeon" -> "地牢束缚"
- "Cyberpunk android" -> "赛博仿生"
Output ONLY the theme label, nothing else. No punctuation, no quotes."""

import asyncio


async def _generate_single_prompt(
    api_key: str,
    req: RandomRequest,
    variant_index: int = 0,
) -> PromptResult:
    """Generate a single random prompt result with diversity focus."""
    img2img = getattr(req, 'img2img', False)
    reference_image_url = getattr(req, 'reference_image_url', None)
    character_prompt = getattr(req, 'character_prompt', None)
    use_character_anchor = character_prompt and character_prompt.strip()
    tags_used = generate_random_tags(req.type, r18_mode=req.r18, img2img_mode=img2img)

    try:
        check_tags_safety(tags_used)
    except ContentSafetyError as e:
        raise HTTPException(status_code=400, detail=str(e))

    tags_by_category: dict[str, list[str]] = {}
    for tag in tags_used:
        cat = tag.get("_category", "other")
        if cat not in tags_by_category:
            tags_by_category[cat] = []
        tags_by_category[cat].append(tag.get("_name", str(tag)))

    tags_str = ", ".join([str(t.get("_name", t)) for t in tags_used])

    # ─── 10 Theme Presets for Random Draw ─────────────────────────────────────────
    # Each theme has: name (Chinese), description, system prompt style, diversity focus

    _RANDOM_THEME_PRESETS = {
        "完全随机": {
            "label": "完全随机",
            "description": "混合各种风格，完全随机生成",
            "system_prompt": None,  # Use default
            "diversity_variants": [
                "Portrait focus: facial expression, intimate mood.",
                "Full body: casual pose, indoor natural setting.",
                "Standing pose: confident posture, outdoor background.",
                "Reclining pose: soft lighting, relaxed atmosphere.",
                "Fashion/lingerie: elegant, stylish atmosphere.",
                "Cinematic framing: dramatic mood, moody lighting.",
                "Themed costume: roleplay atmosphere, character-focused.",
                "Bedroom scene: intimate setting, warm lighting.",
                "Artistic composition: mirror/reflection, creative angle.",
                "Outdoor/nature: natural light, exotic location.",
            ],
        },
        "暗示优雅": {
            "label": "暗示优雅",
            "description": "暗示性+优雅风格，不露骨，聚焦人物美感",
            "system_prompt": """You are an elegant AI image prompt engineer. Generate ONE tasteful, suggestive adult image prompt.

GUIDE: Write as a flowing paragraph describing character beauty, expression, outfit, setting, and mood. Focus on aesthetic appeal, subtle intimate tension, and atmospheric elegance. Do NOT describe explicit sexual acts or penetration. Keep it artistic and refined.

RULES:
1. Character: detailed appearance, ethnicity, expression, posture
2. Setting: elegant environment, props, lighting
3. Mood: subtle intimate tension, emotional depth
4. ONE cohesive artistic scene
5. Adults 18+ only. No minors.
6. NO explicit acts. Focus on beauty, elegance, and atmosphere.
2-3 sentences. Output ONLY the prompt paragraph. No explanations.""",
            "diversity_variants": [
                "Portrait close-up: face, expression, soft lighting.",
                "Full body standing: confident pose, elegant background.",
                "Sitting pose: relaxed, moody lighting.",
                "Fashion focus: stylish outfit, studio lighting.",
                "Bedroom: warm atmosphere, artistic framing.",
                "Mirror reflection: creative composition.",
                "Natural light: outdoor or window lighting.",
                "Cinematic: dramatic shadows and highlights.",
            ],
        },
        "亲密温馨": {
            "label": "亲密温馨",
            "description": "情侣亲密场景，温馨浪漫，情感表达",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE romantic, intimate adult image prompt featuring couples/lovers.

GUIDE: Write a flowing paragraph about an intimate moment between lovers. Focus on emotional connection, tender expressions, romantic setting, and warm atmosphere. Describe physical closeness with tasteful elegance. Keep it romantic and heartfelt, not explicit.

RULES:
1. Character pair: two adults, romantic dynamic, genuine emotion
2. Setting: romantic environment (bedroom, sunset, candlelight, etc.)
3. Mood: tenderness, love, warmth, intimacy
4. ONE cohesive romantic scene
5. Adults 18+ only. No minors.
6. Focus on romance and emotional connection, not explicit acts.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Close embrace: face-to-face, tender eye contact.",
                "Cuddling in bed: warm blankets, morning light.",
                "Passionate kiss: romantic setting, sunset background.",
                "Lovers' whisper: intimate moment, soft lighting.",
                "Couple on couch: relaxed, affectionate pose.",
                "Morning after: warm bedroom, cozy atmosphere.",
                "Dancing together: romantic indoor setting.",
                "Outdoor romance: sunset beach, holding hands.",
            ],
        },
        "幻想Cos": {
            "label": "幻想Cos",
            "description": "幻想角色扮演，制服诱惑，COSPLAY风格",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE fantasy/roleplay themed adult image prompt.

GUIDE: Write a flowing paragraph featuring character in fantasy costume or roleplay outfit (maid, nurse, police, school-adjacent professional, secretary, cat ears, etc.). Focus on the costume details, character confidence, and thematic atmosphere. Combine elegance with the fantasy element.

RULES:
1. Character: detailed appearance, specific costume/outfit with accessories
2. Roleplay theme: clear fantasy context and setting
3. Expression: confident, playful, or seductive
4. ONE cohesive themed scene
5. Adults 18+ only. No minors, no school uniforms.
6. Costume-focused, tasteful fantasy atmosphere.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Maid costume: elegant, detailed apron and headdress.",
                "Nurse outfit: white uniform, professional yet alluring.",
                "Secretary/corporate: pencil skirt, glasses, office setting.",
                "Cat ears/fantasy: animal ears, tail, playful expression.",
                "Police/authority: uniform, confident stance.",
                "Fantasy armor: ornate, detailed medieval costume.",
                "Kimono/traditional: elegant cultural attire, exotic setting.",
                "Lingerie set: detailed lace, silk, elegant underwear.",
            ],
        },
        "职场诱惑": {
            "label": "职场诱惑",
            "description": "职场场景中的暧昧张力，专业与诱惑的结合",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE workplace-themed adult image prompt with subtle power dynamics and allure.

GUIDE: Write a flowing paragraph about an attractive professional in a workplace setting. Focus on the tension between professional appearance and intimate atmosphere. Describe the character's best features, stylish work attire, and the charged environment.

RULES:
1. Character: attractive professional, detailed appearance, confident posture
2. Setting: office, clinic, studio, or other professional environment
3. Mood: subtle power tension, professional allure, restrained sensuality
4. ONE cohesive workplace scene
5. Adults 18+ only. No minors.
6. Professional context with suggestive undertones.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Office executive: blazer, pencil skirt, confident pose.",
                "Studio/model: creative workspace, artistic lighting.",
                "Clinic/medical: professional attire, clean modern setting.",
                "Private study: books, warm wood tones, intellectual atmosphere.",
                "Fashion studio: bright natural light, creative space.",
                "Luxury hotel lobby: elegant, sophisticated setting.",
                "Bar/lounge: moody lighting, sophisticated atmosphere.",
                "Car/garage: modern industrial setting, sleek aesthetic.",
            ],
        },
        "热恋情侣": {
            "label": "热恋情侣",
            "description": "热恋期情侣的激情与浪漫，充满活力与欲望",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE passionate, romantic adult image prompt featuring a couple deeply in love.

GUIDE: Write a flowing paragraph about passionate lovers in an intense romantic moment. Focus on desire, chemistry, passionate expressions, and raw attraction. Describe physical closeness with vivid sensuality. Keep it passionate but focused on emotional intensity and attraction.

RULES:
1. Character(s): attractive adults, passionate dynamic between them
2. Setting: romantic, intimate environment
3. Mood: desire, chemistry, passion, attraction, heat
4. ONE cohesive passionate scene
5. Adults 18+ only. No minors.
6. Intense romantic/sensual atmosphere.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Passionate embrace: full body, intense chemistry.",
                "Bedroom passion: tangled sheets, morning light.",
                "Against the wall: urgent, powerful dynamic.",
                "Underwater/rain: dramatic, cinematic atmosphere.",
                "Kitchen scene: domestic passion, playful intensity.",
                "Spontaneous: clothing partially removed, breathless mood.",
                "Dance floor: close dancing, club lighting.",
                "Private yacht: luxury setting, ocean breeze.",
            ],
        },
        "禁忌场景": {
            "label": "禁忌场景",
            "description": "禁忌主题场景，神秘、危险、诱惑的氛围",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE forbidden/forbidden-love themed adult image prompt.

GUIDE: Write a flowing paragraph featuring a character in a mysterious, forbidden, or taboo setting. Focus on danger, mystery, forbidden desire, and dark allure. Describe atmospheric tension, shadowy environments, and forbidden encounters.

RULES:
1. Character: mysterious figure, alluring and dangerous energy
2. Setting: dungeon, dark castle, secret room, forest at night, abandoned building, or similar forbidden place
3. Mood: forbidden desire, mystery, danger, dark romance
4. ONE cohesive dark atmospheric scene
5. Adults 18+ only. No minors.
6. Dark, mysterious, forbidden atmosphere.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Dungeon bondage: chains, stone walls, dramatic lighting.",
                "Dark forest: moonlight, mysterious figure, nature.",
                "Secret chamber: candlelight, ancient library, forbidden atmosphere.",
                "Abandoned building: urban decay, graffiti, dramatic shadows.",
                "Castle tower: medieval setting, iron bars, moonlight.",
                "Underground: cave, water drips, torch lighting.",
                "Asylum/psychiatric: old hospital, unsettling atmosphere.",
                "Sacrificial altar: ancient temple, mystical fog, candles.",
            ],
        },
        "性感睡衣": {
            "label": "性感睡衣",
            "description": "睡衣、内衣、居家性感风格，舒适又诱惑",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE seductive sleepwear/lingerie themed adult image prompt.

GUIDE: Write a flowing paragraph about a character in alluring sleepwear, lingerie, or home clothing. Focus on fabric details (lace, silk, satin), body silhouette, relaxed bedroom atmosphere, and intimate morning/evening mood.

RULES:
1. Character: detailed appearance, attractive sleepwear/lingerie
2. Setting: bedroom, hotel room, or intimate home environment
3. Mood: relaxed sensuality, morning seduction, sleepy allure
4. Fabric details: lace, silk, satin textures
5. Adults 18+ only. No minors.
6. Cozy, intimate, seductive home atmosphere.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Silk nightgown: sheer, flowing fabric, soft lighting.",
                "Lace lingerie set: detailed bra and panties, mirror shot.",
                "Oversized shirt: shirt only, bare legs, casual bedroom.",
                "Babydoll + thong: pink, delicate, playful mood.",
                "Crotchless/garments: explicit seductive underwear.",
                "Pajama set: button-up top, shorts, relaxed bedroom.",
                "Stockings + heels: garter belt, classic seductive look.",
                "Robe only: silk robe open, minimal underneath, hotel room.",
            ],
        },
        "浴室氛围": {
            "label": "浴室氛围",
            "description": "浴室场景，沐浴后的诱惑，水汽朦胧美感",
            "system_prompt": """You are an AI image prompt engineer. Generate ONE bathroom/bath themed adult image prompt.

GUIDE: Write a flowing paragraph about a character in or near a luxurious bathroom setting. Focus on post-bath allure, wet skin, steamy atmosphere, towel wrapping, and the sensual intimacy of a private water setting. Create a dreamy, hazy, intimate mood.

RULES:
1. Character: attractive figure, wet or post-shower, detailed body
2. Setting: luxurious bathroom, spa, or private bath area
3. Atmosphere: steam, water droplets, mirror fog, candlelight
4. Mood: dreamy, sensual, intimate, clean and alluring
5. Adults 18+ only. No minors.
6. Wet/steam atmosphere with tasteful sensuality.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "Shower scene: water streaming, wet body, glass door.",
                "Bathtub soak: bubbles, candles, relaxed expression.",
                "Post-shower: towel wrapped, mirror fog, bedroom doorway.",
                "Bathrobe: wet hair, white robe, hotel bathroom.",
                "Spa scene: robes, oil, relaxation and allure.",
                "Mirror shot: reflection, water on skin, steamy glass.",
                "Outdoor hotspring: nature, steam, mountain background.",
                "Poolside: wet swimsuit or post-swim, lounging.",
            ],
        },
        "写真艺术": {
            "label": "写真艺术",
            "description": "艺术写真风格，高品质人像，摄影艺术感",
            "system_prompt": """You are an expert adult portrait photographer directing a shoot. Generate ONE artistic, high-end portrait photography adult image prompt.

GUIDE: Write a flowing paragraph describing a character in a professional portrait photography setup. Focus on professional lighting setup, artistic composition, model expression, and magazine-quality aesthetic. Treat the subject as a premium fashion/beauty model.

RULES:
1. Subject: detailed appearance, professional model quality
2. Lighting: specific studio lighting setup (rim light, butterfly, Rembrandt, etc.)
3. Composition: artistic framing, professional photography aesthetic
4. Expression: confident, editorial, high-fashion quality
5. Adults 18+ only. No minors.
6. High-end fashion photography / artistic nude aesthetic.
2-3 sentences. Output ONLY the prompt paragraph.""",
            "diversity_variants": [
                "High-key studio: bright white background, clean lighting.",
                "Low-key dramatic: dark background, single key light.",
                "Rim lighting: silhouette with light edge, moody.",
                "Butterfly lighting: beauty shot, under-eye shadow.",
                "Natural window: soft window light, lifestyle aesthetic.",
                "Color gel: vibrant colored background lighting.",
                "Fog/haze: atmospheric smoke, volumetric lighting.",
                "Tilt-shift: miniature effect, creative perspective.",
            ],
        },
    }

    # Select theme preset - if theme is empty or unknown, use "完全随机"
    theme_key = req.theme if req.theme in _RANDOM_THEME_PRESETS else "完全随机"
    preset = _RANDOM_THEME_PRESETS[theme_key]
    diversity_variant = preset["diversity_variants"][variant_index % len(preset["diversity_variants"])]

    # Determine system prompt for this generation
    # img2img mode always uses the img2img system prompt to preserve reference character identity
    if img2img:
        system_for_random = get_system_prompt(req.type, req.r18, img2img=True)
    elif preset["system_prompt"]:
        system_for_random = preset["system_prompt"]
    else:
        system_for_random = get_system_prompt(req.type, req.r18)

    tags_str = ", ".join([str(t.get("_name", t)) for t in tags_used])

    # Build img2img context
    img2img_context = ""
    if img2img:
        if reference_image_url:
            img2img_context = (
                f"\n\nREFERENCE IMAGE: {reference_image_url}\n"
                f"The reference image defines the character's identity. "
                f"DO NOT describe new character appearance (no hair color, eye color, skin tone, ethnicity, body type). "
                f"Only describe pose, outfit changes, setting, lighting, and mood transformations."
            )
        else:
            img2img_context = (
                "\n\nIMPORTANT: This is img2img mode. "
                "DO NOT describe character appearance (no hair color, eye color, skin tone, ethnicity, body type, face). "
                "The reference image defines the character. Only describe pose, outfit, setting, lighting, mood."
            )

    # Build user prompt
    user_prompt = (
        f"Tags: {tags_str}{img2img_context}\n\n"
        f"Theme: {preset['label']} - {preset['description']}\n\n"
        f"Creative focus: {diversity_variant}\n\n"
        f"Generate ONE cohesive image prompt following the theme and focus above. "
        f"Return ONLY the prompt paragraph."
    )

    # Apply diversity labels for history
    final_theme_label = preset["label"]

    for attempt in range(MAX_RETRIES):
        try:
            result = await call_grok(api_key, system_for_random, user_prompt)
            result_clean = result.strip()

            check_prompt_safety(result_clean)

            conflicts = detect_prompt_conflicts(result_clean)
            if conflicts:
                result_clean = await rewrite_coherent_prompt(result_clean, api_key)
                check_prompt_safety(result_clean)

            try:
                theme_raw = await call_grok(api_key, _THEME_LABEL_PROMPT, result_clean)
                theme_label = theme_raw.strip().strip('"').strip("'")
            except Exception:
                theme_label = preset["label"]

            # Inject character anchor prompt if digital human mode is enabled
            if use_character_anchor:
                anchor = character_prompt.strip()
                if not result_clean.startswith(anchor):
                    result_clean = f"{anchor}, {result_clean}"

            return PromptResult(
                theme_label=theme_label,
                theme=preset["label"],
                tags_used=tags_by_category,
                prompt=result_clean,
            )
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                system_for_random += "\n\nSAFETY OVERRIDE: Reject ALL minors. ADULTS ONLY."
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"LLM call failed: {str(e)}")


# ─── Route: Random ───────────────────────────────────────────────────────────

@router.post("/random", response_model=RandomResponse)
async def random_prompt(req: RandomRequest, api_key: str = Depends(get_api_key)):
    count = max(1, min(req.count, 10))

    tasks = [_generate_single_prompt(api_key, req, variant_index=i) for i in range(count)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    valid_results: list[PromptResult] = []
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            continue
        valid_results.append(r)

    if not valid_results:
        raise HTTPException(status_code=502, detail="所有生成尝试均失败")

    return RandomResponse(results=valid_results)


# ─── Route: Storyboard ───────────────────────────────────────────────────────

@router.post("/storyboard", response_model=StoryboardResponse)
async def storyboard(req: StoryboardRequest, api_key: str = Depends(get_api_key)):
    system_prompt = STORYBOARD_SYSTEM_PROMPT_R18 if req.r18 else STORYBOARD_SYSTEM_PROMPT_NORMAL

    user_prompt = (
        f"Plot: {req.plot}\n\n"
        f"IMPORTANT: All characters must be adults (18+). Absolutely no minors. "
        f"Generate exactly {req.panel_count} storyboard panels (minimum 2, maximum 8). "
        f"Ensure each panel flows naturally from the previous one. "
        f"Return raw JSON array only, no markdown formatting."
    )

    for attempt in range(MAX_RETRIES):
        try:
            raw = await call_grok(api_key, system_prompt, user_prompt)
            data = clean_json_response(raw)

            check_prompt_safety(raw)

            if not isinstance(data, list):
                raise HTTPException(status_code=500, detail="Invalid LLM response format, expected JSON array")

            panels = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                scene = str(item.get("scene_description", ""))
                prompt_text = str(item.get("image_prompt", ""))
                check_prompt_safety(scene)
                check_prompt_safety(prompt_text)

                # 冲突检测
                scene_conflicts = detect_prompt_conflicts(scene)
                prompt_conflicts = detect_prompt_conflicts(prompt_text)

                if scene_conflicts or prompt_conflicts:
                    prompt_text = await rewrite_coherent_prompt(prompt_text, api_key)
                    check_prompt_safety(prompt_text)

                try:
                    panels.append(StoryboardPanel(
                        panel_number=item.get("panel_number", 0),
                        scene_description=scene,
                        image_prompt=prompt_text,
                    ))
                except Exception:
                    continue

            if not panels:
                raise HTTPException(status_code=500, detail="No valid panels generated")

            return StoryboardResponse(storyboard=panels)
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                system_prompt += "\n\nSAFETY OVERRIDE: Your response was rejected. ALL characters must be ADULTS 18+. REJECT any panel mentioning minors."
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"LLM call failed: {str(e)}")
