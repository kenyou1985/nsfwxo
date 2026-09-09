"""LLM Service - Grok via OpenLux API 动态客户端封装"""

import asyncio
import base64
import json
import logging
import re
from typing import AsyncIterator, List, Optional, Union, Tuple

import httpx
from openai import AsyncOpenAI, APIError, AuthenticationError, RateLimitError

logger = logging.getLogger(__name__)

OPENLUX_BASE_URL = "https://api.openlux.ai/v1"
# 优化模型顺序：grok-4.6（优先）→ grok-4.3（第二，内容过滤较宽松）→ grok-4.5（第三兜底）
MODEL_NAME = "grok-4.6"
MODEL_FALLBACK = "grok-4.3"
MODEL_FALLBACK_2 = "grok-4.5"
# 优化超时：增加超时时间以处理大输出（主题大纲/分镜的 system prompt ~9KB，
# 输出 ~4-9KB JSON，加上多主题并行时的并发抢占，需要更宽松的客户端超时）。
# 60 秒在多主题并行（3 个主题 × 6 个分镜 × 4 并发信号量）下频繁被 httpx
# 在 LLM 完成之前砍掉，导致整个任务失败、退避重试、最终切换到 grok-4.3 后
# 又一次超时——用户看到的就是「大量错误、扣费了但一张大纲都没生成」。
# 提到 120 秒后 httpx 几乎不会再砍掉长输出。
REQUEST_TIMEOUT = 120  # 120 秒客户端超时
MAX_RETRIES = 2      # 保持 2 次重试，避免用户被多次扣费
_RETRY_BASE_DELAY = 1
# 增加到 16384 tokens 以支持更长的输出（避免截断问题）
MAX_COMPLETION_TOKENS = 16384


_REFUSAL_PATTERNS = [
    re.compile(r"i'?m sorry", re.I),
    re.compile(r"i cannot (?:comply|assist|help|provide)", re.I),
    re.compile(r"i'?m unable to", re.I),
    re.compile(r"cannot (?:fulfill|honor|process) this request", re.I),
    re.compile(r"violate[sd]? (?:content )?guidelines?", re.I),
    re.compile(r"content policy", re.I),
    re.compile(r"not (?:something )?i can (?:help|assist) with", re.I),
    re.compile(r"declined? this request", re.I),
    re.compile(r"unable to (?:fulfill|complete) this", re.I),
    re.compile(r"sorry, but i cannot", re.I),
    re.compile(r"as an ai, i (?:can'?t|cannot)", re.I),
    re.compile(r"(?:i|we) (?:must|have to|will) decline", re.I),
    re.compile(r"decline to (?:generate|assist|provide|comply)", re.I),
]


def _is_refusal(text: str) -> bool:
    if not text:
        return False
    for pat in _REFUSAL_PATTERNS:
        if pat.search(text):
            return True
    return False


def _salvage_truncated_json(text: str) -> tuple[Optional[str], bool]:
    """
    尝试从截断的文本中提取可用的 JSON。
    如果文本以 .... 结尾但 JSON 本身完整，视为正常返回（ends_with_dots=False）。
    如果 JSON 真的不完整（需要提取），返回 ends_with_dots=True。
    返回 (清理后的文本, 是否真正截断) 元组。
    - 如果 JSON 完整且可用，返回 (文本, False)
    - 如果 JSON 真的不完整（需要从中间提取），返回 (提取的JSON, True)
    - 如果无法提取可用 JSON，返回 (None, False)
    """
    if not text:
        return None, False
    
    stripped = text.rstrip()
    ends_with_dots = stripped.endswith('....') or stripped.endswith('...')
    
    # 如果以 .... 或 ... 结尾，尝试移除截断标记
    if stripped.endswith('....'):
        candidate = stripped[:-4]
    elif stripped.endswith('...'):
        candidate = stripped[:-3]
    else:
        candidate = stripped
    
    # 移除 markdown 代码块标记
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate)
        candidate = re.sub(r"\s*```$", "", candidate)
    
    candidate = candidate.strip()
    if not candidate:
        return None, ends_with_dots
    
    # 尝试解析 JSON（完整解析）
    try:
        parsed = json.loads(candidate)
        # JSON 完整！即使末尾有 .... 标记，JSON 也是有效的
        # 返回 ends_with_dots=False，告知调用方这是正常输出，不需要重试
        return candidate, False
    except json.JSONDecodeError:
        pass
    
    # JSON 不完整，尝试提取 JSON 对象或数组
    for pattern in [
        r'\{[\s\S]*\}',  # 对象
        r'\[[\s\S]*\]',   # 数组
    ]:
        match = re.search(pattern, candidate)
        if match:
            try:
                json.loads(match.group())
                # 提取到了可用的 JSON，说明原文本确实被截断了
                return match.group(), True
            except json.JSONDecodeError:
                continue
    
    # 无法提取可用 JSON，返回 None
    return None, ends_with_dots


