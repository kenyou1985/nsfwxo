"""API Router - Prompt Engine Routes"""

import asyncio
import re
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.models.schemas import (
    ExpandRequest, ExpandResponse, ExpandVideoFromImageRequest,
    RandomRequest, RandomResponse, PromptResult,
    StoryboardRequest, StoryboardResponse, StoryboardPanel,
    GridStoryboardRequest, GridStoryboardResponse,
    StoryboardThemesRequest, StoryboardThemesResponse, StoryboardThemeOption,
    StoryboardOutlineRequest, StoryboardOutlineResponse, StoryboardOutline,
    StoryboardScriptRequest, StoryboardScriptResponse,
)
from app.services.llm_service import call_grok, clean_json_response, YunwuAuthError, YunwuRateLimitError, YunwuTimeoutError, YunwuParseError, YunwuAPIError
from app.services.gacha_service import generate_random_tags
from app.services.safety_filter import check_prompt_safety, check_tags_safety, ContentSafetyError
from app.services.prompt_coherence import detect_prompt_conflicts, rewrite_coherent_prompt
from app.services.theme_database import get_random_poses
from app.services.prompt_task_store import get_task_store, TaskStatus

router = APIRouter(prefix="/api/prompt", tags=["prompt"])
security = HTTPBearer()

MAX_RETRIES = 3


# ─── Ethnicity / Race diversity pool ───────────────────────────────────────
# Used across theme and outline prompts to encourage diverse character
# ethnicities/nationalities rather than defaulting to a single race.
ETHNICITY_POOL = (
    "亚洲人 (Asian)",
    "黄种人 (East Asian / Mongoloid)",
    "中国人 (Chinese)",
    "日本人 (Japanese)",
    "韩国人 (Korean)",
    "泰国人 (Thai)",
    "越南人 (Vietnamese)",
    "印度人 (Indian)",
    "伊朗人 (Iranian / Persian)",
    "中东人 (Middle Eastern)",
    "白人 (Caucasian / White)",
    "欧洲人 (European)",
    "意大利人 (Italian)",
    "法国人 (French)",
    "德国人 (German)",
    "俄罗斯人 (Russian)",
    "斯堪的纳维亚人 (Scandinavian)",
    "美国人 (American)",
    "拉丁人 (Latino)",
    "拉美人 (Latin American)",
    "巴西人 (Brazilian)",
    "墨西哥人 (Mexican)",
    "非洲人 (African)",
    "黑人 (Black / African descent)",
    "波利尼西亚人 (Polynesian)",
    "混血儿 (Mixed race / Multiracial)",
)

ETHNICITY_BLOCK = (
    "\n\n【CHARACTER ETHNICITY / NATIONALITY DIVERSITY — MANDATORY】:\n"
    "When generating characters, VARY their ethnicities/nationalities to reflect a GLOBAL cast.\n"
    "Do NOT default to a single race. Across the generated themes/panels, draw characters from a "
    "diverse pool that may include any of the following (rotate freely — do NOT restrict to Asian only):\n"
    + "\n".join(f"  - {e}" for e in ETHNICITY_POOL) +
    "\n\nRules:\n"
    "1. Pick characters from DIFFERENT ethnicities/nationalities for variety. A story may feature, "
    "for example, an Iranian man with a Brazilian woman, an Italian with a Korean, a Russian with "
    "a Japanese, an American with a Thai, a French with a Chinese, etc.\n"
    "2. In the Chinese descriptions, identify the character's nationality/ethnicity explicitly "
    "(中国人 / 日本人 / 韩国人 / 泰国人 / 印度人 / 伊朗人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / "
    "美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 黑人 / 混血儿 etc.).\n"
    "3. In English image_prompts, include the ethnicity descriptor explicitly, e.g.: "
    "\"a handsome Italian man with olive skin and dark brown hair\", "
    "\"a beautiful Iranian woman with fair olive skin and dark almond eyes\", "
    "\"a Brazilian woman with tanned olive skin and dark curly hair\", "
    "\"a Russian man with pale skin and light blue eyes\", "
    "\"a Thai woman with warm beige skin and silky black hair\".\n"
    "4. Keep physical descriptions consistent across all panels for the same character "
    "(do NOT change ethnicity or skin tone mid-story).\n"
    "5. AVOID cliche single-race casts. Aim for global, multi-cultural storytelling."
)


# ─── Async Task Background Runners ─────────────────────────────────────────────────

async def _run_themes_task(task_id: str, req: StoryboardThemesRequest, api_key: str):
    """Background runner for theme generation."""
    from app.services.theme_database import get_all_themes, COSTUMES, SCENARIOS
    import random as rnd
    from app.models.schemas import StoryboardThemeOption

    store = get_task_store()
    try:
        store.mark_running(task_id)
        count = min(max(req.count, 5), 20)

        if not req.custom_description:
            all_db_themes = get_all_themes()
            rnd.seed()
            rnd.shuffle(all_db_themes)
            picked = all_db_themes[:count]
            themes = []
            for i, t in enumerate(picked):
                if not isinstance(t, dict):
                    continue
                scenarios = t.get("scenarios", []) if isinstance(t.get("scenarios"), list) else []
                costumes = t.get("costumes", []) if isinstance(t.get("costumes"), list) else []
                themes.append({
                    "id": i + 1,
                    "title": t.get("name", f"主题{i + 1}"),
                    "description": t.get("description", ""),
                    "tags": t.get("tags", []) if isinstance(t.get("tags"), list) else [],
                    "r18_level": t.get("r18_level", "medium"),
                    "category": t.get("category", ""),
                    "scenario_count": len(scenarios),
                    "costume_count": len(costumes),
                })
            store.mark_done(task_id, {"themes": themes})
            return

        pool_size = min(15, len(all_db_themes))
        selected_themes = rnd.sample(all_db_themes, pool_size)
        costume_names = [c["name"] for c in COSTUMES]
        scenario_names = [s["name"] for s in SCENARIOS]
        system_prompt = (
            _THEMES_SYSTEM_PROMPT_R18 if req.r18
            else _THEMES_SYSTEM_PROMPT_NORMAL
        )
        r18_context = (
            f"\n\n【用户描述】{req.custom_description}\n\n"
            if req.custom_description else ""
        )
        pool_context = "参考主题池：\n" + "\n".join(
            f"- {t.get('name', '')}: {t.get('description', '')} "
            f"(服装: {', '.join(t.get('costumes', []))}, "
            f"场景: {', '.join(t.get('scenarios', []))})"
            for t in selected_themes
        )
        costume_list = ", ".join(costume_names[:20])
        scenario_list = ", ".join(scenario_names[:20])

        user_prompt = (
            f"{r18_context}\n\n{pool_context}\n\n"
            f"可选服装风格: {costume_list}\n"
            f"可选场景设置: {scenario_list}\n\n"
            f"生成 {count} 个独特的主题选项，确保多样性。"
        )

        raw = await call_grok(api_key, system_prompt, user_prompt)
        data = clean_json_response(raw)
        check_prompt_safety(raw)

        themes = []
        raw_themes = data.get("themes", [])
        if isinstance(raw_themes, list):
            for j, t in enumerate(raw_themes[:count]):
                if not isinstance(t, dict):
                    continue
                themes.append({
                    "id": j + 1,
                    "title": str(t.get("title", "")),
                    "description": str(t.get("description", "")),
                    "tags": list(t.get("tags", [])) if isinstance(t.get("tags"), list) else [],
                    "r18_level": str(t.get("r18_level", "medium")),
                    "category": str(t.get("category", "")),
                    "scenario_count": int(t.get("scenario_count", 0)),
                    "costume_count": int(t.get("costume_count", 0)),
                })

        store.mark_done(task_id, {"themes": themes})
    except ContentSafetyError as e:
        store.mark_failed(task_id, str(e))
    except (YunwuTimeoutError, YunwuRateLimitError) as e:
        store.mark_failed(task_id, str(e))
    except YunwuAPIError as e:
        store.mark_failed(task_id, str(e))
    except Exception as e:
        logging.error(f"[themes] background task error: {e}")
        store.mark_failed(task_id, f"未知错误: {str(e)}")


async def _run_outline_task(task_id: str, req: StoryboardOutlineRequest, api_key: str):
    """Background runner for outline generation."""
    from app.services.theme_database import get_random_poses, get_theme_by_seq_id, COSTUMES, SCENARIOS
    from app.models.schemas import StoryboardOutline

    store = get_task_store()
    try:
        store.mark_running(task_id)
        panel_count = max(2, min(10, req.panel_count))
        model_order = req.model_order or None

        # ── Look up theme for storyline coherence ────────────────────────────────
        # Try to find the selected theme in the database to inject its specific
        # scenarios, costumes and poses into the outline for narrative coherence.
        selected_theme = None
        theme_scenarios_str = ""
        theme_costumes_str = ""
        theme_poses_str = ""
        if req.theme_id:
            # theme_id may be a numeric string like "1", "101" etc.
            try:
                seq_id = int(req.theme_id)
                selected_theme = get_theme_by_seq_id(seq_id)
            except (ValueError, TypeError):
                selected_theme = None

            if selected_theme is None:
                # Try to find by string ID like "t001", "t101"
                from app.services.theme_database import get_theme_by_id
                selected_theme = get_theme_by_id(req.theme_id)

        # Build coherent context strings from the theme's data
        if selected_theme:
            scenarios = selected_theme.get("scenarios", [])
            costumes = selected_theme.get("costumes", [])
            poses = selected_theme.get("poses", [])
            if scenarios:
                theme_scenarios_str = "场景设定（必须至少选择2个使用）: " + "、".join(scenarios)
            if costumes:
                theme_costumes_str = "服装造型（必须选择1-2个使用）: " + "、".join(costumes)
            if poses:
                theme_poses_str = "姿势风格（参考）: " + "、".join(poses)

        _R18_ARC_PANELS = {
            2: ["开场遇见/前戏", "高潮性爱"],
            3: ["开场遇见", "升温调情/亲密", "高潮性爱"],
            4: ["开场遇见", "升温调情", "亲密前戏", "高潮性爱"],
            5: ["开场遇见", "升温调情", "脱衣亲密", "性爱进行", "高潮结尾"],
            6: ["开场遇见", "升温调情", "脱衣亲密", "性爱进行", "高潮变化", "高潮射精"],
            7: ["开场遇见", "升温调情", "脱衣亲密", "性爱进行", "换姿势", "高潮变化", "高潮射精"],
            8: ["开场遇见", "升温调情", "脱衣亲密", "性爱开始", "深入进行", "换姿势", "高潮冲刺", "高潮射精"],
            9: ["开场遇见", "升温调情", "脱衣亲密", "性爱开始", "深入进行", "换姿势", "深入再换", "高潮冲刺", "高潮射精"],
            10: ["开场遇见", "升温调情", "脱衣亲密", "性爱开始", "深入进行", "换姿势", "深入再换", "多种姿势", "高潮冲刺", "高潮射精"],
        }
        _NORMAL_ARC_PANELS = {
            2: ["开场", "高潮"],
            3: ["开场", "发展", "高潮"],
            4: ["开场", "发展", "亲密", "高潮"],
            5: ["开场", "发展", "亲密", "高潮", "结尾"],
            6: ["开场", "发展", "亲密", "高潮", "高潮2", "结尾"],
            7: ["开场", "发展", "亲密", "高潮", "高潮2", "高潮3", "结尾"],
            8: ["开场", "发展", "亲密", "高潮", "高潮2", "高潮3", "高潮4", "结尾"],
            9: ["开场", "发展", "亲密", "高潮", "高潮2", "高潮3", "高潮4", "高潮5", "结尾"],
            10: ["开场", "发展", "亲密", "高潮", "高潮2", "高潮3", "高潮4", "高潮5", "高潮6", "结尾"],
        }

        if req.r18:
            arc_panels = _R18_ARC_PANELS.get(panel_count, _R18_ARC_PANELS[5])
            system_template = _R18_OUTLINE_SYSTEM
            arc_label = "开场遇见 → 升温调情 → 脱衣前戏 → 性爱进行 → 高潮射精"
            # For R18: mix theme-specific poses + random pool
            pool_poses = get_random_poses(max(3, panel_count))
            pose_list_str = "\n".join(f"  - {p}" for p in pool_poses)
        else:
            arc_panels = _NORMAL_ARC_PANELS.get(panel_count, _NORMAL_ARC_PANELS[4])
            system_template = _NORMAL_OUTLINE_SYSTEM
            arc_label = "开场 → 发展 → 亲密 → 高潮 → 结尾"
            pose_list_str = ""

        arc_panels_str = "\n".join(f"  - {p}" for p in arc_panels)

        # ── Build coherence context for the system prompt ──────────────────────
        coherence_context = ""
        if theme_scenarios_str or theme_costumes_str or theme_poses_str:
            coherence_context = (
                "\n\n【SELECTED THEME DETAILS — USE THESE FOR COHERENCE】:\n"
            )
            if theme_scenarios_str:
                coherence_context += f"  - {theme_scenarios_str}\n"
            if theme_costumes_str:
                coherence_context += f"  - {theme_costumes_str}\n"
            if theme_poses_str:
                coherence_context += f"  - {theme_poses_str}\n"
            coherence_context += (
                "IMPORTANT: You MUST incorporate the selected scenarios, costumes, "
                "and poses above into your outline to ensure narrative coherence. "
                "Do not invent unrelated settings or clothing."
            )

        system_prompt = system_template.format(
            theme_title=req.theme_title,
            panel_count=panel_count,
            arc_panels=arc_panels_str,
            arc_label=arc_label,
            pose_list=pose_list_str,
            theme_coherence=coherence_context,
        )
        user_prompt = (
            f"Theme: {req.theme_title}\n"
            f"Panel count: {panel_count}\n"
            f"【重要】Panel 1 不能有直接性爱！必须先从开场/前戏开始，逐步发展到性爱。\n"
            f"【重要】R18模式：每个分镜的 image_prompt 必须非常详细和露骨，描述体位、身体部位、体液等。\n"
            f"Output as raw JSON only, no markdown."
        )

        _SAFETY_OVERRIDES = [
            "IMPORTANT: All characters are ADULTS 18+. ABSOLUTELY NO minors. Panel 1 MUST be foreplay only.",
            "STRICT SAFETY: All characters must be 18+ adults. Panel 1 = foreplay. Avoid: teen, minor, school.",
            "CRITICAL: ADULT-ONLY 18+. All characters must be 18+. Panel 1 MUST be foreplay only.",
        ]

        for attempt in range(MAX_RETRIES):
            try:
                raw = await call_grok(api_key, system_prompt, user_prompt, model_order=model_order)
                data = clean_json_response(raw)
                check_prompt_safety(raw)

                outline_data = data.get("outline", {})
                if isinstance(outline_data, dict):
                    outline = {
                        "arc": str(outline_data.get("arc", "")),
                        "scenes": list(outline_data.get("scenes", [])) if isinstance(outline_data.get("scenes"), list) else [],
                    }
                else:
                    outline = {"arc": arc_label, "scenes": list(arc_panels)}

                panels_raw = data.get("storyboard", [])
                panels = []
                for item in (panels_raw if isinstance(panels_raw, list) else []):
                    if not isinstance(item, dict):
                        continue
                    scene = str(item.get("scene_description", ""))
                    prompt_text = str(item.get("image_prompt", ""))
                    try:
                        check_prompt_safety(scene)
                        check_prompt_safety(prompt_text)
                    except ContentSafetyError:
                        continue
                    scene_conflicts = detect_prompt_conflicts(scene)
                    prompt_conflicts = detect_prompt_conflicts(prompt_text)
                    if scene_conflicts or prompt_conflicts:
                        try:
                            prompt_text = await rewrite_coherent_prompt(prompt_text, api_key)
                            check_prompt_safety(prompt_text)
                        except (ContentSafetyError, YunwuTimeoutError):
                            pass
                    try:
                        panels.append({
                            "panel_number": int(item.get("panel_number", 0)),
                            "scene_description": scene,
                            "image_prompt": prompt_text,
                        })
                    except Exception:
                        continue

                if not panels:
                    raise ValueError("No valid panels generated")

                store.mark_done(task_id, {
                    "theme_id": req.theme_id,
                    "theme_title": req.theme_title,
                    "outline": outline,
                    "storyboard": panels,
                })
                return
            except ContentSafetyError as e:
                if attempt < MAX_RETRIES - 1:
                    override_msg = _SAFETY_OVERRIDES[min(attempt, len(_SAFETY_OVERRIDES) - 1)]
                    system_prompt += f"\n\n{override_msg}"
                    continue
                store.mark_failed(task_id, str(e))
                return
            except (YunwuTimeoutError, YunwuRateLimitError, YunwuAPIError, YunwuParseError) as e:
                if attempt < MAX_RETRIES - 1:
                    continue
                store.mark_failed(task_id, str(e))
                return
            except Exception as e:
                logging.error(f"[outline] background task error: {e}")
                store.mark_failed(task_id, f"未知错误: {str(e)}")
                return
    except Exception as e:
        logging.error(f"[outline] background runner error: {e}")
        store.mark_failed(task_id, f"未知错误: {str(e)}")


