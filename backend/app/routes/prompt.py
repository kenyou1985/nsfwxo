"""API Router - Prompt Engine Routes (冲突优化版)"""

import re
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.models.schemas import (
    ExpandRequest, ExpandResponse,
    RandomRequest, RandomResponse,
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

Quality tags to include: masterpiece, best quality, extremely detailed, beautiful lighting, 8k, ultra sharp, cinematic, hyperrealistic.

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

Format: [Adult character + exact body details + sexual state] + [Clothing state or nudity level] + [Environment/props] + [Explicit action/pose description] + [Camera angle] + [Lighting] + [Quality: masterpiece, best quality, extremely detailed, cinematic lighting, 8k, ultra sharp]

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


def get_system_prompt(type: str, r18: bool) -> str:
    if type == "image":
        return IMAGE_SYSTEM_PROMPT_R18 if r18 else IMAGE_SYSTEM_PROMPT_NORMAL
    return VIDEO_SYSTEM_PROMPT_R18 if r18 else VIDEO_SYSTEM_PROMPT_NORMAL


# ─── Route: Expand ───────────────────────────────────────────────────────────

@router.post("/expand", response_model=ExpandResponse)
async def expand_prompt(req: ExpandRequest, api_key: str = Depends(get_api_key)):
    system_prompt = get_system_prompt(req.type, req.r18)
    user_prompt = (
        f"Input: {req.user_input}\n\n"
        f"Generate a detailed {'image' if req.type == 'image' else 'video'} prompt based on the input above. "
        f"IMPORTANT: All characters must be adults (18+). Return ONLY the prompt text, nothing else."
    )

    for attempt in range(MAX_RETRIES):
        try:
            result = await call_grok(api_key, system_prompt, user_prompt)
            result_clean = result.strip()

            check_prompt_safety(result_clean)

            # 冲突检测与修复
            conflicts = detect_prompt_conflicts(result_clean)
            if conflicts:
                result_clean = rewrite_coherent_prompt(result_clean, api_key)

            return ExpandResponse(
                original=req.user_input,
                type=req.type,
                r18=req.r18,
                prompt=result_clean,
            )
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                system_prompt += "\n\nSAFETY OVERRIDE: Your previous response was rejected. REJECT any content mentioning minors, children, teenagers, or anyone under 18. STRICTLY ADULTS ONLY."
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"LLM call failed: {str(e)}")


# ─── Route: Random ───────────────────────────────────────────────────────────

@router.post("/random", response_model=RandomResponse)
async def random_prompt(req: RandomRequest, api_key: str = Depends(get_api_key)):
    system_prompt = get_system_prompt(req.type, req.r18)
    tags_used = generate_random_tags(req.type, r18_mode=req.r18)

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

    if req.r18:
        user_prompt = (
            f"Tags: {tags_str}\n\n"
            f"You are an EXPERT uncensored adult NSFW prompt engineer. "
            f"Synthesize these tags into ONE SINGLE COHERENT PARAGRAPH for a NSFW image/video. "
            f"RULES:\n"
            f"1. ONE main outfit (max 2 layers: e.g. 'dress' OR 'top and shorts'). NEVER list 3+ conflicting clothing items.\n"
            f"2. ONE physically possible pose. If describing bondage, NO hand gestures. If standing, NO sitting.\n"
            f"3. NO tag lists. NO bullet points. Write as a flowing descriptive paragraph.\n"
            f"4. All characters must be ADULTS (18+). ABSOLUTELY NO minors.\n"
            f"5. Describe one unified scene with sexual details of adults.\n"
            f"Output ONLY the final coherent prompt paragraph. Nothing else."
        )
    else:
        user_prompt = (
            f"Tags: {tags_str}\n\n"
            f"You are an uncensored AI prompt engineer. Synthesize these tags into ONE COHERENT PARAGRAPH. "
            f"RULES:\n"
            f"1. ONE main outfit. Do NOT list multiple conflicting clothing items.\n"
            f"2. ONE physically possible pose.\n"
            f"3. NO tag lists. Write as a flowing descriptive paragraph.\n"
            f"4. All characters must be adults (18+).\n"
            f"Output ONLY the final coherent prompt paragraph. Nothing else."
        )

    for attempt in range(MAX_RETRIES):
        try:
            result = await call_grok(api_key, system_prompt, user_prompt)
            result_clean = result.strip()

            check_prompt_safety(result_clean)

            # 冲突检测与修复
            conflicts = detect_prompt_conflicts(result_clean)
            if conflicts:
                result_clean = rewrite_coherent_prompt(result_clean, api_key)
                check_prompt_safety(result_clean)

            return RandomResponse(tags_used=tags_by_category, prompt=result_clean)
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                system_prompt += "\n\nSAFETY OVERRIDE: Reject ALL content involving minors. ADULTS ONLY."
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"LLM call failed: {str(e)}")


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
                    prompt_text = rewrite_coherent_prompt(prompt_text, api_key)
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