def _is_truncated(text: str) -> bool:
    """检测模型输出是否被截断（以 .... 或 ... 结尾，或以不完整句子结尾）。"""
    if not text:
        return False
    stripped = text.rstrip()
    # 以 3 个或以上句点结尾（模型截断标志）
    if stripped.endswith('....') or stripped.endswith('...'):
        return True
    # 以逗号、冒号、连字符等明显未完成的标点结尾
    if stripped.endswith(',') or stripped.endswith(':') or stripped.endswith('-') or stripped.endswith('–'):
        return True
    # 最后一个完整句子没有句号，且文本长度超过 100 字（正常提示词应有完整句子）
    sentences = stripped.split('.')
    if len(sentences) >= 2:
        last_sentence = sentences[-1].strip()
        if last_sentence and not last_sentence.endswith('?') and not last_sentence.endswith('!') and len(stripped) > 100:
            return True
    return False


async def _call_model_single(
    api_key: str,
    model_name: str,
    system_prompt: str,
    user_prompt: str,
    max_completion_tokens: int = 16384,
) -> str:
    """
    Make a single request to the specified model with built-in retries.
    Raises on final failure after MAX_RETRIES.
    Model switching is handled by the caller.
    """
    client = AsyncOpenAI(
        api_key=api_key,
        base_url=OPENLUX_BASE_URL,
        timeout=REQUEST_TIMEOUT,
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    for retry in range(MAX_RETRIES):
        try:
            response = await client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=0.7,
                max_completion_tokens=MAX_COMPLETION_TOKENS,
            )
            result_text = response.choices[0].message.content
            logger.info(
                f"[LLM] model={model_name} raw response (len={len(result_text) if result_text else 0}): "
                f"{result_text[:500] if result_text else 'EMPTY'}"
            )
            
            # 检测输出是否被截断
            if _is_truncated(result_text):
                # 尝试从截断的输出中提取可用的 JSON
                salvage_text, was_truly_truncated = _salvage_truncated_json(result_text)
                if salvage_text:
                    # 只有真正截断时才输出警告，JSON 完整只是末尾有 .... 标记的不警告
                    if was_truly_truncated:
                        logger.warning(
                            f"[LLM] model={model_name} output truncated but salvaged JSON "
                            f"(original len={len(result_text)}, salvaged len={len(salvage_text)})"
                        )
                    return salvage_text
                
                # 无法 salvage，严格重试
                if retry < MAX_RETRIES - 1:
                    logger.warning(
                        f"[LLM] model={model_name} output truncated, could not salvage JSON, "
                        f"retry {retry+1}/{MAX_RETRIES}"
                    )
                    continue
                raise OpenLuxTruncationError(
                    f"模型输出被截断（可能因 token 限制）: {result_text[-200:]}"
                )
            if _is_refusal(result_text):
                if retry < MAX_RETRIES - 1:
                    logger.warning(
                        f"[LLM] model={model_name} returned refusal, retry {retry+1}/{MAX_RETRIES}"
                    )
                    continue
                raise OpenLuxAPIError(
                    f"模型拒绝了请求（可能因内容审核）: {result_text[:200]}"
                )
            return result_text
        except AuthenticationError as e:
            raise OpenLuxAuthError(f"无效的 OpenLux API Key (401): {str(e)}")
        except RateLimitError as e:
            if retry < MAX_RETRIES - 1:
                logger.warning(
                    f"[LLM] rate limited on {model_name}, retry {retry+1}/{MAX_RETRIES}"
                )
                await asyncio.sleep(_RETRY_BASE_DELAY)
                continue
            raise OpenLuxRateLimitError(f"OpenLux 请求频率超限 (429): {str(e)}")
        except APIError as e:
            status_code = getattr(e, "status_code", None)
            logger.warning(
                f"[LLM] APIError on {model_name} retry={retry}: status={status_code}, error={e}"
            )
            if status_code == 502:
                if retry < MAX_RETRIES - 1:
                    wait_sec = (retry + 1) * _RETRY_BASE_DELAY
                    logger.warning(
                        f"[LLM] 502 on {model_name} retry {retry+1}/{MAX_RETRIES}, "
                        f"waiting {wait_sec}s before retry"
                    )
                    await asyncio.sleep(wait_sec)
                    continue
                raise OpenLuxAPIError(f"OpenLux 502 Bad Gateway: {str(e)}")
            elif retry < MAX_RETRIES - 1:
                wait_sec = (retry + 1) * _RETRY_BASE_DELAY
                logger.warning(
                    f"[LLM] API error {status_code} on {model_name}, retry {retry+1}/{MAX_RETRIES}"
                )
                await asyncio.sleep(wait_sec)
                continue
            raise OpenLuxAPIError(f"OpenLux API 错误 ({status_code or '?'}): {str(e)}")
        except asyncio.TimeoutError:
            if retry < MAX_RETRIES - 1:
                wait_sec = (retry + 1) * _RETRY_BASE_DELAY
                logger.warning(
                    f"[LLM] timeout on {model_name}, retry {retry+1}/{MAX_RETRIES}, waiting {wait_sec}s"
                )
                await asyncio.sleep(wait_sec)
                continue
            raise OpenLuxTimeoutError(f"OpenLux 请求超时（5分钟）")
        except Exception as e:
            error_text = str(e).lower()
            logger.warning(
                f"[LLM] unexpected exception on {model_name} retry={retry}: {e}"
            )
            if "timeout" in error_text or "timed out" in error_text:
                if retry < MAX_RETRIES - 1:
                    wait_sec = (retry + 1) * _RETRY_BASE_DELAY
                    logger.warning(
                        f"[LLM] timeout on {model_name}, retry {retry+1}/{MAX_RETRIES}, "
                        f"waiting {wait_sec}s"
                    )
                    await asyncio.sleep(wait_sec)
                    continue
                raise OpenLuxTimeoutError(f"OpenLux 请求超时（5分钟）")
            if "502" in error_text or "bad gateway" in error_text or "gateway" in error_text:
                if retry < MAX_RETRIES - 1:
                    wait_sec = (retry + 1) * _RETRY_BASE_DELAY
                    logger.warning(
                        f"[LLM] gateway error on {model_name}, retry {retry+1}/{MAX_RETRIES}, "
                        f"waiting {wait_sec}s"
                    )
                    await asyncio.sleep(wait_sec)
                    continue
                raise OpenLuxAPIError(f"OpenLux Bad Gateway (502): {str(e)}")
            if retry < MAX_RETRIES - 1:
                logger.warning(
                    f"[LLM] unexpected error on {model_name}: {e}, retry {retry+1}/{MAX_RETRIES}"
                )
                await asyncio.sleep(_RETRY_BASE_DELAY)
                continue
            raise OpenLuxAPIError(f"LLM 调用失败: {str(e)}")

    # Should not reach here, but safety net
    raise OpenLuxAPIError(f"模型 {model_name} 在重试 {MAX_RETRIES} 次后仍失败")