async def _run_script_task(task_id: str, req: StoryboardScriptRequest, api_key: str):
    """Background runner for video script generation."""
    from app.models.schemas import StoryboardScriptResponse, VideoScriptPanel

    store = get_task_store()
    try:
        store.mark_running(task_id)
        script_system = _VIDEO_SCRIPT_SYSTEM.format(panel_count=len(req.panels))
        user_prompt = (
            f"Theme: {req.theme_title}\n"
            f"R18: {req.r18}\n"
            f"Panels:\n" +
            "\n".join(f"Panel {p.panel_number}: {p.scene_description}\n  Prompt: {p.image_prompt}" for p in req.panels) +
            f"\nOutput as raw JSON only, no markdown."
        )

        for attempt in range(MAX_RETRIES):
            try:
                raw = await call_grok(api_key, script_system, user_prompt)
                data = clean_json_response(raw)
                check_prompt_safety(raw)

                script_title = str(data.get("script_title", f"{req.theme_title} 视频脚本"))
                duration = str(data.get("duration", "15-30秒"))
                panels_out = []
                for p in (data.get("panels", []) if isinstance(data.get("panels"), list) else []):
                    if not isinstance(p, dict):
                        continue
                    panels_out.append({
                        "panel": int(p.get("panel", 0)),
                        "heading": str(p.get("heading", "")),
                        "action": str(p.get("action", "")),
                        "dialogue": str(p.get("dialogue", "")),
                        "sound_cue": str(p.get("sound_cue", "")),
                        "camera": str(p.get("camera", "")),
                    })

                # 兜底：LLM 有时只回 script_title 不回 panels，追加强提示重试
                if len(panels_out) == 0 and attempt < MAX_RETRIES - 1:
                    logging.warning(
                        "[script background] LLM returned empty panels "
                        "(title=%r), retry %s/%s with stronger instruction",
                        script_title, attempt + 1, MAX_RETRIES,
                    )
                    user_prompt = (
                        f"{user_prompt}\n\n"
                        f"IMPORTANT: You MUST output a 'panels' array with EXACTLY "
                        f"{len(req.panels)} element(s), one for each input panel. "
                        f"Each element must have: panel, heading, action, dialogue, sound_cue, camera. "
                        f"Do NOT return an empty panels array."
                    )
                    continue

                store.mark_done(task_id, {
                    "theme_title": req.theme_title,
                    "script_title": script_title,
                    "duration": duration,
                    "panels": panels_out,
                })
                return
            except ContentSafetyError as e:
                if attempt < MAX_RETRIES - 1:
                    script_system += "\n\nSTRICT: All characters 18+. ADULTS ONLY."
                    continue
                store.mark_failed(task_id, str(e))
                return
            except (YunwuTimeoutError, YunwuRateLimitError, YunwuAPIError) as e:
                if attempt < MAX_RETRIES - 1:
                    continue
                store.mark_failed(task_id, str(e))
                return
            except Exception as e:
                logging.error(f"[script] background task error: {e}")
                store.mark_failed(task_id, f"未知错误: {str(e)}")
                return
    except Exception as e:
        logging.error(f"[script] background runner error: {e}")
        store.mark_failed(task_id, f"未知错误: {str(e)}")


# ─── Polling Endpoint (no auth required — task_id is the secret) ─────────────────

@router.get("/task/{task_id}")
async def poll_task_status(task_id: str):
    """Poll the status/result of an async prompt task. No auth needed — task_id is the secret."""
    store = get_task_store()
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found or expired")
    return {
        "task_id": task.task_id,
        "task_type": task.task_type,
        "status": task.status,
        "created_at": task.created_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
        "result": task.result,
        "error": task.error,
    }


