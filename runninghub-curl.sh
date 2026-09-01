#!/bin/bash
# RunningHub Minimax图生视频 API 调用示例
# 
# 使用方法:
#   1. 设置您的 API Key: export RUNNINGHUB_API_KEY="your_api_key_here"
#   2. 设置输入图片路径: export INPUT_IMAGE="/path/to/your/image.png"
#   3. 设置提示词: export PROMPT="你的视频描述"
#   4. 运行脚本: bash runninghub-curl.sh

# 配置
API_KEY="${RUNNINGHUB_API_KEY}"
API_URL="https://www.runninghub.ai/openapi/v2/run/ai-app/2084661265636839425"
QUERY_URL="https://www.runninghub.ai/openapi/v2/query"
UPLOAD_URL="https://www.runninghub.ai/openapi/v2/media/upload/binary"

# 参数配置
INPUT_IMAGE="${INPUT_IMAGE:-}"
PROMPT="${PROMPT:-自由发挥}"
DURATION="${DURATION:-15}"
SEED="${SEED:-0.6}"
LORA_STRENGTH="${LORA_STRENGTH:-0.4}"
MOTION_MODE="${MOTION_MODE:-1}"

# 检查API Key
if [ -z "$API_KEY" ]; then
    echo "错误: 请设置 RUNNINGHUB_API_KEY 环境变量"
    echo "示例: export RUNNINGHUB_API_KEY=\"your_api_key_here\""
    exit 1
fi

echo "=========================================="
echo "RunningHub Minimax图生视频 API 调用"
echo "=========================================="
echo ""

# 步骤1: 上传图片（如果提供了本地图片路径）
if [ -n "$INPUT_IMAGE" ] && [ -f "$INPUT_IMAGE" ]; then
    echo "[步骤1/2] 上传图片: $INPUT_IMAGE"
    
    UPLOAD_RESPONSE=$(curl -s -X POST "$UPLOAD_URL" \
        -H "Authorization: Bearer $API_KEY" \
        -F "file=@$INPUT_IMAGE")
    
    echo "上传响应: $UPLOAD_RESPONSE"
    
    # 提取图片文件名
    IMAGE_NAME=$(echo $UPLOAD_RESPONSE | grep -o '"fileName":"[^"]*"' | cut -d'"' -f4)
    
    if [ -z "$IMAGE_NAME" ]; then
        echo "错误: 图片上传失败"
        exit 1
    fi
    
    echo "上传成功，图片名称: $IMAGE_NAME"
else
    # 如果是已经上传过的图片或URL，直接使用
    IMAGE_NAME="${INPUT_IMAGE:-example.png}"
    echo "[步骤1/2] 使用已有图片: $IMAGE_NAME"
fi

echo ""

# 步骤2: 提交任务
echo "[步骤2/2] 提交视频生成任务..."

# 构建请求JSON
REQUEST_JSON=$(cat <<EOF
{
  "nodeInfoList": [
    {
      "nodeId": "50",
      "fieldName": "image",
      "fieldValue": "$IMAGE_NAME"
    },
    {
      "nodeId": "38",
      "fieldName": "prompt",
      "fieldValue": "$PROMPT"
    },
    {
      "nodeId": "185",
      "fieldName": "value",
      "fieldValue": "$DURATION"
    },
    {
      "nodeId": "238",
      "fieldName": "value",
      "fieldValue": "$SEED"
    },
    {
      "nodeId": "182",
      "fieldName": "select",
      "fieldValue": "$MOTION_MODE"
    },
    {
      "nodeId": "127",
      "fieldName": "value",
      "fieldValue": "false"
    },
    {
      "nodeId": "19",
      "fieldName": "unet_name",
      "fieldValue": "DasiwaMinimaxH3_dasiwaREF2VAHybridV1_0.safetensors"
    },
    {
      "nodeId": "111",
      "fieldName": "lora_name",
      "fieldValue": "MysticXXX_MMH3-V1.safetensors"
    },
    {
      "nodeId": "111",
      "fieldName": "strength_model",
      "fieldValue": "$LORA_STRENGTH"
    }
  ],
  "instanceType": "default",
  "usePersonalQueue": "false"
}
EOF
)

echo "请求内容:"
echo "$REQUEST_JSON" | jq .
echo ""

# 提交任务
TASK_RESPONSE=$(curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d "$REQUEST_JSON")

echo "任务响应:"
echo "$TASK_RESPONSE" | jq .

# 提取任务ID
TASK_ID=$(echo $TASK_RESPONSE | grep -o '"taskId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TASK_ID" ]; then
    echo ""
    echo "错误: 未获取到任务ID，任务可能提交失败"
    exit 1
fi

echo ""
echo "=========================================="
echo "任务提交成功!"
echo "任务ID: $TASK_ID"
echo "=========================================="
echo ""
echo "查询任务状态:"
echo "curl -X POST '$QUERY_URL' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H 'Authorization: Bearer $API_KEY' \\"
echo "  -d '{\"taskId\": \"$TASK_ID\"}'"
echo ""
echo "或使用WebSocket实时获取结果"