async def call_grok(
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    model_order: Optional[List[str]] = None,
    max_tokens: Optional[int] = None,
) -> str:
    """
    Call Grok models with automatic model switching on ANY failure.
    Tries models in order. If primary model fails (API error, parse error,
    timeout, content filter, etc.), switches to fallback model and retries.
    """
    models_to_try = model_order or [MODEL_NAME, MODEL_FALLBACK, MODEL_FALLBACK_2]

    for model_idx, model_name in enumerate(models_to_try):
        logger.info(f"[LLM] trying model={model_name} (model_idx={model_idx})")
        try:
            effective_max = max_tokens if max_tokens is not None else MAX_COMPLETION_TOKENS
            return await _call_model_single(api_key, model_name, system_prompt, user_prompt, max_completion_tokens=effective_max)
        except OpenLuxAuthError:
            # Auth errors should not fall back to another model
            raise
        except Exception as e:
            # All other failures → try next model
            logger.warning(
                f"[LLM] model={model_name} failed: {type(e).__name__}: {e}, "
                f"trying next model"
            )
            if model_idx == len(models_to_try) - 1:
                # Last model — propagate the error
                raise OpenLuxAPIError(
                    f"所有模型均不可用（{'、'.join(models_to_try)} 都已失败）: {type(e).__name__}: {e}"
                )
            # More models available — continue to next
            continue

    # Should not reach here
    raise OpenLuxAPIError("LLM 调用失败（无可用模型）")