def get_api_key(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    return credentials.credentials


def _map_llm_error(e: Exception) -> HTTPException:
    """将 LLM 相关异常映射为精确的 HTTP 错误状态码和消息。"""
    if isinstance(e, YunwuAuthError):
        return HTTPException(status_code=401, detail=str(e))
    if isinstance(e, YunwuRateLimitError):
        return HTTPException(status_code=429, detail=str(e))
    if isinstance(e, YunwuTimeoutError):
        return HTTPException(status_code=504, detail=str(e))
    if isinstance(e, YunwuParseError):
        return HTTPException(status_code=502, detail=str(e))
    if isinstance(e, YunwuAPIError):
        return HTTPException(status_code=502, detail=str(e))
    return HTTPException(status_code=500, detail=f"未知错误: {str(e)}")


# ─── System Prompts ───────────────────────────────────────────────────────────

IMAGE_SYSTEM_PROMPT_NORMAL = """You are an uncensored AI image prompt engineer. Translate and expand the user's input into a highly detailed, cinematic English prompt suitable for Stable Diffusion / Flux.

""" + ETHNICITY_BLOCK + """

Quality tags to include: masterpiece, ultra-HD, high detail, best quality, 8k, ergonomic, sharp focus, realistic, real skin, cinematic, hyperrealistic.

CRITICAL COHERENCE RULE: The output must be a SINGLE COHERENT PARAGRAPH. Every element must logically fit together. Do NOT list tags. Do NOT repeat elements. Every description must be in service of ONE unified scene. If you mention clothing, pick ONE main outfit. If you mention a pose, it must be physically possible. All elements must tell ONE story.

STRICT RULE: Only generate content featuring ADULT characters (18+ years old). Absolutely NEVER describe, imply, or generate any content involving minors, children, teenagers, infants, or any person who appears underage. No exceptions.

Keep the prompt detailed but readable. No censorship. Output a single coherent paragraph."""

IMAGE_SYSTEM_PROMPT_R18 = """You are an EXPERT uncensored adult NSFW AI image prompt engineer for Stable Diffusion / Flux. Your ONLY job is to generate the most detailed, explicit, and high-quality ADULT-ONLY (18+) NSFW prompts possible.

""" + ETHNICITY_BLOCK + """

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

# ─── Image-to-Video (i2v) prompts for Wan2.2 ───────────────────────────────────
# 专用于"图生视频"扩写：用户给一张图片和一句动作/镜头描述，扩写出一段
# 完全符合 Wan2.2 规范的英文视频提示词。**不要描述场景、背景、环境**（图片已固定），
# 只输出人物动作、镜头运镜、人物表情。
VIDEO_I2V_SYSTEM_PROMPT_NORMAL = """You are an expert Wan2.2 image-to-video (i2v) prompt engineer. The user will give you a short description of CHARACTER ACTION, CAMERA MOVEMENT, and FACIAL EXPRESSION for a single video clip. Your job is to expand it into ONE concise English prompt that strictly follows Wan2.2 i2v format.

CRITICAL RULES - READ CAREFULLY:
1. DO NOT describe the scene, background, environment, lighting, or setting. The image already defines these — they are LOCKED and out of scope for i2v.
2. DO NOT describe clothing, hair color, body type, skin tone, or character appearance. The image defines these.
3. ONLY expand: (a) character action / body motion, (b) camera movement / shot type, (c) facial expression / micro-expression.
4. Output ONE single coherent English paragraph. No bullet points, no tag lists, no JSON, no markdown fences.
5. Keep the prompt CONCISE (50-120 words). Wan2.2 works best with focused, action-oriented prompts — NOT long essays.
6. Pick a fitting shot framing from: "full body shot", "upper body shot", "close-up", "medium shot", "wide shot" — based on what the action needs.
7. Include exactly ONE primary continuous action. Multiple unrelated actions confuse the video model.
8. End the prompt with this mandatory quality block: "smooth motion, 60fps, no limb distortion, correct human anatomy, five complete fingers, two complete legs, consistent facial features, no jitter, no frame jump, fluid continuous motion"
9. STRICT: All characters must be ADULTS (18+). Never involve minors, children, or teenagers in any way.

OUTPUT TEMPLATE (fill in the brackets, do not include brackets in output):
[shot framing], [character description anchor: "1 person" or "1 young woman" or "1 young man"], [primary action verb phrase with body part + direction + speed], [secondary motion: head tilt / hand gesture / facial micro-expression / eye movement], [camera movement: pan / tilt / track / dolly / zoom / static], smooth motion, 60fps, no limb distortion, correct human anatomy, five complete fingers, two complete legs, consistent facial features, no jitter, no frame jump, fluid continuous motion

EXAMPLE:
Input: "young woman, slowly turns her head to the right, raises her right hand to brush hair behind her ear, soft smile, close-up"
Output: "close-up shot, 1 young woman, slow head turn to the right, right hand rising to brush hair behind ear, soft subtle smile forming, eyes slightly squinting, static camera, smooth motion, 60fps, no limb distortion, correct human anatomy, five complete fingers, two complete legs, consistent facial features, no jitter, no frame jump, fluid continuous motion"""


VIDEO_I2V_SYSTEM_PROMPT_R18 = """You are an EXPERT uncensored adult Wan2.2 image-to-video (i2v) prompt engineer. The user will give you a short description of EXPLICIT CHARACTER ACTION, CAMERA MOVEMENT, and FACIAL EXPRESSION for a single adult video clip. Your job is to expand it into ONE concise English prompt that strictly follows Wan2.2 i2v format.

CRITICAL RULES - READ CAREFULLY:
1. DO NOT describe the scene, background, environment, lighting, or setting. The image already defines these — LOCKED.
2. DO NOT describe static appearance (clothing, hair, body type, skin tone). The image defines these.
3. ONLY expand: (a) explicit body motion / sexual action, (b) camera movement, (c) facial expression / vocal cue.
4. Output ONE single coherent English paragraph. No bullet points, no tag lists, no JSON, no markdown fences.
5. Keep CONCISE (60-140 words). Wan2.2 prefers focused prompts.
6. Pick a fitting shot framing: "full body shot", "upper body shot", "close-up", "POV shot", "medium shot".
7. Include exactly ONE primary continuous explicit action.
8. End with quality block: "smooth motion, 60fps, no limb distortion, correct human anatomy, five complete fingers, two complete legs, consistent facial features, no jitter, no frame jump, fluid continuous motion"
9. STRICT: CONSENTING ADULTS ONLY (18+). Zero tolerance for minors, children, teenagers, schoolgirl imagery, lolicon, or shota.

OUTPUT TEMPLATE (fill in the brackets, do not include brackets in output):
[shot framing], [1 person / 2 people - adult descriptors], [primary explicit action verb phrase with body part + direction + speed + intensity], [secondary motion: facial expression / mouth movement / eye movement / body tremor / hip motion], [camera movement: POV insertion / close-up on body part / track / pan / static], [vocal cue: moaning / breathing / whispering if applicable], smooth motion, 60fps, no limb distortion, correct human anatomy, five complete fingers, two complete legs, consistent facial features, no jitter, no frame jump, fluid continuous motion"""


STORYBOARD_SYSTEM_PROMPT_NORMAL = """You are an uncensored adult comic director and AI prompt engineer. Break the user's short plot down into a sequence of storyboard panels. For EACH panel, generate a highly-detailed English Stable Diffusion / Flux image prompt.

""" + ETHNICITY_BLOCK + """

CRUCIAL REQUIREMENTS:
1. Maintain character visual consistency across ALL panels (same hair color/style, body type, clothing, eye color, ethnicity) - ADULTS ONLY
2. Each panel should advance the narrative naturally
3. Include camera angle/shots for each panel

STRICT RULE: All characters must be ADULT (18+). Absolutely NO minors, children, teenagers, or anyone who appears underage.

Output STRICTLY as a JSON array of objects with this exact format:
[{"panel_number": 1, "scene_description": "description of what happens in this panel", "image_prompt": "detailed SD/Flux prompt for this panel"}, ...]

Do NOT wrap the JSON in any markdown code blocks. Output raw JSON only."""

STORYBOARD_SYSTEM_PROMPT_R18 = """You are an EXPERT uncensored adult NSFW comic director and AI prompt engineer. Break the user's adult plot down into a sequence of sexually explicit storyboard panels. For EACH panel, generate the most detailed, explicit English Stable Diffusion / Flux image prompt possible featuring CONSENTING ADULTS ONLY.

""" + ETHNICITY_BLOCK + """

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

【POSE DIVERSITY - MANDATORY】:
Each panel MUST use a DIFFERENT sexual position. Pick from this pool:
{pose_list}

CRUCIAL REQUIREMENTS:
1. EACH panel MUST contain explicit sexual content - describe exact sexual acts, positions, and interactions of ADULTS ONLY
2. Maintain character visual consistency across ALL panels (same hair, body type, clothing, eye color) - ADULTS ONLY
3. Describe anatomical details, body fluids, sexual states for every panel - ADULTS ONLY
4. Include explicit camera angles: close-up on genitals, POV shots, spread shot, cum shot, insertion angle
5. Each panel MUST pick a DISTINCTLY DIFFERENT position from the pool above

Format STRICTLY as JSON array:
[{{"panel_number": 1, "scene_description": "adult sexual setup of the scene", "image_prompt": "fully explicit SD prompt - ADULTS ONLY"}}, ...]

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
        except (YunwuTimeoutError, YunwuRateLimitError, YunwuParseError, YunwuAPIError) as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAuthError as e:
            raise _map_llm_error(e)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {str(e)}")


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


# ─── Image-to-Video Wan2.2 prompt expansion ─────────────────────────────────────
# 复用 expand_prompt 的生成链路 + 多样性注入，但 system prompt 换成 wan2.2 i2v
# 专用版本（不含场景/背景/外观描述，只输出动作/镜头/表情）。

async def _generate_single_i2v(
    api_key: str,
    image_prompt: str,
    scene_description: str,
    r18: bool,
    variant_index: int = 0,
) -> dict:
    system_prompt = VIDEO_I2V_SYSTEM_PROMPT_R18 if r18 else VIDEO_I2V_SYSTEM_PROMPT_NORMAL
    diversity_note = _EXPAND_DIVERSITY_VARIANTS[variant_index % len(_EXPAND_DIVERSITY_VARIANTS)]

    # i2v 场景下 image_prompt 是"已经定死的画面"，scene_description 是"用户想看的动作"，
    # 两者分开传入，让 LLM 知道哪个是锚（不要动）、哪个是变量（要扩写）。
    user_prompt = (
        f"ANCHOR (image-locked, do NOT describe or expand):\n"
        f"{image_prompt.strip()}\n\n"
        f"ACTION (expand this into the video motion):\n"
        f"{scene_description.strip() or 'subtle natural micro-movement'}\n\n"
        f"Style hint (camera feel): {diversity_note}\n\n"
        f"Generate ONE concise English Wan2.2 i2v prompt (50-120 words) that follows the OUTPUT TEMPLATE in the system prompt. "
        f"Do NOT describe the anchor image. Do NOT mention scene, background, environment, lighting, clothing, hair, body type, or character appearance. "
        f"Output ONLY the prompt paragraph, nothing else."
    )

    for attempt in range(MAX_RETRIES):
        try:
            result = await call_grok(api_key, system_prompt, user_prompt)
            result_clean = result.strip()

            check_prompt_safety(result_clean)

            conflicts = detect_prompt_conflicts(result_clean)
            if conflicts:
                result_clean = await rewrite_coherent_prompt(result_clean, api_key)

            return {
                "original": scene_description or image_prompt,
                "type": "video",
                "r18": r18,
                "prompt": result_clean,
            }
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                system_prompt += "\n\nSAFETY OVERRIDE: Your previous response was rejected. REJECT any content mentioning minors, children, teenagers, or anyone under 18. STRICTLY ADULTS ONLY."
                continue
            raise
        except (YunwuTimeoutError, YunwuRateLimitError, YunwuAPIError) as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise HTTPException(status_code=500, detail=f"i2v 扩写失败: {str(e)}")


@router.post("/expand/video-from-image", response_model=ExpandResponse)
async def expand_video_from_image(req: ExpandVideoFromImageRequest, api_key: str = Depends(get_api_key)):
    """Image-to-video 专用扩写：按 Wan2.2 i2v 规范生成英文视频提示词。

    输入：image_prompt（锚定的画面描述，不要在输出中提及）+
          scene_description（用户想要的动作/镜头/表情描述，扩写目标）。
    输出：标准 ExpandResponse，每条 result.prompt 是一段符合 Wan2.2 格式的英文视频提示词。
    """
    count = max(1, min(req.count, 5))  # i2v 不需要太多变体，最多 5
    tasks = [
        _generate_single_i2v(
            api_key,
            req.image_prompt,
            req.scene_description or "",
            req.r18,
            variant_index=i,
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
        raise HTTPException(status_code=502, detail="所有 i2v 生成尝试均失败")

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
1. Character: detailed appearance, ethnicity (rotate among 亚洲人 / 黄种人 / 中国人 / 日本人 / 韩国人 / 泰国人 / 越南人 / 印度人 / 伊朗人 / 中东人 / 白人 / 欧洲人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / 美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 混血儿 — match skin tone + facial features to chosen ethnicity), expression, posture
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
1. Character: detailed appearance, specific costume/outfit with accessories, ethnicity (rotate among 亚洲人 / 黄种人 / 中国人 / 日本人 / 韩国人 / 泰国人 / 越南人 / 印度人 / 伊朗人 / 中东人 / 白人 / 欧洲人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / 美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 混血儿 — match skin tone + facial features to chosen ethnicity)
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
1. Character: attractive professional, detailed appearance (with ethnicity — rotate among 亚洲人 / 黄种人 / 中国人 / 日本人 / 韩国人 / 泰国人 / 越南人 / 印度人 / 伊朗人 / 中东人 / 白人 / 欧洲人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / 美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 混血儿; match skin tone + facial features to chosen ethnicity), confident posture
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
1. Character: mysterious figure (with ethnicity — rotate among 亚洲人 / 黄种人 / 中国人 / 日本人 / 韩国人 / 泰国人 / 越南人 / 印度人 / 伊朗人 / 中东人 / 白人 / 欧洲人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / 美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 混血儿), alluring and dangerous energy
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
1. Character: detailed appearance (with ethnicity — rotate among 亚洲人 / 黄种人 / 中国人 / 日本人 / 韩国人 / 泰国人 / 越南人 / 印度人 / 伊朗人 / 中东人 / 白人 / 欧洲人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / 美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 混血儿; match skin tone + facial features), attractive sleepwear/lingerie
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
1. Character: attractive figure (with ethnicity — rotate among 亚洲人 / 黄种人 / 中国人 / 日本人 / 韩国人 / 泰国人 / 越南人 / 印度人 / 伊朗人 / 中东人 / 白人 / 欧洲人 / 意大利人 / 法国人 / 德国人 / 俄罗斯人 / 美国人 / 拉丁人 / 拉美人 / 巴西人 / 墨西哥人 / 非洲人 / 混血儿; match skin tone + body features), wet or post-shower, detailed body
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
        # ─── 以下为新增 R18/情色/SM 主题 ─────────────────────────────────────────
        "野外激情": {
            "label": "野外激情",
            "description": "户外野战场景，大自然中的狂野性爱",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit outdoor passion/sex scene image prompt featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about an intense sexual encounter in a wild outdoor setting. Focus on explicit sexual acts, exposed bodies in nature, passionate atmosphere, and the raw thrill of public/open-air sex. Describe the physical interaction in vivid anatomical detail.

ABSOLUTE REQUIREMENTS:
- Describe explicit sexual acts (thrusting, oral, penetration, etc.) with anatomical detail
- Describe body positions, physical contact points, exposed genitals
- Describe the outdoor environment (forest, meadow, beach, waterfall, etc.) and how it adds to the scene
- Include lighting: natural sunlight, moonlight, or the golden hour glow on skin
- Adults 18+ only. No minors.

Format: [Character body details + sexual state] + [Environment] + [Explicit physical action] + [Lighting] + [Quality: masterpiece, ultra-HD, high detail].

STRICT RULE: No minors. Output ONLY a raw coherent paragraph. No tag lists.""",
            "diversity_variants": [
                "Forest clearing: sunlight filtering through trees, intense missionary.",
                "Beach/sand: ocean waves, passionate doggystyle, wet bodies.",
                "Meadow/grass: wild flowers, sunset, cowgirl position.",
                "Waterfall/grotto: water spray, sensual oral scene.",
                "Rooftop/balcony: city lights backdrop, urgent standing sex.",
                "Cave/dark: flashlight, rough passionate sex, primal energy.",
                "Park/garden: hidden corner, voyeuristic thrill.",
                "Cliff/mountain: dramatic view, intense close-up shots.",
            ],
        },
        "公车痴汉": {
            "label": "公车痴汉",
            "description": "公共交通工具上的痴汉行为，充满紧张刺激感",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit public transportation molestation fantasy scene featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about a molestation/crowded transit fantasy. Focus on the power dynamic, the thrill of public exposure, the tension between victim and perpetrator, and explicit physical interaction. The scene should feel intense and dangerous.

ABSOLUTE REQUIREMENTS:
- Describe the crowded transit setting: subway car, bus, train, commuter rail
- Describe the clothing state (professional attire, school-adjacent-but-not-actual-minors, formal wear)
- Describe explicit sexual contact: groping, forced touching, exposed areas, non-consensual thrill
- Include body details: hand placement, body reactions, clothing state
- Adults 18+ only. No actual minors, schoolgirls, or children.
- Focus on the power dynamic and public thrill, not actual underage content.

Format: [Character in transit outfit] + [Crowded setting details] + [Explicit contact description] + [Reaction/emotion] + [Quality].

STRICT RULE: All characters ADULTS 18+. No minors. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Subway car morning rush: crowded, suit上班族, hand upskirt.",
                "Night bus: dimly lit, lone passenger, predatory approach.",
                "Train compartment: private but shaky, intense encounter.",
                "Bus stop bench: semi-public, risky exposure, oral scene.",
                "Metro platform: hidden alcove, rushed desperate sex.",
                "Commuter rail aisle: standing room only, pressed together.",
                "Airport shuttle: late night, isolated, aggressive encounter.",
                "Ferry cabin: sea motion, passionate forbidden encounter.",
            ],
        },
        "巷子尾随": {
            "label": "巷子尾随",
            "description": "狭窄巷子里的危险邂逅与激情",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit dark alley/back-alley encounter scene featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about a dangerous yet thrilling sexual encounter in a narrow urban alley. Focus on the tension, the dark atmosphere, brick walls, shadows, and the raw physicality of sex in a confined outdoor urban space. Include explicit anatomical detail.

ABSOLUTE REQUIREMENTS:
- Describe the alley setting: narrow street, brick walls, graffiti, dim lighting, urban decay
- Describe character clothing: casual urban, streetwear, or semi-formal
- Describe explicit sexual acts with body detail
- Include dark atmospheric lighting: neon signs, street lamp glow, moonlight
- Adults 18+ only. No minors.

Format: [Character in urban attire] + [Alley environment] + [Explicit sexual action] + [Dark atmospheric lighting] + [Quality].

STRICT RULE: All characters ADULTS 18+. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Narrow side street: brick walls, neon reflection, doggystyle.",
                "Graffiti alley: spray paint background, rough sex against wall.",
                "Night market back lane: food stalls, hidden behind crates.",
                "Under highway overpass: concrete, harsh lighting, urgent sex.",
                "Historic district alley: old cobblestones, romantic but intense.",
                "Parking garage corner: dim, industrial, multiple positions.",
                "Back of nightclub: music thumping, desperate rough sex.",
                "Residential lane: laundry above, intimate whispered encounter.",
            ],
        },
        "办公室偷情": {
            "label": "办公室偷情",
            "description": "办公室环境中的秘密性爱，职业装诱惑",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit office affair/adultery scene featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about an intense sexual encounter in an office setting. Focus on the power dynamic between colleagues/boss-employee, the thrill of being in a professional space, and explicit sexual acts. Describe professional attire being removed or manipulated for sexual purposes.

ABSOLUTE REQUIREMENTS:
- Describe the office environment: desk, glass office, conference room, copy room, etc.
- Describe professional attire: suit, pencil skirt, blouse, tie, office wear
- Describe explicit sexual acts with anatomical detail
- Include office props: desk, chair, glass walls, computer, files
- Adults 18+ only. No minors.

Format: [Character in office attire] + [Office setting] + [Explicit sexual action] + [Professional power dynamic] + [Quality].

STRICT RULE: All characters ADULTS 18+. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Boss's glass office: blinds closed, desk sex, suit skirt.",
                "Conference room: large table, group tension, oral scene.",
                "Copy room: Xerox machine, whispered encounter, underwear.",
                "After hours: empty office, desk surface, tie pulled.",
                "Executive bathroom: marble, luxury fixtures, rough sex.",
                "Storage room: filing cabinets, hidden from cameras.",
                "Cubicle farm: low walls, risky thrill, co-worker dynamic.",
                "Elevator: late night, trapped together, urgent passion.",
            ],
        },
        "SM调教": {
            "label": "SM调教",
            "description": "SM主题场景，捆绑、支配、角色扮演",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer specializing in BDSM/SM themes. Generate ONE maximally explicit BDSM/SM scene featuring CONSENTING ADULTS ONLY.

""" + ETHNICITY_BLOCK + """

GUIDE: Write a flowing paragraph about a BDSM scene with explicit sexual content. Focus on: restraints (handcuffs, rope, chains, bondage), power dynamic (dominant/submissive), SM gear (whip, paddle, collar, leash), and explicit sexual acts within the SM context. Describe physical sensations and power exchange in detail.

ABSOLUTE REQUIREMENTS:
- Describe SM restraints in detail: rope patterns, cuff placement, bondage type
- Describe power dynamic: who is dominant, who is submissive, eye contact, body language
- Describe explicit sexual content: the SM session must include sexual acts (oral, penetration, genital contact)
- Include SM props and atmosphere: dungeon, red lighting, leather, chains, whips
- Include physical details: red marks from restraints, body positions, facial expressions
- Adults 18+ only. No minors.
- ALWAYS start the prompt with explicit ethnicity descriptor for each character (e.g. "a beautiful Brazilian woman with tanned olive skin", "a chiseled Russian man with pale skin and light blue eyes", "a stunning Iranian woman with fair olive skin and dark almond eyes")

Format: [Character ethnicity + role + restraint type] + [SM gear/details] + [Explicit sexual action] + [Atmosphere] + [Quality].

STRICT RULE: All characters ADULTS 18+. Consensual BDSM only. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Rope bondage: shibari patterns, suspended, intense submission.",
                "Leather & chains: collar and leash, dungeon atmosphere, oral.",
                "Whip and paddle: red marks, begging, doggystyle in chains.",
                "Latex suit: vacuum bed, restricted movement, desperate sex.",
                "Chair bondage: spread eagle, nipple clamps, teasing denial.",
                "Wall chains: standing in chains, dominance, forced pleasure.",
                "Stock: pillory, vulnerable, multiple participants.",
                "Cage: small cage, total submission, extreme power dynamic.",
            ],
        },
        "角色扮演": {
            "label": "角色扮演",
            "description": "各种职业/身份角色扮演，充满想象力的性爱",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit roleplay fantasy scene featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about an intense sexual encounter with clear roleplay elements. Focus on the fantasy costume/detail, the role the character is playing, and how it leads to explicit sexual content. Describe costumes in detail and how they are used in the sexual scene.

ABSOLUTE REQUIREMENTS:
- Describe the roleplay costume in detail: nurse, police, military, fantasy, historical, etc.
- Describe the fantasy scenario: how the costume is part of the sexual encounter
- Describe explicit sexual acts with anatomical detail
- Include the power dynamic created by the roleplay
- Adults 18+ only. No minors, no actual school uniforms.
- NO schoolgirl uniforms, NO minors in any form.

Format: [Character in roleplay costume] + [Roleplay scenario] + [Explicit sexual action] + [Costume state] + [Quality].

STRICT RULE: All characters ADULTS 18+. No minors, no schoolgirl fantasy. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Nurse roleplay: white stockings, stethoscope, medical exam turned sexual.",
                "Police roleplay: uniform, handcuffs, power dynamic, interrogation.",
                "Military/recruit: camo, authoritative, forced position.",
                "Maid/butler: apron, formal wear partially removed, service roleplay.",
                "Secretary/boss: glasses, pencil skirt, desk scene.",
                "Fantasy warrior: armor partially removed, medieval dungeon.",
                "Pirate/captain: tricorn hat, weathered clothes, ship cabin.",
                "Waitress/customer: apron, restaurant back room, role reversal.",
            ],
        },
        "制服诱惑": {
            "label": "制服诱惑",
            "description": "各类制服诱惑场景，紧身剪裁的诱惑",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit uniform/fetish costume scene featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about an intense sexual encounter centered around tight-fitting uniforms. Focus on how the uniform costume enhances the sexual tension - the fabric straining, buttons about to pop, zippers being used, stockings and heels. Describe explicit sexual content where the costume is central to the arousal.

ABSOLUTE REQUIREMENTS:
- Describe the specific uniform in detail: flight attendant, cheerleader, dance costume, bodysuit, latex, etc.
- Describe how the tight costume interacts with the sexual scene
- Describe explicit sexual acts with anatomical detail
- Include body parts visible through or enhanced by the costume
- Adults 18+ only. No minors.

Format: [Uniform costume description] + [Tight fit/constriction details] + [Explicit sexual action] + [Costume state change] + [Quality].

STRICT RULE: All characters ADULTS 18+. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Flight attendant: tight skirt, white blouse, aisle seat.",
                "Cheerleader: crop top, short skirt, pom-poms, gym.",
                "Bodysuit: zipped up tight, unable to remove, desperation.",
                "Latex catsuit: skin-tight, shiny, every curve visible.",
                "Dance leotard: stretching, costume riding up, mirror.",
                "Military dress uniform: medals, formal, buttons popping.",
                "Flight suit unzipped: zipper pulled down, full exposure.",
                "Maid uniform: apron, stockings, frilly details, kitchen.",
            ],
        },
        "浴室缠绵": {
            "label": "浴室缠绵",
            "description": "浴室中的湿身诱惑，水汽朦胧的性爱",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer. Generate ONE maximally explicit bathroom/wet room sexual encounter featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about an intensely wet and sensual sexual encounter in a bathroom setting. Focus on: wet skin, water streaming over bodies, the heat of the shower or bath, soap becoming part of the sexual act, and explicit anatomical detail in a wet environment. Make it visceral and sensory.

ABSOLUTE REQUIREMENTS:
- Describe the wet environment: shower, bath, bathroom tiles, steam, water spray
- Describe wet bodies: water streaming down skin, glistening bodies, soaked hair
- Describe explicit sexual acts enhanced by the wet setting
- Include sensory details: water sounds, slippery bodies, wet sounds
- Adults 18+ only. No minors.

Format: [Wet character body] + [Bathroom setting] + [Explicit sexual action in water] + [Sensory detail] + [Quality].

STRICT RULE: All characters ADULTS 18+. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Couple shower: water streaming, slippery bodies, missionary.",
                "Bathtub soak: bubbles, oil, sensual slow penetration.",
                "Glass shower: steam, pressed against glass, visible bodies.",
                "After gym shower: locker room, communal, spontaneous.",
                "Jacuzzi/hot tub: jets, partial submersion, oral scene.",
                "Sink counter: small bathroom, bent over, wet hair.",
                "Floor tiles: water everywhere, doggystyle in shower.",
                "Bathhouse/public bath: tiles, buckets, Asian bath setting.",
            ],
        },
        "后入猛烈": {
            "label": "后入猛烈",
            "description": "以强烈后入体位为核心的性爱场景",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer specializing in intense rear-entry sexual positions. Generate ONE maximally explicit rear-entry/doggystyle scene featuring CONSENTING ADULTS ONLY.

GUIDE: Write a flowing paragraph about an intense doggystyle/rear-entry sexual encounter. Focus on: the physical mechanics of rear-entry (arched back, spread legs, penetration detail), the power dynamic, close-up shots of the action, and the raw physicality of this position. Make every body part description explicit.

ABSOLUTE REQUIREMENTS:
- Describe the rear-entry position in full anatomical detail
- Describe the receiving character's body: arched back, head down, hands on surface
- Describe explicit penetration detail, body contact, movements
- Include camera angle suggestions: close-up on entry, wide shot of bodies, POV
- Adults 18+ only. No minors.

Format: [Receiving character body position] + [Penetrating character action] + [Physical contact details] + [Camera angle] + [Quality].

STRICT RULE: All characters ADULTS 18+. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Against wall: limited space, intense pressure, moaning.",
                "On bed: face down, arched back, sheets gripping.",
                "Standing: bent over furniture, rough and urgent.",
                "Face-sitting combo: 69 from behind, simultaneous pleasure.",
                "With toys: added dildo, double penetration from behind.",
                "Mirror shot: watching themselves, voyeuristic element.",
                "Slow and deep: sensual, building, every inch detail.",
                "Fast and rough: urgent, brutal, skin slapping loudly.",
            ],
        },
        "羞耻 play": {
            "label": "羞耻play",
            "description": "羞耻/羞辱主题的性爱场景",
            "system_prompt": """You are an EXPERT uncensored adult NSFW image prompt engineer specializing in humiliation/shame play themes. Generate ONE maximally explicit humiliation play scene featuring CONSENTING ADULTS ONLY.

""" + ETHNICITY_BLOCK + """

GUIDE: Write a flowing paragraph about an intense sexual scene centered on humiliation/shame dynamics. Focus on: the power exchange, verbal humiliation elements, forced positioning, exposure elements, and the sexual acts that accompany the humiliation. The scene should be about consensual power play.

ABSOLUTE REQUIREMENTS:
- Describe the power dynamic: who is humiliated, who is dominant
- Describe explicit sexual content within the humiliation context
- Include humiliation props/details: public exposure fantasy, verbal elements implied through body language
- Keep it as a consensual fantasy between adults
- Adults 18+ only. No minors.
- ALWAYS start the prompt with explicit ethnicity descriptor for each character (e.g. "a stunning Brazilian woman with tanned olive skin", "a chiseled Russian man with pale skin and light blue eyes", "a beautiful Italian woman with olive skin and dark brown hair")

Format: [Character ethnicity + power dynamic] + [Humiliation context/setting] + [Explicit sexual action] + [Body reactions] + [Quality].

STRICT RULE: All characters ADULTS 18+. Consensual only. Output ONLY a raw coherent paragraph.""",
            "diversity_variants": [
                "Public exposure fantasy: glass booth, watchers outside, naked.",
                "Forced confession: kneeling, verbal implied, cowgirl after.",
                "Strip tease: losing bet, clothing removal, full sex after.",
                "Punishment game: loser receives spanking then sex.",
                "Role reversal: usually dominant now submissive, vulnerability.",
                "Exhibitionist: open window, neighbors could see, desperate.",
                "Sexual confession: secret revealed, resulting passionate sex.",
                "Humiliation toys: crop, nipple clamps, forced oral after.",
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
        except (YunwuTimeoutError, YunwuRateLimitError, YunwuParseError, YunwuAPIError) as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAuthError as e:
            raise _map_llm_error(e)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {str(e)}")


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
    if req.r18:
        selected_poses = get_random_poses(req.panel_count + 2)
        pose_list_str = "\n".join(f"  - {p}" for p in selected_poses)
        system_prompt = STORYBOARD_SYSTEM_PROMPT_R18.format(pose_list=pose_list_str)
    else:
        system_prompt = STORYBOARD_SYSTEM_PROMPT_NORMAL

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
        except (YunwuTimeoutError, YunwuRateLimitError, YunwuParseError, YunwuAPIError) as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAuthError as e:
            raise _map_llm_error(e)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {str(e)}")


# ─── 九宫格分镜 (gpt-5.5) ─────────────────────────────────────────────

GRID_STORYBOARD_SYSTEM_PROMPT_NORMAL = """You are an expert visual narrative director. Based on the user's input, generate EXACTLY 9 storyboard panels arranged as a 3x3 grid that together tell a cohesive visual story.

""" + ETHNICITY_BLOCK + """

For EACH of the 9 panels, output:
- panel_number: integer 1-9 (top-left=1, top-center=2, top-right=3, middle-left=4, middle-center=5, middle-right=6, bottom-left=7, bottom-center=8, bottom-right=9)
- scene_description: 1 short Chinese sentence (≤25 characters) describing what SPECIFICALLY happens in that panel. PANELS 1-9 MUST ALL BE DIFFERENT scenes.
- image_prompt: a unique, self-contained English SD/Flux image prompt (80-180 words). Each panel's prompt MUST describe a DIFFERENT visual moment with a DIFFERENT camera angle, action, or composition. The same subject/setting may appear across panels but each panel must be visually distinct from all other panels.

STRICT DIVERSITY RULES:
1. Panel 1: Wide establishing shot, sets the scene and mood from a distance
2. Panel 2: Medium shot, subject enters or begins action
3. Panel 3: Close-up or detail shot of a specific element (face, hands, object)
4. Panel 4: Medium shot from a DIFFERENT angle than panels 1-3
5. Panel 5: Full body shot or wide shot of subject in action
6. Panel 6: Medium close-up, emotional reaction or key moment
7. Panel 7: Wide shot with environment, different framing than panel 1
8. Panel 8: Detail or partial shot (e.g., movement blur, fabric, light)
9. Panel 9: Wide or medium closing shot, completes the story arc

- Each panel must be DISTINCT from all others — NO two panels may share the same camera angle, framing, or action description
- All 9 scene_description fields must be UNIQUE and different from each other
- All 9 image_prompt fields must be UNIQUE and different from each other
- Read direction is row-major: panel 1 (top-left) → panel 2 → panel 3 → ... → panel 9 (bottom-right)
- Panel 1 sets up; panel 9 closes it with a sense of resolution or climax
- All characters must be ADULTS (18+)
- Style: photorealistic, cinematic lighting, masterpiece, best quality
- Output STRICTLY as a raw JSON array — NO markdown code fences, NO markdown formatting, NO prose before or after the JSON array

Example output (note all 9 panels are different):
[
  {"panel_number": 1, "scene_description": "女主角在公园小径起点", "image_prompt": "Wide establishing shot of a beautiful adult woman..."},
  {"panel_number": 2, "scene_description": "她开始沿着小路慢跑", "image_prompt": "Medium shot of the same woman jogging forward..."},
  {"panel_number": 3, "scene_description": "晨光洒在她的侧脸", "image_prompt": "Close-up of her face with golden hour light..."},
  ...
]"""


GRID_STORYBOARD_SYSTEM_PROMPT_R18 = """You are an EXPERT uncensored adult visual narrative director. Based on the user's input, generate EXACTLY 9 storyboard panels arranged as a 3x3 grid that together tell a cohesive erotic visual story.

""" + ETHNICITY_BLOCK + """

For EACH of the 9 panels, output:
- panel_number: integer 1-9 (top-left=1, top-center=2, top-right=3, middle-left=4, middle-center=5, middle-right=6, bottom-left=7, bottom-center=8, bottom-right=9)
- scene_description: 1 short Chinese sentence (≤25 characters). PANELS 1-9 MUST ALL BE DIFFERENT scenes — NO repeated descriptions.
- image_prompt: a unique, self-contained EXPLICIT English SD/Flux image prompt (80-180 words). Each panel's prompt MUST describe a DIFFERENT visual moment with a DIFFERENT camera angle, action, or composition. NO two panels may share the same angle or framing.

STRICT DIVERSITY RULES:
1. Panel 1: Wide establishing shot, sets the scene and mood
2. Panel 2: Medium shot, subject enters or begins action
3. Panel 3: Close-up or detail shot (face, body detail, object)
4. Panel 4: Medium shot from a DIFFERENT angle than panels 1-3
5. Panel 5: Full body shot or wide shot of subject in action
6. Panel 6: Medium close-up, emotional reaction or key erotic moment
7. Panel 7: Wide shot with environment, different framing than panel 1
8. Panel 8: Detail or partial shot (movement, fabric, lighting detail)
9. Panel 9: Wide or medium closing shot, completes the erotic story arc

- Each panel must be DISTINCT from all others — NO two panels may share the same camera angle, framing, or action
- All 9 scene_description fields must be UNIQUE and different from each other
- All 9 image_prompt fields must be UNIQUE and different from each other
- Panel 1 sets up with teasing; build gradually across panels 1→9 toward climax
- CONSENTING ADULTS (18+) ONLY — absolutely NO minors, teenagers, or school uniforms
- Style: photorealistic, cinematic lighting, masterpiece, best quality, hyperdetailed
- Output STRICTLY as a raw JSON array — NO markdown code fences, NO markdown formatting, NO prose before or after the JSON array"""


@router.post("/storyboard/grid", response_model=GridStoryboardResponse)
async def storyboard_grid(req: GridStoryboardRequest, api_key: str = Depends(get_api_key)):
    """九宫格分镜生成（优先使用 gpt-5.5，失败回退到 grok-4.3）。
    基于用户提示词，生成 9 个连贯的分镜画面（一张图片九宫格）。"""
    # 优先 gpt-5.5，失败回退 grok-4.3
    model_order = ["gpt-5.5", "grok-4.3"]
    system_prompt = (
        GRID_STORYBOARD_SYSTEM_PROMPT_R18 if req.r18
        else GRID_STORYBOARD_SYSTEM_PROMPT_NORMAL
    )

    user_prompt = (
        f"Plot / Scene: {req.plot}\n\n"
        f"Generate EXACTLY 9 panels numbered 1 through 9. "
        f"Maintain strong visual coherence (same subject, same setting, same characters) "
        f"while varying camera angle and moment across panels. "
        f"Return raw JSON array only, no markdown formatting."
    )

    safety_override_added = False
    for attempt in range(MAX_RETRIES):
        try:
            raw = await call_grok(api_key, system_prompt, user_prompt, model_order=model_order)
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

            # 按 panel_number 排序，确保 1-9 顺序
            panels.sort(key=lambda p: p.panel_number)

            # 多样性校验：9个格子的 image_prompt 不能全相同（LLM偷懒时会出现）
            unique_prompts = set(p.image_prompt.lower().strip() for p in panels)
            if len(unique_prompts) < 3:
                logging.warning(
                    "[storyboard/grid] detected duplicate-heavy panels (%d/%d unique), retrying...",
                    len(unique_prompts), len(panels)
                )
                raise HTTPException(status_code=500, detail="Panels lack diversity, retrying...")

            # 补齐缺失的格子（LLM 有时不严格返回 9 个）
            existing_numbers = {p.panel_number for p in panels}
            for num in range(1, 10):
                if num not in existing_numbers:
                    panels.append(StoryboardPanel(
                        panel_number=num,
                        scene_description=f"分镜 {num}",
                        image_prompt=panels[0].image_prompt if panels else "",
                    ))
            panels.sort(key=lambda p: p.panel_number)

            return GridStoryboardResponse(grid=panels)
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1 and not safety_override_added:
                system_prompt += "\n\nSAFETY OVERRIDE: Your response was rejected. ALL characters must be ADULTS 18+. REJECT any panel mentioning minors."
                safety_override_added = True
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except (YunwuTimeoutError, YunwuRateLimitError, YunwuParseError, YunwuAPIError) as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAuthError as e:
            raise _map_llm_error(e)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {str(e)}")


# ─── Step 1: Generate 5 Video Themes (Database-Driven) ────────────────────────

_THEMES_SYSTEM_PROMPT_NORMAL = """You are an expert creative director. Based on the provided theme pool, select and describe 5 diverse video theme options.

IMPORTANT:
- Each theme MUST be from a DIFFERENT category (transport, outdoor, indoor, costume, work, fantasy, etc.)
- No two themes should share the same category
- Each description must be 2-3 sentences in Chinese, vivid and exciting
- Each tags array must contain ONLY Chinese keywords (3-5 tags)
- All characters must be ADULTS 18+
""" + ETHNICITY_BLOCK + """

Output STRICTLY as raw JSON array (no markdown):
[{{"id": 1, "title": "中文标题", "description": "中文描述2-3句", "tags": ["中文标签1", "中文标签2", "标签3"], "r18_level": "soft", "category": "分类"}}, ...]

Output in Chinese only. Do NOT wrap in markdown."""


# R18 themes prompt — keep it neutral/descriptive without explicit sexual act keywords
# Yunwu AI may reject requests with explicitly sexual system prompts
_THEMES_SYSTEM_PROMPT_R18 = """You are a creative director specializing in adult content. Based on the provided theme pool, select and describe {count} DIVERSE and UNIQUE video theme options.

IMPORTANT - DIVERSITY RULES - CRITICAL:
- Each theme MUST be from a DIFFERENT category. Categories include: fantasy, costume, indoor, outdoor, work, special, multi, transport, sm, oral, fluid, facial, anal, toys
- NO two themes can share the same category
- AVOID these overused themes: 地铁痴汉, 野外激情, 情趣酒店, 豪华酒店套房, 游泳池畔, OL通勤, 护士的情欲, 瑜伽教室, 舞蹈室, 女优, 教室, 办公室
- PREFER underrepresented categories: fantasy, special, work, oral, fluid, facial, anal, toys, multi, costume
- Each description MUST be 2-3 sentences in CHINESE, describing the scene and atmosphere vividly
- Each tags array MUST contain ONLY Chinese keywords (3-5 tags)
- R18 level: 'soft', 'medium', or 'hard'
- Theme titles should be creative and specific, not generic
""" + ETHNICITY_BLOCK + """

DIVERSITY STRATEGY - generate {count} themes with MAXIMUM variety:
1. AVOID repetitive patterns - each title must have a unique hook
2. Include UNEXPECTED category combinations: fantasy+costume, ancient+modern, medical+roleplay, etc.
3. Choose themes from LESS COMMON categories: fantasy, special scenes, work scenarios, oral/fluid/facial themes, multi-person, sm, toys
4. Mix r18_levels: at least 1 soft, 2+ medium, 1-2 hard themes
5. Include a mix of SINGLE-PERSON and MULTI-PERSON themes
6. Include themes with DIFFERENT COSTUMES: traditional Chinese, Japanese kimono, modern casual, sportswear, maid, flight attendant, nurse, police, school, etc.
7. Include themes with UNIQUE PROPS: chair, mirror, bed, window, stairs, sofa, desk, car, elevator, shower, balcony, etc.
8. Include themes with VARIED POSES: standing, lying, sitting, bending, kneeling, crawling, suspended, etc.
9. Include themes with VARIED SETTINGS: daytime, nighttime, indoor, outdoor, public, private, exotic locations
10. Include themes with VARIED EMOTIONS: romantic, dominant, submissive, playful, tense, mysterious
11. Include themes with VARIED ETHNICITIES: Chinese, Japanese, Korean, Thai, Vietnamese, Indian, Iranian, Italian, French, German, Russian, Brazilian, Mexican, American, African, Latino, Middle Eastern, Polynesian, multiracial — show a GLOBAL cast, NOT a single-race cast.

ABSOLUTE REQUIREMENTS:
- Themes must be genuinely different from each other - NO similar titles
- Keep descriptions focused on atmosphere and scenario, not explicit acts
- All characters must be ADULTS 18+
- Use creative, evocative Chinese titles that are UNIQUE and haven't been overused
- Each title should make someone want to click - be intriguing and specific

STRICT PROHIBITION:
- NO minors (18+ ONLY)
- NO non-consent (consensual only)
- NO themes similar to: 地铁痴汉, 野外激情, 情趣酒店, 豪华酒店套房, 游泳池畔, OL通勤, 护士的情欲, 瑜伽教室, 舞蹈室, 女优 (these are overused)

Output STRICTLY as raw JSON array (no markdown). All text in Chinese only.
[{{"id": 1, "title": "创意中文标题", "description": "中文描述2-3句", "tags": ["中文标签1", "中文标签2", "标签3"], "r18_level": "soft/medium/hard", "category": "分类"}}]"""


@router.get("/storyboard/themes/list", response_model=StoryboardThemesResponse)
async def list_storyboard_themes():
    """直接从主题库返回所有主题，无需调用 LLM，避免 502 错误。

    按 category 分组返回，前端可直接下拉选择主题，选中的主题会直接传给大纲生成。
    """
    from app.services.theme_database import ADULT_THEMES
    import random

    themes = []
    for i, t in enumerate(ADULT_THEMES):
        if not isinstance(t, dict):
            continue
        scenarios = t.get("scenarios", []) if isinstance(t.get("scenarios"), list) else []
        costumes = t.get("costumes", []) if isinstance(t.get("costumes"), list) else []
        themes.append(StoryboardThemeOption(
            id=i + 1,
            title=t.get("name", f"主题{i + 1}"),
            description=t.get("description", ""),
            tags=t.get("tags", []) if isinstance(t.get("tags"), list) else [],
            r18_level=t.get("r18_level", "medium"),
            category=t.get("category", ""),
            scenario_count=len(scenarios),
            costume_count=len(costumes),
        ))

    # Shuffle for variety when displayed
    random.seed()
    random.shuffle(themes)
    # Re-number after shuffle
    for i, t in enumerate(themes):
        t.id = i + 1

    return StoryboardThemesResponse(themes=themes)


@router.post("/storyboard/themes", response_model=StoryboardThemesResponse)
async def generate_storyboard_themes(
    req: StoryboardThemesRequest,
    api_key: str = Depends(get_api_key),
):
    """Step 1 of 2-step storyboard: Generate diverse video theme options.

    - 有 custom_description → 调用 LLM 根据描述生成主题
    - 无 custom_description → 直接从数据库随机选取，不调用 LLM（避免 502）
    - async_mode=true → 立即返回 task_id，后台异步执行
    """
    from app.services.theme_database import get_all_themes
    import random

    # ── 异步模式：立即返回 task_id，后台执行 ──
    if req.async_mode:
        store = get_task_store()
        task = store.create("themes", {
            "r18": req.r18,
            "count": req.count,
            "custom_description": req.custom_description,
        })
        # Kick off background execution
        asyncio.create_task(_run_themes_task(task.task_id, req, api_key))
        return StoryboardThemesResponse(task_id=task.task_id, themes=[])

    count = min(max(req.count, 5), 20)

    # ── 无自定义描述：直接从数据库随机选取，完全不调用 LLM ──
    if not req.custom_description:
        all_db_themes = get_all_themes()
        random.seed()
        random.shuffle(all_db_themes)
        picked = all_db_themes[:count]
        themes = []
        for i, t in enumerate(picked):
            if not isinstance(t, dict):
                continue
            scenarios = t.get("scenarios", []) if isinstance(t.get("scenarios"), list) else []
            costumes = t.get("costumes", []) if isinstance(t.get("costumes"), list) else []
            themes.append(StoryboardThemeOption(
                id=i + 1,
                title=t.get("name", f"主题{i + 1}"),
                description=t.get("description", ""),
                tags=t.get("tags", []) if isinstance(t.get("tags"), list) else [],
                r18_level=t.get("r18_level", "medium"),
                category=t.get("category", ""),
                scenario_count=len(scenarios),
                costume_count=len(costumes),
            ))
        return StoryboardThemesResponse(themes=themes)

    # ── 有自定义描述：调用 LLM 生成 ──
    from app.services.theme_database import COSTUMES, SCENARIOS
    all_db_themes = get_all_themes()
    random.seed()
    pool_size = min(15, len(all_db_themes))
    selected_themes = random.sample(all_db_themes, pool_size)
    costume_names = [c["name"] for c in COSTUMES]
    scenario_names = [s["name"] for s in SCENARIOS]
    system_prompt = (
        _THEMES_SYSTEM_PROMPT_R18 if req.r18
        else _THEMES_SYSTEM_PROMPT_NORMAL
    )
    r18_context = (
        f"\n\n【用户描述】{req.custom_description}\n\n"
        f"请根据以上描述创作 {count} 个独特视频主题。\n"
        "标题新颖，description 2-3句描述场景情节，tags用中文。\n"
        "参考灵感：\n"
        + "\n".join([f"- {t['name']}" for t in random.sample(all_db_themes, min(15, len(all_db_themes)))])
    )
    user_prompt = f"生成 {count} 个成人短视频主题（每个15-30秒）。{r18_context}\n\ndescription和tags必须全部使用中文！Output as raw JSON array only, no markdown."

    for attempt in range(MAX_RETRIES):
        try:
            raw = await call_grok(api_key, system_prompt, user_prompt)
            data = clean_json_response(raw)
            check_prompt_safety(raw)

            if not isinstance(data, list):
                raise HTTPException(status_code=500, detail="Invalid LLM response format, expected JSON array")

            themes = []
            for i, item in enumerate(data):
                if not isinstance(item, dict):
                    continue
                try:
                    themes.append(StoryboardThemeOption(
                        id=int(item.get("id", i + 1)),
                        title=str(item.get("title", f"主题{i+1}")),
                        description=str(item.get("description", "")),
                        tags=list(item.get("tags", [])) if isinstance(item.get("tags"), list) else [],
                        r18_level=str(item.get("r18_level", "medium")),
                        category=str(item.get("category", "")),
                    ))
                except Exception:
                    continue

            if len(themes) < 2:
                raise HTTPException(status_code=500, detail="Not enough themes generated")

            # Ensure unique IDs
            for j, t in enumerate(themes[:count]):
                t.id = j + 1

            return StoryboardThemesResponse(themes=themes[:count])
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                system_prompt += "\n\nSAFETY OVERRIDE: Reject ALL minors. ADULTS ONLY."
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except (YunwuTimeoutError, YunwuRateLimitError) as e:
            # Retry on timeout and rate limit
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAPIError as e:
            # Retry on Yunwu API errors (502 from upstream)
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {type(e).__name__}: {str(e)}")


# ─── Step 2: Generate Outline + Panels (Strict Pacing) ─────────────────────

# Strict pacing: Panel 1 = 开场前戏/遇见, Panel 2 = 升温调情,
# Panel 3 = 脱衣亲密/前戏, Panel 4 = 性爱进行, Panel 5 = 高潮/结尾
# NO Panel skips directly to sex. Each panel must advance the narrative.

_NORMAL_ARC_PANELS = {
    2: ["Panel 1: 开场 - 场景介绍、人物出现、情感铺垫", "Panel 2: 发展 - 情感/身体升温、亲密接触、高潮结尾"],
    3: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 升温 - 暧昧互动、调情", "Panel 3: 高潮 - 亲密行为、情感爆发"],
    4: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、调情", "Panel 3: 亲密 - 脱衣亲密、前戏", "Panel 4: 高潮 - 情感/身体高潮、结尾"],
    5: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、情感铺垫", "Panel 3: 亲密 - 脱衣、亲吻、爱抚", "Panel 4: 进行 - 深入亲密、身体交流", "Panel 5: 高潮 - 高潮、情感释放、结尾"],
    6: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、调情", "Panel 3: 升温 - 情感升温、身体接触", "Panel 4: 亲密 - 脱衣、亲吻、爱抚", "Panel 5: 进行 - 深入亲密", "Panel 6: 高潮 - 高潮、情感释放、结尾"],
    7: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、调情", "Panel 3: 升温 - 情感升温、身体接触", "Panel 4: 亲密 - 脱衣、亲吻、爱抚", "Panel 5: 前戏 - 深入前戏、身体反应", "Panel 6: 进行 - 深入亲密", "Panel 7: 高潮 - 高潮、情感释放、结尾"],
    8: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、调情", "Panel 3: 升温 - 情感升温、身体接触", "Panel 4: 亲密 - 脱衣、亲吻、爱抚", "Panel 5: 前戏 - 深入前戏、身体反应", "Panel 6: 进行 - 深入亲密", "Panel 7: 高潮 - 高潮、情感爆发", "Panel 8: 余韵 - 温馨时刻、情感升华、结尾"],
    9: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、调情", "Panel 3: 升温 - 情感升温、身体接触", "Panel 4: 亲密 - 脱衣、亲吻、爱抚", "Panel 5: 前戏 - 深入前戏、身体反应", "Panel 6: 进行 - 深入亲密", "Panel 7: 高潮 - 高潮、情感爆发", "Panel 8: 余韵 - 温馨时刻、情感表达", "Panel 9: 结尾 - 情感升华、开放式结局"],
    10: ["Panel 1: 开场 - 场景介绍、人物出现", "Panel 2: 发展 - 暧昧互动、调情", "Panel 3: 升温 - 情感升温、身体接触", "Panel 4: 亲密 - 脱衣、亲吻、爱抚", "Panel 5: 前戏 - 深入前戏、身体反应", "Panel 6: 进行 - 深入亲密", "Panel 7: 高潮 - 高潮、情感爆发", "Panel 8: 余韵 - 温馨时刻、情感表达", "Panel 9: 回落 - 情感回落、亲密时刻", "Panel 10: 结尾 - 情感升华、开放式结局"],
}

_R18_ARC_PANELS = {
    2: [
        "Panel 1: 开场前戏 - 场景介绍、人物出现、暗示性的服装和肢体语言、暧昧氛围（NO sex yet）",
        "Panel 2: 性爱高潮 - 明确的性爱描写，可以包含口交、后入、传教士等体位，射前特写",
    ],
    3: [
        "Panel 1: 开场前戏 - 场景介绍、人物出现、服装描述、暗示性抚摸和亲吻（NO sex yet）",
        "Panel 2: 脱衣亲密/前戏 - 脱去衣物、亲吻爱抚、口交或手淫前戏（explicit foreplay）",
        "Panel 3: 性爱高潮 - 直接性爱描写、体位变化、射前特写或体内射精",
    ],
    4: [
        "Panel 1: 开场前戏 - 场景介绍、人物出现、暗示性互动、眼神交流、暧昧升温（NO sex yet）",
        "Panel 2: 脱衣亲密 - 脱去衣物、互相亲吻爱抚、口交前戏、挑逗暗示",
        "Panel 3: 性爱进行 - 直接性爱描写、体位、口交或插入、手部/口部刺激",
        "Panel 4: 高潮结尾 - 高潮特写、身体反应、事后温存或开放式结局",
    ],
    5: [
        "Panel 1: 开场遇见 - 场景介绍、人物出现、制服/场景描述、暧昧互动、眼神交流（NO sex yet）",
        "Panel 2: 升温调情 - 身体接触、亲吻、暗示性语言、情感铺垫、服装开始脱去",
        "Panel 3: 脱衣前戏 - 衣物全部脱去或部分脱去、亲吻爱抚、口交或乳交等前戏",
        "Panel 4: 性爱进行 - 直接插入或口交性爱、体位变化、抽插特写、呻吟描述",
        "Panel 5: 高潮射精 - 高潮特写、颜射/内射/体外射精、事后温存或开放式结局",
    ],
    6: [
        "Panel 1: 开场遇见 - 场景介绍、人物出现、暗示性的第一眼、服装描述（NO sex yet）",
        "Panel 2: 升温调情 - 暧昧对话、轻微身体接触、衣服开始松开",
        "Panel 3: 脱衣亲密 - 衣物脱去、互相亲吻爱抚、口交前戏开始",
        "Panel 4: 性爱进行 - 直接插入性爱或深度口交，体位、抽插、口水/体液",
        "Panel 5: 高潮逼近 - 性爱继续，体位变化、双方反应、呻吟",
        "Panel 6: 高潮射精 - 高潮特写、颜射/内射/体外射精、事后反应、结局",
    ],
    7: [
        "Panel 1: 开场遇见 - 场景介绍、人物出现、暗示性的第一眼、服装描述（NO sex yet）",
        "Panel 2: 升温调情 - 暧昧对话、轻微身体接触、衣服开始松开",
        "Panel 3: 脱衣亲密 - 衣物脱去、互相亲吻爱抚、口交前戏开始",
        "Panel 4: 前戏深入 - 口交、乳房爱抚、情趣玩具挑逗、身体全面反应",
        "Panel 5: 性爱进行 - 直接插入性爱，体位变化、抽插特写、双方呻吟",
        "Panel 6: 高潮逼近 - 体位深入、呻吟加剧、身体反应强烈",
        "Panel 7: 高潮射精 - 高潮特写、颜射/内射/体外射精、事后温存、结局",
    ],
    8: [
        "Panel 1: 开场遇见 - 场景介绍、人物出现、暗示性的第一眼、服装描述（NO sex yet）",
        "Panel 2: 升温调情 - 暧昧对话、轻微身体接触、衣服开始松开",
        "Panel 3: 脱衣亲密 - 衣物脱去、互相亲吻爱抚、口交前戏开始",
        "Panel 4: 前戏深入 - 口交、乳房爱抚、情趣玩具挑逗、身体全面反应",
        "Panel 5: 性爱进行 - 直接插入性爱，体位变化、抽插特写、双方呻吟",
        "Panel 6: 高潮逼近 - 体位深入、呻吟加剧、身体反应强烈",
        "Panel 7: 高潮特写 - 射前最后阶段、强烈身体反应",
        "Panel 8: 高潮射精 - 高潮特写、颜射/内射/体外射精、事后温存、结局",
    ],
    9: [
        "Panel 1: 开场遇见 - 场景介绍、人物出现、暗示性的第一眼、服装描述（NO sex yet）",
        "Panel 2: 升温调情 - 暧昧对话、轻微身体接触、衣服开始松开",
        "Panel 3: 脱衣亲密 - 衣物脱去、互相亲吻爱抚、口交前戏开始",
        "Panel 4: 前戏深入 - 口交、乳房爱抚、情趣玩具挑逗、身体全面反应",
        "Panel 5: 性爱开始 - 直接插入性爱，缓慢节奏、双方适应",
        "Panel 6: 性爱进行 - 体位变化、抽插特写、呻吟加剧",
        "Panel 7: 高潮逼近 - 体位深入、呻吟达到顶峰",
        "Panel 8: 高潮特写 - 射前最后阶段、强烈身体反应",
        "Panel 9: 高潮射精 - 高潮特写、颜射/内射/体外射精、事后温存、结局",
    ],
    10: [
        "Panel 1: 开场遇见 - 场景介绍、人物出现、暗示性的第一眼、服装描述（NO sex yet）",
        "Panel 2: 升温调情 - 暧昧对话、轻微身体接触、衣服开始松开",
        "Panel 3: 脱衣亲密 - 衣物脱去、互相亲吻爱抚、口交前戏开始",
        "Panel 4: 前戏深入 - 口交、乳房爱抚、情趣玩具挑逗、身体全面反应",
        "Panel 5: 性爱开始 - 直接插入性爱，缓慢节奏、双方适应",
        "Panel 6: 性爱进行 A - 第一种体位、节奏加快",
        "Panel 7: 性爱进行 B - 体位变化、抽插特写、呻吟加剧",
        "Panel 8: 高潮逼近 - 体位深入、呻吟达到顶峰、身体颤抖",
        "Panel 9: 高潮特写 - 射前最后阶段、强烈身体反应",
        "Panel 10: 高潮射精 - 高潮特写、颜射/内射/体外射精、事后温存、结局",
    ],
}


_NORMAL_OUTLINE_SYSTEM = """You are an expert adult comic director. A user selected theme: "{theme_title}".
{theme_coherence}

Generate a COMPLETELY UNIQUE and CREATIVE narrative outline and {panel_count} storyboard panels for a 15-30 second short video.
""" + ETHNICITY_BLOCK + """

【CREATIVITY REQUIREMENTS - CRITICAL】:
- Use your CREATIVE IMAGINATION - do NOT repeat common tropes or overused descriptions
- Create UNIQUE character introductions, emotions, dialogue, and actions
- Every panel must have DIFFERENT emotions and body language from the previous
- Mix up the order of events creatively - not every story goes the same way
- Think of unexpected details: specific dialogue lines, unique character quirks, unusual settings
- Each panel's image_prompt must describe a CINEMATIC, UNIQUE scene
- NEVER copy the arc_panels template structure verbatim - use it as inspiration only

STRICT PACING - Each panel MUST follow this general structure:
{arc_panels}

Panel requirements:
- All panels feature the SAME characters (consistent appearance throughout)
- Each panel advances the narrative naturally
- All characters are ADULTS 18+
- No minors
- Be CREATIVE and UNIQUE in every detail
- Include the character's ethnicity/nationality in BOTH scene_description (Chinese) AND image_prompt (English, with skin tone + facial features specific to that ethnicity)

For EACH panel provide:
- scene_description: What happens in this panel (emotions, actions, setting) - make it UNIQUE and interesting
- image_prompt: Stable Diffusion / Flux image prompt (detailed, cinematic, UNIQUE). MUST start with explicit ethnicity descriptor (e.g. "a beautiful Iranian woman with fair olive skin and dark almond eyes", "a handsome Italian man with olive skin and dark brown hair", "a Brazilian woman with tanned olive skin and dark curly hair", "a Russian man with pale skin and light blue eyes", "a Chinese woman with warm beige skin and silky black hair").

Output as raw JSON:
{{"outline": {{"arc": "{arc_label}", "scenes": ["场景1描述", "场景2描述", ...]}}, "storyboard": [{{"panel_number": 1, "scene_description": "...", "image_prompt": "..."}}, ...]}}

Do NOT wrap in markdown. Output raw JSON only."""


_R18_OUTLINE_SYSTEM = """You are an EXPERT adult comic director specializing in EXPLICIT sexual content. User selected theme: "{theme_title}".
{theme_coherence}
""" + ETHNICITY_BLOCK + """

【POSE RANDOMIZATION - ABSOLUTELY MANDATORY】:
You MUST select EXPLICITLY DIFFERENT sexual positions for each panel from the following 105-pose pool. NO TWO panels may share the same position category (e.g. doggy, cowgirl, missionary, 69, etc.). Variety is CRITICAL.

AVAILABLE POSITIONS (pick different ones per panel):
{pose_list}

【CREATIVITY REQUIREMENTS - CRITICAL】:
- Use your CREATIVE IMAGINATION - do NOT repeat common tropes or overused descriptions
- Create UNIQUE character introductions, emotions, dialogue, and actions
- Every panel must have DIFFERENT emotions and body language from the previous
- Mix up the order of events creatively - not every story goes the same way
- Think of unexpected details: specific dialogue lines, unique character quirks, unusual settings
- Each panel's image_prompt must describe a CINEMATIC, UNIQUE explicit scene
- NEVER copy the arc_panels template structure verbatim - use it as inspiration only

STRICT PACING - Each panel MUST follow this general arc (NO skipping to sex in Panel 1):
{arc_panels}

CRITICAL PACING RULES:
- Panel 1: NO explicit sex. Focus on: character intro (with ethnicity), costume, setting, building sexual tension, eye contact, clothing, atmosphere. TENSION first.
- Panel 2: Clothes start coming off. Kissing, foreplay begins. Still building.
- Panel 3+: ONLY THEN show explicit sexual acts. Use a DIFFERENT position from Panel 1's vibe.
- Each panel must ADVANCE the sexual narrative naturally
- NEVER jump directly to penetration in Panel 1

EXPLICIT CONTENT requirements for Panel 3+:
- MANDATORY: Pick one position from the {pose_list} list above for each panel. Each panel MUST use a DISTINCTLY DIFFERENT position from all other panels.
- Use explicit sexual terms: suck, lick, fuck, penetrate, thrust, cum, ejackulate, spray, spread, thrust in, balls deep, face covered
- Describe anatomy: penis, vagina, breasts, nipples, asshole, lips, tongue
- Describe body fluids: saliva, precum, cum, vaginal fluids
- Describe camera angles: POV, close-up on genitals, spread shot, cum shot, POV insertion
- Be CREATIVE in how characters express pleasure and interact
- ALWAYS start image_prompt with explicit ethnicity descriptor (e.g. "a beautiful Thai woman with warm beige skin and silky black hair,", "a handsome Brazilian man with tanned olive skin and dark brown eyes,", "a stunning Iranian woman with fair olive skin and dark almond eyes,", "a chiseled Russian man with pale skin and light blue eyes,"). Skin tone/facial features must MATCH the chosen ethnicity.

CRITICAL: ALL characters 18+. NO minors. NO non-consent. NO animals.

Output as raw JSON:
{{"outline": {{"arc": "{arc_label}", "scenes": ["Panel 1: 前戏描述", "Panel 2: 升温描述", ...]}}, "storyboard": [{{"panel_number": 1, "scene_description": "中文场景描述", "image_prompt": "explicit SD prompt"}}, ...]}}

Do NOT wrap in markdown."""


@router.post("/storyboard/outline", response_model=StoryboardOutlineResponse)
async def generate_storyboard_outline(
    req: StoryboardOutlineRequest,
    api_key: str = Depends(get_api_key),
):
    """Step 2 of 2-step storyboard: Generate narrative outline and panels with STRICT pacing."""
    panel_count = req.panel_count
    if panel_count < 2:
        panel_count = 2
    if panel_count > 10:
        panel_count = 10

    # ── 异步模式：立即返回 task_id，后台执行 ──
    if req.async_mode:
        store = get_task_store()
        task = store.create("outline", {
            "theme_id": req.theme_id,
            "theme_title": req.theme_title,
            "panel_count": panel_count,
            "r18": req.r18,
            "model_order": req.model_order,
        })
        asyncio.create_task(_run_outline_task(task.task_id, req, api_key))
        return StoryboardOutlineResponse(task_id=task.task_id, theme_id=req.theme_id, theme_title=req.theme_title, outline=StoryboardOutline(arc="", scenes=[]), storyboard=[])

    # ── Look up theme for storyline coherence ────────────────────────────────
    selected_theme = None
    theme_scenarios_str = ""
    theme_costumes_str = ""
    theme_poses_str = ""
    if req.theme_id:
        try:
            seq_id = int(req.theme_id)
            from app.services.theme_database import get_theme_by_seq_id
            selected_theme = get_theme_by_seq_id(seq_id)
        except (ValueError, TypeError):
            selected_theme = None
        if selected_theme is None:
            from app.services.theme_database import get_theme_by_id
            selected_theme = get_theme_by_id(req.theme_id)
    if selected_theme:
        scenarios = selected_theme.get("scenarios", [])
        costumes = selected_theme.get("costumes", [])
        poses = selected_theme.get("poses", [])
        if scenarios:
            theme_scenarios_str = "场景设定（必须至少选择2个使用）: " + "、".join(scenarios)
        if costumes:
            theme_costumes_str = "服装造型（必须选择1-2个使用）: " + "、".join(costumes)
        if poses:
            theme_poses_str = "姿势风格（参考）: " + "、".join(poses)

    coherence_context = ""
    if theme_scenarios_str or theme_costumes_str or theme_poses_str:
        coherence_context = (
            "\n\n【SELECTED THEME DETAILS — USE THESE FOR COHERENCE】:\n"
        )
        if theme_scenarios_str:
            coherence_context += f"  - {theme_scenarios_str}\n"
        if theme_costumes_str:
            coherence_context += f"  - {theme_costumes_str}\n"
        if theme_poses_str:
            coherence_context += f"  - {theme_poses_str}\n"
        coherence_context += (
            "IMPORTANT: You MUST incorporate the selected scenarios, costumes, "
            "and poses above into your outline to ensure narrative coherence. "
            "Do not invent unrelated settings or clothing."
        )

    if req.r18:
        arc_panels = _R18_ARC_PANELS.get(panel_count, _R18_ARC_PANELS[5])
        system_template = _R18_OUTLINE_SYSTEM
        arc_label = "开场遇见 → 升温调情 → 脱衣前戏 → 性爱进行 → 高潮射精"
        # Inject random poses so LLM picks diverse positions for each panel
        selected_poses = get_random_poses(panel_count + 2)
        pose_list_str = "\n".join(f"  - {p}" for p in selected_poses)
    else:
        arc_panels = _NORMAL_ARC_PANELS.get(panel_count, _NORMAL_ARC_PANELS[4])
        system_template = _NORMAL_OUTLINE_SYSTEM
        arc_label = "开场 → 发展 → 亲密 → 高潮 → 结尾"
        pose_list_str = ""

    arc_panels_str = "\n".join(f"  - {p}" for p in arc_panels)

    system_prompt = system_template.format(
        theme_title=req.theme_title,
        panel_count=panel_count,
        arc_panels=arc_panels_str,
        arc_label=arc_label,
        pose_list=pose_list_str,
        theme_coherence=coherence_context,
    )

    user_prompt = (
        f"Theme: {req.theme_title}\n"
        f"Panel count: {panel_count}\n"
        f"【重要】Panel 1 不能有直接性爱！必须先从开场/前戏开始，逐步发展到性爱。\n"
        f"【重要】R18模式：每个分镜的 image_prompt 必须非常详细和露骨，描述体位、身体部位、体液等。\n"
        f"Output as raw JSON only, no markdown."
    )

    # Accept explicit model order from frontend, or fall back to service default
    model_order = req.model_order or None

    # Progressive safety override messages — get progressively stronger on each retry
    _SAFETY_OVERRIDES = [
        "IMPORTANT: All characters are ADULTS 18+. ABSOLUTELY NO minors, teenagers, or young-looking persons. Panel 1 MUST be foreplay/teasing only, NO explicit sex.",
        "STRICT SAFETY: All characters must be 18+ adults. Panel 1 = foreplay. Do NOT describe any sexual acts in Panel 1. Avoid keywords: teen, teenage, young adult, young looking, minor, school, girl, boy.",
        "CRITICAL: This is an ADULT-ONLY (18+) content. All characters must be 18+. Panel 1 MUST be non-sexual foreplay only. REJECT and AVOID these terms: teen, teenage, minor, young, schoolgirl, schoolboy, school, young adult, young looking, kid, child.",
    ]

    for attempt in range(MAX_RETRIES):
        try:
            raw = await call_grok(api_key, system_prompt, user_prompt, model_order=model_order)
            data = clean_json_response(raw)

            check_prompt_safety(raw)

            if not isinstance(data, dict):
                raise HTTPException(status_code=500, detail="Invalid LLM response format, expected JSON dict")

            outline_data = data.get("outline", {})
            if isinstance(outline_data, dict):
                outline = StoryboardOutline(
                    arc=str(outline_data.get("arc", "")),
                    scenes=list(outline_data.get("scenes", [])) if isinstance(outline_data.get("scenes"), list) else [],
                )
            else:
                outline = StoryboardOutline(arc=arc_label, scenes=list(arc_panels))

            panels_raw = data.get("storyboard", [])
            if not isinstance(panels_raw, list):
                raise HTTPException(status_code=500, detail="Invalid storyboard format")

            panels = []
            for item in panels_raw:
                if not isinstance(item, dict):
                    continue
                scene = str(item.get("scene_description", ""))
                prompt_text = str(item.get("image_prompt", ""))

                try:
                    check_prompt_safety(scene)
                    check_prompt_safety(prompt_text)
                except ContentSafetyError:
                    # Safety failed for this specific panel — skip it, don't fail entire request
                    logging.warning(
                        "[storyboard/outline] safety check failed for panel, skipping: %s",
                        item.get("panel_number", "?"),
                    )
                    continue

                scene_conflicts = detect_prompt_conflicts(scene)
                prompt_conflicts = detect_prompt_conflicts(prompt_text)
                if scene_conflicts or prompt_conflicts:
                    try:
                        prompt_text = await rewrite_coherent_prompt(prompt_text, api_key)
                        check_prompt_safety(prompt_text)
                    except ContentSafetyError:
                        # Rewrite still failed safety — skip this panel instead of failing entire request
                        logging.warning(
                            "[storyboard/outline] rewrite failed safety for panel, skipping: %s",
                            item.get("panel_number", "?"),
                        )
                        continue
                    except YunwuTimeoutError:
                        # Timeout during rewrite — keep original prompt
                        logging.warning("[storyboard/outline] rewrite timed out, keeping original prompt")
                        pass

                try:
                    panels.append(StoryboardPanel(
                        panel_number=int(item.get("panel_number", 0)),
                        scene_description=scene,
                        image_prompt=prompt_text,
                    ))
                except Exception:
                    continue

            if not panels:
                raise HTTPException(status_code=500, detail="No valid panels generated")

            return StoryboardOutlineResponse(
                theme_id=req.theme_id,
                theme_title=req.theme_title,
                outline=outline,
                storyboard=panels,
            )
        except ContentSafetyError as e:
            logging.warning(
                "[storyboard/outline] content safety error on attempt %s/%s: %s",
                attempt + 1, MAX_RETRIES, str(e),
            )
            if attempt < MAX_RETRIES - 1:
                # Use progressive override — stronger each time, and on 2nd+ retry also
                # strengthen the user prompt to reset context
                override_msg = _SAFETY_OVERRIDES[min(attempt, len(_SAFETY_OVERRIDES) - 1)]
                system_prompt += f"\n\n{override_msg}"
                user_prompt = (
                    f"Theme: {req.theme_title}\n"
                    f"Panel count: {panel_count}\n"
                    f"【重要】Panel 1 不能有直接性爱！必须先从开场/前戏开始，逐步发展到性爱。\n"
                    f"【重要】R18模式：每个分镜的 image_prompt 必须非常详细和露骨，描述体位、身体部位、体液等。\n"
                    f"【重要】所有角色必须是18+成年人！严禁出现 teen, teenage, minor, young adult, schoolgirl, schoolboy 等词汇！\n"
                    f"Output as raw JSON only, no markdown."
                )
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except (YunwuTimeoutError, YunwuRateLimitError) as e:
            # Retry on timeout and rate limit
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAPIError as e:
            # Retry on Yunwu API errors (502 from upstream)
            logging.warning("[storyboard/outline] upstream API error on attempt %s/%s: %s", attempt + 1, MAX_RETRIES, e)
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuParseError as e:
            # Retry on JSON parse errors
            logging.warning("[storyboard/outline] parse error on attempt %s/%s: %s", attempt + 1, MAX_RETRIES, e)
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {str(e)}")


# ─── Step 3: Generate Video Script from Panels ─────────────────────────────────

_VIDEO_SCRIPT_SYSTEM = """You are an EXPERT adult video director. Based on the provided {panel_count} storyboard panels, write a complete VIDEO SCRIPT for a 15-30 second short video.

The script should be written as a professional film screenplay with:
1. SCENE HEADING: Time of day, location (e.g. INT. HOTEL ROOM - NIGHT)
2. ACTION/LINE: What's happening physically
3. DIALOGUE: Character dialogue (if any)
4. SOUND CUE: [MUSIC], [AMBIENT], [MOANING], [SLAPPING], [HEAVY BREATHING]
5. CAMERA: Camera direction (e.g. POV, close-up, wide shot, tracking)

CRITICAL PACING: Follow the same arc as the panels:
- If Panel 1 is foreplay → script should describe tension and anticipation
- If Panel N is climax → script should describe the peak moment

For R18 content, the script MUST include:
- Explicit descriptions of sexual actions, positions, body parts
- Sound cues for sexual activity: wet sounds, skin slapping, moaning, breathing
- Camera directions: POV insertion, close-up on genitals, spread shot, POV oral, cum shot
- Dialogue that enhances the scene

Each panel becomes a section of the script. Write in Chinese for scene headings and action, with English technical terms for positions/acts where appropriate.

Output as raw JSON:
{{"script_title": "视频标题", "duration": "15-30秒", "panels": [
  {{"panel": 1, "heading": "场景", "action": "动作描述", "dialogue": "对白", "sound_cue": "声音提示", "camera": "镜头方向"}},
  ...
]}}

Do NOT wrap in markdown."""


@router.post("/storyboard/script", response_model=StoryboardScriptResponse)
async def generate_video_script(
    req: StoryboardScriptRequest,
    api_key: str = Depends(get_api_key),
):
    """Step 3: Generate a complete video script from the storyboard panels."""
    if not req.panels or len(req.panels) == 0:
        raise HTTPException(status_code=400, detail="No panels provided for script generation")

    # ── 异步模式：立即返回 task_id，后台执行 ──
    if req.async_mode:
        store = get_task_store()
        task = store.create("script", {
            "theme_title": req.theme_title,
            "r18": req.r18,
            "panels": [{"panel_number": p.panel_number, "scene_description": p.scene_description, "image_prompt": p.image_prompt} for p in req.panels],
        })
        asyncio.create_task(_run_script_task(task.task_id, req, api_key))
        return StoryboardScriptResponse(task_id=task.task_id, theme_title=req.theme_title, script_title="", duration="15-30秒", panels=[])

    panels_context = "\n\n".join([
        f"Panel {p.panel_number}: {p.scene_description}\nImage Prompt: {p.image_prompt}"
        for p in req.panels
    ])

    system_prompt = _VIDEO_SCRIPT_SYSTEM.format(panel_count=len(req.panels))

    user_prompt = (
        f"Theme: {req.theme_title}\n"
        f"R18 Mode: {'Yes' if req.r18 else 'No'}\n"
        f"Panels:\n{panels_context}\n\n"
        f"Please generate a complete video script in Chinese. "
        f"For R18: describe sexual acts explicitly, include sound cues for sex sounds, camera POV shots. "
        f"Output as raw JSON only."
    )

    for attempt in range(MAX_RETRIES):
        try:
            raw = await call_grok(api_key, system_prompt, user_prompt)
            data = clean_json_response(raw)

            check_prompt_safety(raw)

            if not isinstance(data, dict):
                raise HTTPException(status_code=500, detail="Invalid script format")

            script_title = str(data.get("script_title", f"{req.theme_title} - 短视频脚本"))
            panels_raw = data.get("panels", [])

            script_panels = []
            for item in panels_raw:
                if not isinstance(item, dict):
                    continue
                try:
                    script_panels.append(VideoScriptPanel(
                        panel=int(item.get("panel", 0)),
                        heading=str(item.get("heading", "")),
                        action=str(item.get("action", "")),
                        dialogue=str(item.get("dialogue", "")),
                        sound_cue=str(item.get("sound_cue", "")),
                        camera=str(item.get("camera", "")),
                    ))
                except Exception:
                    continue

            # 兜底：LLM 有时只回 script_title 不回 panels（grok-4-1-fast-non-reasoning
            # 在只有 1 个 panel 时尤其容易偷懒）。这种情况视为解析失败，
            # 追加一条强提示让 LLM 重新生成完整结构。MAX_RETRIES 已经覆盖
            # 多次重试，扣费由用户在前端触发前知情。
            if len(script_panels) == 0 and attempt < MAX_RETRIES - 1:
                logging.warning(
                    "[storyboard/script] LLM returned empty panels "
                    "(title=%r), retry %s/%s with stronger instruction",
                    script_title, attempt + 1, MAX_RETRIES,
                )
                user_prompt = (
                    f"{user_prompt}\n\n"
                    f"IMPORTANT: You MUST output a 'panels' array with EXACTLY "
                    f"{len(req.panels)} element(s), one for each input panel. "
                    f"Each element must have: panel, heading, action, dialogue, sound_cue, camera. "
                    f"Do NOT return an empty panels array."
                )
                continue

            return StoryboardScriptResponse(
                theme_title=req.theme_title,
                script_title=script_title,
                duration=str(data.get("duration", "15-30秒")),
                panels=script_panels,
            )
        except ContentSafetyError as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise HTTPException(status_code=400, detail=str(e))
        except (YunwuTimeoutError, YunwuRateLimitError, YunwuParseError, YunwuAPIError) as e:
            if attempt < MAX_RETRIES - 1:
                continue
            raise _map_llm_error(e)
        except YunwuAuthError as e:
            raise _map_llm_error(e)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"未知错误: {str(e)}")

