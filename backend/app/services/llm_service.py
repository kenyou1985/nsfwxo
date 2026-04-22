"""LLM Service - Grok via Yunwu API 动态客户端封装"""

import json
import re
from typing import List, Union, Any
from openai import AsyncOpenAI, APIError, AuthenticationError, RateLimitError

YUNWU_BASE_URL = "https://api.yunwu.ai/v1"
MODEL_NAME = "grok-4-20-reasoning"
REQUEST_TIMEOUT = 120  # seconds — increased for large context requests (theme generation)


async def call_grok(api_key: str, system_prompt: str, user_prompt: str) -> str:
    """
    动态实例化 AsyncOpenAI 客户端，每次请求使用前端传来的 API Key。
    """
    client = AsyncOpenAI(
        api_key=api_key,
        base_url=YUNWU_BASE_URL,
        timeout=REQUEST_TIMEOUT,
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    try:
        response = await client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages,
            temperature=0.7,
        )
        return response.choices[0].message.content
    except AuthenticationError as e:
        raise YunwuAuthError(f"无效的 Yunwu AI API Key (401): {str(e)}")
    except RateLimitError as e:
        raise YunwuRateLimitError(f"Yunwu AI 请求频率超限 (429): {str(e)}")
    except APIError as e:
        raise YunwuAPIError(f"Yunwu AI API 错误 ({getattr(e, 'status_code', '?')}): {str(e)}")
    except Exception as e:
        # 超时或其他网络错误
        if "timeout" in str(e).lower() or "timed out" in str(e).lower():
            raise YunwuTimeoutError(f"Yunwu AI 请求超时（{REQUEST_TIMEOUT}秒）: {str(e)}")
        raise YunwuAPIError(f"LLM 调用失败: {str(e)}")


class YunwuAuthError(Exception):
    """无效的 API Key"""
    pass


class YunwuRateLimitError(Exception):
    """请求频率超限"""
    pass


class YunwuTimeoutError(Exception):
    """请求超时"""
    pass


class YunwuAPIError(Exception):
    """通用 API 错误"""
    pass


class YunwuContentFilteredError(Exception):
    """内容审核过滤（违禁词/敏感词触发）"""
    pass


def clean_json_response(raw_text: str) -> Union[list, dict]:
    """清理大模型可能返回的 markdown 代码块，安全解析 JSON"""
    if not raw_text:
        raise YunwuParseError("模型返回了空响应")

    text = raw_text.strip()

    # 去掉 markdown 代码块
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()

    if not text:
        raise YunwuParseError("模型返回了空响应（清理后）")

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        # 尝试移除残留的 markdown 块
        text = re.sub(r"```[\s\S]*?```", "", text)
        text = text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # 提取第一个 [...] 或 {...} 结构
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
            raise YunwuParseError(f"无法解析模型返回为 JSON（{e}）：{text[:100]}")


class YunwuParseError(Exception):
    """JSON 解析失败"""
    pass