# ─── Streaming variants ─────────────────────────────────────────────────────────
#
# `stream_grok` is the streaming counterpart of `call_grok`. It yields raw text
# chunks from the LLM as they arrive, allowing the HTTP route to push them to
# the client immediately (NDJSON line per chunk) instead of buffering the full
# response. This eliminates the perceived "stuck at 抽卡中" UX where the user
# waits for the last result before any card appears.
#
# Stream semantics:
#   - On each chunk, the async generator yields the raw delta string (may be
#     empty — OpenAI-style streams sometimes emit empty role chunks).
#   - The full concatenated text is returned after the generator is exhausted.
#   - Model fallback still works: if a model errors mid-stream, we close that
#     generator and re-open with the next model in `model_order`.
#   - Refusal detection still applies — a refusal mid-stream is treated as a
#     terminal failure for that model, triggering fallback.

async def _stream_model_single(
    api_key: str,
    model_name: str,
    system_prompt: str,
    user_prompt: str,
) -> AsyncIterator[str]:
    """Stream a single model. Yields text deltas. Raises on terminal failure."""
    client = AsyncOpenAI(
        api_key=api_key,
        base_url=OPENLUX_BASE_URL,
        timeout=REQUEST_TIMEOUT,
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    last_error: Optional[Exception] = None
    for retry in range(MAX_RETRIES):
        try:
            stream = await client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=0.7,
                max_completion_tokens=MAX_COMPLETION_TOKENS,
                stream=True,
            )
            collected_parts: List[str] = []
            refusal_detected = False
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                text_piece = getattr(delta, "content", None) if delta else None
                if not text_piece:
                    continue
                collected_parts.append(text_piece)
                # Refusal patterns are checked against the rolling text — once a
                # refusal prefix is detected we stop yielding and let the caller
                # fall back to the next model.
                running = "".join(collected_parts)
                if _is_refusal(running):
                    refusal_detected = True
                    logger.warning(
                        f"[LLM] stream model={model_name} returned refusal mid-stream, "
                        f"aborting (retry {retry+1}/{MAX_RETRIES})"
                    )
                    break
                yield text_piece

            if refusal_detected:
                if retry < MAX_RETRIES - 1:
                    await asyncio.sleep(_RETRY_BASE_DELAY)
                    last_error = OpenLuxAPIError("模型拒绝（流式）")
                    continue
                raise OpenLuxAPIError(
                    "模型拒绝了请求（可能因内容审核）"
                )
            return  # Successful stream completion
        except AuthenticationError as e:
            raise OpenLuxAuthError(f"无效的 OpenLux API Key (401): {str(e)}")
        except RateLimitError as e:
            last_error = OpenLuxRateLimitError(f"OpenLux 请求频率超限 (429): {str(e)}")
            if retry < MAX_RETRIES - 1:
                logger.warning(
                    f"[LLM] stream rate limited on {model_name}, retry {retry+1}/{MAX_RETRIES}"
                )
                await asyncio.sleep(_RETRY_BASE_DELAY)
                continue
            raise last_error
        except APIError as e:
            status_code = getattr(e, "status_code", None)
            last_error = OpenLuxAPIError(
                f"OpenLux API 错误 ({status_code or '?'}): {str(e)}"
            )
            if status_code == 502 or "502" in str(e) or "bad gateway" in str(e).lower():
                if retry < MAX_RETRIES - 1:
                    wait_sec = (retry + 1) * _RETRY_BASE_DELAY
                    logger.warning(
                        f"[LLM] stream 502 on {model_name}, retry {retry+1}/{MAX_RETRIES}"
                    )
                    await asyncio.sleep(wait_sec)
                    continue
                raise last_error
            if retry < MAX_RETRIES - 1:
                wait_sec = (retry + 1) * _RETRY_BASE_DELAY
                await asyncio.sleep(wait_sec)
                continue
            raise last_error
        except asyncio.TimeoutError:
            last_error = OpenLuxTimeoutError("OpenLux 请求超时（5分钟）")
            if retry < MAX_RETRIES - 1:
                logger.warning(
                    f"[LLM] stream timeout on {model_name}, retry {retry+1}/{MAX_RETRIES}"
                )
                await asyncio.sleep((retry + 1) * _RETRY_BASE_DELAY)
                continue
            raise last_error
        except Exception as e:
            error_text = str(e).lower()
            if "timeout" in error_text or "timed out" in error_text:
                last_error = OpenLuxTimeoutError("OpenLux 请求超时（5分钟）")
                if retry < MAX_RETRIES - 1:
                    await asyncio.sleep((retry + 1) * _RETRY_BASE_DELAY)
                    continue
                raise last_error
            last_error = OpenLuxAPIError(f"LLM 流式调用失败: {str(e)}")
            if retry < MAX_RETRIES - 1:
                logger.warning(
                    f"[LLM] stream unexpected error on {model_name}, retry {retry+1}/{MAX_RETRIES}: {e}"
                )
                await asyncio.sleep(_RETRY_BASE_DELAY)
                continue
            raise last_error

    if last_error:
        raise last_error
    raise OpenLuxAPIError(f"模型 {model_name} 流式调用在 {MAX_RETRIES} 次重试后仍失败")


