import type { NodeInfo } from '../types';
import { WORKFLOW } from '../services/runninghub';

export interface Txt2ImgNodeOptions {
  workflowId?: string;
  width: number;
  height: number;
  imageCount: number;
  prompt: string;
  negativePrompt?: string;
  lora1Name?: string;
  lora1Weight?: number;
  lora2Name?: string;
  lora2Weight?: number;
  lora3Name?: string;
  lora3Weight?: number;
  checkpoint?: string;
}

const NEGATIVE_PROMPT_DEFAULT = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet';

interface NodeIds {
  width: string;
  height: string;
  batchSize: string;
  positivePrompt: string;
  negativePrompt?: string;
  lora1: string;
  lora2: string;
  lora3?: string;
  checkpoint?: string;
}

/** 真实系批量文生图（默认） */
const DEFAULT_NODES: NodeIds = {
  width: '5',
  height: '5',
  batchSize: '5',
  positivePrompt: '6',
  negativePrompt: '7',
  lora1: '11',
  lora2: '13',
  lora3: '15',
  checkpoint: undefined,
};

/** 随机提示词模型 */
const RANDOM_PROMPT_NODES: NodeIds = {
  width: '21',
  height: '20',
  batchSize: '78',
  positivePrompt: '225',
  negativePrompt: undefined,
  lora1: '33',
  lora2: '36',
  lora3: undefined,
  checkpoint: '8',
};

/** 真实 V3 模型 */
const REALISTIC_V3_NODES: NodeIds = {
  width: '146',
  height: '147',
  batchSize: '148',
  positivePrompt: '168',
  negativePrompt: undefined,
  lora1: '172',
  lora2: '161',
  lora3: '158',
  checkpoint: undefined,
};

function getNodeIds(workflowId: string): NodeIds {
  switch (workflowId) {
    case WORKFLOW.RANDOM_PROMPT:
      return RANDOM_PROMPT_NODES;
    case WORKFLOW.REALISTIC_V3:
      return REALISTIC_V3_NODES;
    default:
      return DEFAULT_NODES;
  }
}

export function buildTxt2ImgNodeList(options: Txt2ImgNodeOptions): NodeInfo[] {
  const {
    workflowId,
    width,
    height,
    imageCount,
    prompt,
    negativePrompt,
    lora1Name,
    lora1Weight = 0.8,
    lora2Name,
    lora2Weight = 0.6,
    lora3Name,
    lora3Weight = 1.0,
    checkpoint,
  } = options;

  const ids = getNodeIds(workflowId || WORKFLOW.TEXT_TO_IMAGE);

  // Helper to format float weights to a clean decimal string (avoid JS float precision issues like 0.7500000000000001)
  const fmt = (n: number) => {
    const s = String(n);
    return s;
  };

  const nodes: NodeInfo[] = [
    { nodeId: ids.width, fieldName: 'value', fieldValue: String(width), description: '宽度' },
    { nodeId: ids.height, fieldName: 'value', fieldValue: String(height), description: '高度' },
    { nodeId: ids.batchSize, fieldName: 'value', fieldValue: String(imageCount), description: '数量' },
    { nodeId: ids.positivePrompt, fieldName: 'text', fieldValue: String(prompt || ''), description: '提示词' },
  ];

  // 真实系默认模型有反向提示词节点
  if (ids.negativePrompt) {
    nodes.push({
      nodeId: ids.negativePrompt,
      fieldName: 'text',
      fieldValue: negativePrompt || NEGATIVE_PROMPT_DEFAULT,
      description: '反向提示词',
    });
  }

  // LoRA 1
  if (lora1Name && ids.lora1) {
    nodes.push({ nodeId: ids.lora1, fieldName: 'lora_name', fieldValue: lora1Name, description: 'lora1' });
    nodes.push({ nodeId: ids.lora1, fieldName: 'strength_model', fieldValue: fmt(lora1Weight), description: 'lora1权重' });
  }

  // LoRA 2
  if (lora2Name && ids.lora2) {
    nodes.push({ nodeId: ids.lora2, fieldName: 'lora_name', fieldValue: lora2Name, description: 'lora2' });
    nodes.push({ nodeId: ids.lora2, fieldName: 'strength_model', fieldValue: fmt(lora2Weight), description: 'lora2权重' });
  }

  // LoRA 3 — 仅默认模型和真实V3支持
  if (lora3Name && ids.lora3) {
    nodes.push({ nodeId: ids.lora3, fieldName: 'lora_name', fieldValue: lora3Name, description: 'lora3' });
    nodes.push({ nodeId: ids.lora3, fieldName: 'strength_model', fieldValue: fmt(lora3Weight), description: 'lora3权重' });
  }

  // Checkpoint — 仅随机提示词模型需要单独指定
  if (checkpoint && ids.checkpoint) {
    nodes.push({ nodeId: ids.checkpoint, fieldName: 'ckpt_name', fieldValue: checkpoint, description: 'Checkpoint模型' });
  }

  return nodes;
}
