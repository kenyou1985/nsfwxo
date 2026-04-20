"""LLM Service - Grok via Yunwu API 动态客户端封装"""

import json
import re
from typing import List, Union, Any
from openai import AsyncOpenAI

YUNWU_BASE_URL = "https://api.yunwu.ai/v1"
MODEL_NAME = "grok-4-20-reasoning"


async def call_grok(api_key: str, system_prompt: str, user_prompt: str) -> str:
    """
    动态实例化 AsyncOpenAI 客户端，每次请求使用前端传来的 API Key。
    """
    client = AsyncOpenAI(api_key=api_key, base_url=YUNWU_BASE_URL)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    response = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        temperature=0.7,
    )
    return response.choices[0].message.content


def clean_json_response(raw_text: str) -> Union[list, dict]:
    """清理大模型可能返回的 markdown 代码块，安全解析 JSON"""
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        text = re.sub(r"```[\s\S]*?```", "", text)
        text = text.strip()
        return json.loads(text)