async def stream_grok(
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    model_order: Optional[List[str]] = None,
) -> AsyncIterator[str]:
    """Streaming version of call_grok. Yields text deltas as they arrive.

    Automatically falls back to the next model in `model_order` if the current
    model fails before producing any text. If a model fails *after* partial
    output, the partial output is discarded and the next model is started from
    scratch (no mid-stream model swap to keep semantics consistent with
    non-streaming call_grok).
    """
    models_to_try = model_order or [MODEL_NAME, MODEL_FALLBACK, MODEL_FALLBACK_2]

    for model_idx, model_name in enumerate(models_to_try):
        logger.info(f"[LLM stream] trying model={model_name} (idx={model_idx})")
        emitted_any = False
        try:
            gen = _stream_model_single(api_key, model_name, system_prompt, user_prompt)
            async for piece in gen:
                emitted_any = True
                yield piece
            return  # Stream completed cleanly
        except OpenLuxAuthError:
            raise
        except Exception as e:
            logger.warning(
                f"[LLM stream] model={model_name} failed: {type(e).__name__}: {e}, "
                f"emitted_any={emitted_any}, trying next model"
            )
            if model_idx == len(models_to_try) - 1:
                raise OpenLuxAPIError(
                    f"所有模型均不可用（{'、'.join(models_to_try)} 都已失败）: "
                    f"{type(e).__name__}: {e}"
                )
            continue


async def call_llm(
    api_key: str,
    model_name: str,
    system_prompt: str,
    content_parts: List[dict],
    temperature: float = 0.3,
    max_tokens: int = 2048,
) -> str:
    """
    Call any model via OpenLux API (api.openlux.ai)，支持多模态内容输入（如图片+文字）。

    Args:
        api_key: OpenLux API Key
        model_name: 模型名称，如 "gemini-3.8-flash"、"grok-4.6"、"gpt-4o"
        system_prompt: 系统提示词
        content_parts: 内容部分列表，每个元素支持：
            - {"type": "text", "text": "..."}
            - {"type": "image_url", "image_url": {"url": "data:image/...;base64,..."}}
        temperature: 温度，默认 0.3（更确定性输出）
        max_tokens: 最大输出 token 数，默认 2048
    Returns:
        模型输出的文本内容

    Raises:
        OpenLuxAPIError / OpenLuxAuthError 等
    """
    client = AsyncOpenAI(
        api_key=api_key,
        base_url=OPENLUX_BASE_URL,
        timeout=60.0,
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": content_parts,
        },
    ]

    last_error: Optional[Exception] = None
    for retry in range(MAX_RETRIES):
        try:
            response = await client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=temperature,
                max_completion_tokens=max_tokens,
            )
            result_text = response.choices[0].message.content
            logger.info(
                f"[call_llm] model={model_name} response (len={len(result_text) if result_text else 0}): "
                f"{result_text[:300] if result_text else 'EMPTY'}"
            )

            if _is_refusal(result_text or ""):
                if retry < MAX_RETRIES - 1:
                    logger.warning(f"[call_llm] {model_name} returned refusal, retry {retry+1}/{MAX_RETRIES}")
                    await asyncio.sleep(_RETRY_BASE_DELAY)
                    continue
                raise OpenLuxAPIError(f"模型拒绝了请求: {result_text[:200]}")

            return result_text or ""

        except AuthenticationError as e:
            raise OpenLuxAuthError(f"无效的 OpenLux API Key (401): {str(e)}")
        except RateLimitError as e:
            if retry < MAX_RETRIES - 1:
                wait_sec = (retry + 1) * 3
                logger.warning(f"[call_llm] rate limit on {model_name}, retry {retry+1}/{MAX_RETRIES}, waiting {wait_sec}s")
                await asyncio.sleep(wait_sec)
                continue
            raise OpenLuxRateLimitError(f"OpenLux 请求频率超限 (429): {str(e)}")
        except Exception as e:
            error_text = str(e).lower()
            if "timeout" in error_text or "timed out" in error_text:
                last_error = OpenLuxTimeoutError(f"OpenLux 请求超时（60秒）: {e}")
                if retry < MAX_RETRIES - 1:
                    await asyncio.sleep((retry + 1) * _RETRY_BASE_DELAY)
                    continue
                raise last_error
            last_error = OpenLuxAPIError(f"LLM 调用失败: {str(e)}")
            if retry < MAX_RETRIES - 1:
                logger.warning(f"[call_llm] unexpected error on {model_name}: {e}, retry {retry+1}/{MAX_RETRIES}")
                await asyncio.sleep(_RETRY_BASE_DELAY)
                continue
            raise last_error

    if last_error:
        raise last_error
    raise OpenLuxAPIError(f"模型 {model_name} 调用在 {MAX_RETRIES} 次重试后仍失败")


