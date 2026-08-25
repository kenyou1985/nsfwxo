"""LLM Service - Grok via OpenLux API 动态客户端封装"""

import asyncio
import json
import logging
import re
from typing import AsyncIterator, List, Optional, Union
from openai import AsyncOpenAI, APIError, AuthenticationError, RateLimitError

logger = logging.getLogger(__name__)

OPENLUX_BASE_URL = "https://api.openlux.ai/v1"
MODEL_NAME = "grok-4.6"
MODEL_FALLBACK = "grok-4.3"
REQUEST_TIMEOUT = 90
MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1


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


async def _call_model_single(
    api_key: str,
    model_name: str,
    system_prompt: str,
    user_prompt: str,
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
            )
            result_text = response.choices[0].message.content
            logger.info(
                f"[LLM] model={model_name} raw response (len={len(result_text) if result_text else 0}): "
                f"{result_text[:500] if result_text else 'EMPTY'}"
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
) -> str:
    """
    Call Grok models with automatic model switching on ANY failure.
    Tries models in order. If primary model fails (API error, parse error,
    timeout, content filter, etc.), switches to fallback model and retries.
    """
    models_to_try = model_order or [MODEL_NAME, MODEL_FALLBACK]

    for model_idx, model_name in enumerate(models_to_try):
        logger.info(f"[LLM] trying model={model_name} (model_idx={model_idx})")
        try:
            return await _call_model_single(api_key, model_name, system_prompt, user_prompt)
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
                    f"所有模型均不可用（{MODEL_NAME} 和 {MODEL_FALLBACK} 都已失败）: {type(e).__name__}: {e}"
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
    models_to_try = model_order or [MODEL_NAME, MODEL_FALLBACK]

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


class OpenLuxAuthError(Exception):
    """无效的 API Key"""
    pass


class OpenLuxRateLimitError(Exception):
    """请求频率超限"""
    pass


class OpenLuxTimeoutError(Exception):
    """请求超时"""
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