class OpenLuxAuthError(Exception):
    """无效的 API Key"""
    pass


class OpenLuxRateLimitError(Exception):
    """请求频率超限"""
    pass


class OpenLuxTimeoutError(Exception):
    """请求超时"""
    pass


class OpenLuxTruncationError(Exception):
    """模型输出被截断（检测到 .... 或不完整句子结尾）"""
    pass


class OpenLuxAPIError(Exception):
    """通用 API 错误"""
    pass


class OpenLuxContentFilteredError(Exception):
    """内容审核过滤（违禁词/敏感词触发）"""
    pass


def clean_json_response(raw_text: str) -> Union[list, dict]:
    """清理大模型可能返回的 markdown 代码块，安全解析 JSON"""
    if not raw_text:
        raise OpenLuxParseError("模型返回了空响应")

    text = raw_text.strip()

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()

    if not text:
        raise OpenLuxParseError("模型返回了空响应（清理后）")

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        text = re.sub(r"```[\s\S]*?```", "", text)
        text = text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            array_match = re.search(r'\[[\s\S]*\]', text)
            if array_match:
                try:
                    return json.loads(array_match.group())
                except json.JSONDecodeError:
                    pass
            obj_match = re.search(r'\{[\s\S]*\}', text)
            if obj_match:
                try:
                    return json.loads(obj_match.group())
                except json.JSONDecodeError:
                    pass
            raise OpenLuxParseError(f"无法解析模型返回为 JSON（{e}）：{text[:100]}")


class OpenLuxParseError(Exception):
    """JSON 解析失败"""
    pass


# ─── Clothing Image Extraction ─────────────────────────────────────────────────

GEMINI_ENDPOINT_BASE = "https://yunwu.ai/v1beta/models"


def _parse_data_url(data_url: str) -> Optional[Tuple[bytes, str]]:
    """解析 data URL → (bytes, mime)。例如 data:image/png;base64,xxxxxx"""
    m = re.match(r"^data:([^;]+);base64,(.+)$", data_url, re.DOTALL)
    if not m:
        return None
    try:
        return base64.b64decode(m.group(2)), m.group(1)
    except Exception:
        return None


async def extract_clothings_with_image(
    api_key: str,
    image_url: str,
    clothing_hints: Optional[List[str]] = None,
    model: str = "gpt-image-2-c",
    custom_element_images: Optional[List[str]] = None,
    additional_image_urls: Optional[List[str]] = None,
) -> List[dict]:
    """
    从参考图中提取服装抠图合成图，支持三种图片生成模型：
      - gpt-image-2-c                  (默认, OpenAI /v1/images/edits)
      - grok-imagine-image-2.0          (OpenAI /v1/images/edits)
      - gemini-3.1-flash-image-preview  (Gemini /v1beta/models/...:generateContent)

    custom_element_images: 用户上传的自定义服装元素图片（base64 data URL 列表，最多3张）。
                           作为额外图像输入参与合成（不会注入 prompt 文本，避免 429）。

    additional_image_urls: 额外参考图 URL（最多 5 张），与 image_url 一起做视觉分析。
                           每张图独立识别服装，所有结果合并不去重（保留重复/相似项）。

    Returns:
        List[dict] — 末尾元素为合成图 {"name": "服装抠图合成图", "image_url": "data:image/png;base64,..."}
    """

    # ── Step 1: 组装多参考图 URL 列表（去重保序） ─────────────────────────
    all_image_urls: List[str] = [image_url]
    if additional_image_urls:
        for u in additional_image_urls:
            if u and u not in all_image_urls:
                all_image_urls.append(u)
    logger.info(
        f"[extract_clothings_with_image] 共 {len(all_image_urls)} 张参考图: "
        f"{[u[:60] + ('...' if len(u) > 60 else '') for u in all_image_urls]}"
    )

    # ── Step 2: 逐张视觉分析 → 合并服装列表（不去重） ─────────────────────
    base_vision_prompt = """分析图片中人物所穿的所有服装。
输出格式（严格 JSON，无 markdown 代码块，无任何解释文字）：
{
  "clothings": [
    {"name": "服装名称", "type": "上装|下装|连体|配饰|鞋子|袜子|其他", "color": "主色调", "style": "风格特征"}
  ]
}
- 严格输出纯 JSON
- 即使图中有重复或相似的服装（如多件上装、多双鞋），每件都独立列出，不要合并"""
    if clothing_hints:
        base_vision_prompt += f"\n已知服装提示：{', '.join(clothing_hints)}"

    clothings: List[dict] = []
    for idx, url in enumerate(all_image_urls):
        per_image_prompt = base_vision_prompt + (
            f"\n（这是第 {idx+1}/{len(all_image_urls)} 张参考图，请仅分析当前图。）"
        )
        try:
            raw = await call_llm(
                api_key=api_key,
                model_name="gemini-3.8-flash",
                system_prompt=per_image_prompt,
                content_parts=[{"type": "image_url", "image_url": {"url": url}}],
                temperature=0.3,
                max_tokens=4096,
            )
        except Exception as e:
            logger.warning(f"[extract_clothings_with_image] 第 {idx+1} 张视觉分析失败: {e}")
            continue

        text = raw.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        try:
            result = json.loads(text)
        except json.JSONDecodeError:
            logger.warning(f"[extract_clothings_with_image] 第 {idx+1} 张视觉分析 JSON 解析失败: {text[:200]}")
            continue

        # 保留所有识别结果，不去重
        items = result.get("clothings") or []
        for it in items:
            it = dict(it)  # 复制避免引用
            it["_source_index"] = idx + 1
            clothings.append(it)
        logger.info(f"[extract_clothings_with_image] 第 {idx+1} 张识别到 {len(items)} 件，累计 {len(clothings)} 件")

    if not clothings:
        return []

    # 清理临时字段
    for c in clothings:
        c.pop("_source_index", None)

    clothing_names = [c.get("name", "") for c in clothings]

    # ── Step 3: 下载主图（用于合成） ──────────────────────────────────────
    async def _download_bytes(url: str) -> Tuple[bytes, str]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            b = resp.content
        mime = "image/png" if url.lower().endswith(".png") else "image/jpeg"
        return b, mime

    try:
        src_bytes, src_mime = await _download_bytes(image_url)
    except Exception as e:
        raise OpenLuxAPIError(f"无法下载主参考图: {e}")

    # ── Step 4: 解析自定义服装元素图片 ─────────────────────────────────────
    custom_imgs: List[Tuple[bytes, str]] = []  # (bytes, mime)
    if custom_element_images:
        for elem in custom_element_images[:3]:
            parsed = _parse_data_url(elem)
            if parsed:
                custom_imgs.append(parsed)
            else:
                logger.warning(f"[extract_clothings_with_image] 跳过无法解析的自定义元素（{len(elem)} 字节）")

    # ── Step 5: 构造编辑 prompt（不注入 base64） ─────────────────────────
    clothing_desc = "、".join(filter(None, clothing_names))
    custom_note = ""
    if custom_imgs:
        custom_note = (
            f" 用户另外上传了 {len(custom_imgs)} 张自定义服装元素参考图（已作为附加图像传入），"
            f"请在合成时把这些自定义元素也合入到最终合成图中，保留它们原本的颜色与质感。"
        )
    edit_prompt = (
        f"从原图中精确提取出以下所有服装：{clothing_desc}。"
        f"将人物身上的所有服装单品完整抠出来，合成为一张图片。"
        f"背景处理为纯白色（#FFFFFF），保留服装原有的颜色、质感和细节，"
        f"各服装单品清晰可见、无重叠遮挡。{custom_note}"
        f"输出干净的服装抠图合成图。"
    )

    # ── Step 6: 按 model 分发图片生成 ─────────────────────────────────────
    # OpenAI 兼容端点（/v1/images/edits）：主图 + 自定义元素（多张）作为 image[] 字段上传
    async def _call_openai_image_edit(model_name: str) -> str:
        # 构造多文件：image[0]=主图, image[1..]=自定义元素
        ext_main = "png" if "png" in src_mime else "jpg"
        files = [("image[]", (f"image0.{ext_main}", src_bytes, src_mime))]
        for i, (b, m) in enumerate(custom_imgs):
            ext = "png" if "png" in m else "jpg"
            files.append((f"image[]", (f"image{i+1}.{ext}", b, m)))

        data = {
            "model": model_name,
            "prompt": edit_prompt,
            "n": "1",
            "response_format": "b64_json",
            "size": "1024x1024",
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{OPENLUX_BASE_URL}/images/edits",
                files=files,
                data=data,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if resp.status_code != 200:
                raise OpenLuxAPIError(
                    f"{model_name} 失败 (HTTP {resp.status_code}): {resp.text[:300]}"
                )
            return resp.json()["data"][0]["b64_json"]

    # Gemini 端点（/v1beta/models/<model>:generateContent）：使用 inline_data 多图输入
    async def _call_gemini_image_edit(model_name: str) -> str:
        parts: List[dict] = [{"text": edit_prompt}]
        # 主图
        parts.append({
            "inline_data": {
                "mime_type": src_mime,
                "data": base64.b64encode(src_bytes).decode(),
            }
        })
        # 自定义元素
        for b, m in custom_imgs:
            parts.append({
                "inline_data": {
                    "mime_type": m,
                    "data": base64.b64encode(b).decode(),
                }
            })

        body = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
            },
        }
        url = f"{GEMINI_ENDPOINT_BASE}/{model_name}:generateContent"
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                url,
                json=body,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
            if resp.status_code != 200:
                raise OpenLuxAPIError(
                    f"{model_name} 失败 (HTTP {resp.status_code}): {resp.text[:300]}"
                )
            data = resp.json()
            for cand in data.get("candidates", []):
                for part in cand.get("content", {}).get("parts", []):
                    if "inline_data" in part and part["inline_data"].get("data"):
                        return part["inline_data"]["data"]
            raise OpenLuxAPIError(
                f"{model_name} 未返回图片 (响应无 inline_data): {json.dumps(data)[:200]}"
            )

    # ── Step 7: 模型分发与备用 ────────────────────────────────────────────
    primary_model = model or "gpt-image-2-c"
    b64_result: Optional[str] = None

    if primary_model == "gpt-image-2-c":
        try:
            logger.info("[extract_clothings_with_image] 调用 gpt-image-2-c")
            b64_result = await _call_openai_image_edit("gpt-image-2-c")
        except Exception as exc:
            logger.warning(
                f"[extract_clothings_with_image] gpt-image-2-c 失败，切换备用 grok-imagine-image-2.0: {exc}"
            )
            b64_result = await _call_openai_image_edit("grok-imagine-image-2.0")

    elif primary_model == "grok-imagine-image-2.0":
        try:
            logger.info("[extract_clothings_with_image] 调用 grok-imagine-image-2.0")
            b64_result = await _call_openai_image_edit("grok-imagine-image-2.0")
        except Exception as exc:
            logger.warning(f"[extract_clothings_with_image] grok-imagine-image-2.0 失败: {exc}")
            raise OpenLuxAPIError(f"grok-imagine-image-2.0 失败: {exc}")

    elif primary_model == "gemini-3.1-flash-image-preview":
        try:
            logger.info("[extract_clothings_with_image] 调用 gemini-3.1-flash-image-preview")
            b64_result = await _call_gemini_image_edit("gemini-3.1-flash-image-preview")
        except Exception as exc:
            logger.warning(f"[extract_clothings_with_image] gemini-3.1-flash-image-preview 失败: {exc}")
            raise OpenLuxAPIError(f"gemini-3.1-flash-image-preview 失败: {exc}")

    else:
        raise OpenLuxAPIError(
            f"不支持的图片模型: {model}，可选: gpt-image-2-c | grok-imagine-image-2.0 | gemini-3.1-flash-image-preview"
        )

    # ── Step 8: 返回结果 ──────────────────────────────────────────────────
    composite_url = f"data:image/png;base64,{b64_result}"
    items: List[dict] = []
    for c in clothings:
        items.append({
            "name": c.get("name", ""),
            "type": c.get("type", "其他"),
            "color": c.get("color", ""),
            "style": c.get("style", ""),
            "image_url": "",
        })
    items.append({
        "name": "服装抠图合成图",
        "type": "其他",
        "color": "",
        "style": "",
        "image_url": composite_url,
    })
    logger.info(f"[extract_clothings_with_image] 完成，共 {len(items)} 条记录（{len(clothings)} 件服装 + 1 张合成图）")
    return items

