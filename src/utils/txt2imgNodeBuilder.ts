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
  /** 3LoRA 模型专用：随机提示词开关（对应 nodeId 105） */
  threeLoraRandomPrompt?: boolean;
}

const NEGATIVE_PROMPT_DEFAULT = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet';

interface DimNode {
  nodeId: string;
  fieldName: string;
}

interface LoraSlot {
  loraNode: string;
  weightNode: string;
  weightField: string;
}

interface NodeIds {
  width: DimNode;
  height: DimNode;
  batchSize: DimNode;
  positivePrompt: string;
  negativePrompt?: string;
  lora1: string;
  lora2: string;
  lora3?: string;
  checkpoint?: string;
  /** 3LoRA 模型：LoRA 权重在单独的节点 */
  loraSlot?: {
    lora1: LoraSlot;
    lora2: LoraSlot;
    lora3: LoraSlot;
  };
  /** 额外选项节点 */
  extra?: {
    negPromptEnable?: DimNode;
    randomPromptEnable?: DimNode;
    options?: DimNode;
    clothes?: DimNode;
  };
}

/** 真实系批量文生图（默认） — width/height/batch 共用 nodeId=5 */
const DEFAULT_NODES: NodeIds = {
  width: { nodeId: '5', fieldName: 'width' },
  height: { nodeId: '5', fieldName: 'height' },
  batchSize: { nodeId: '5', fieldName: 'batch_size' },
  positivePrompt: '6',
  negativePrompt: '7',
  lora1: '11',
  lora2: '13',
  lora3: '15',
  checkpoint: undefined,
};

/** 3LoRA 模型 — width/height/batch 各有独立 nodeId，LoRA 权重是单独节点 */
const THREE_LORA_NODES: NodeIds = {
  width: { nodeId: '8', fieldName: 'value' },
  height: { nodeId: '9', fieldName: 'value' },
  batchSize: { nodeId: '10', fieldName: 'value' },
  positivePrompt: '24',
  negativePrompt: undefined,
  lora1: '21',
  lora2: '17',
  lora3: '16',
  checkpoint: '13',
  // 3LoRA: LoRA 权重是单独的 nodeId（不在 LoRA 节点上）
  loraSlot: {
    lora1: { loraNode: '21', weightNode: '11', weightField: 'value' },
    lora2: { loraNode: '17', weightNode: '17', weightField: 'strength_model' },
    lora3: { loraNode: '16', weightNode: '15', weightField: 'value' },
  },
  extra: {
    negPromptEnable: { nodeId: '100', fieldName: 'value' },
    randomPromptEnable: { nodeId: '105', fieldName: 'value' },
    options: { nodeId: '106', fieldName: 'value' },
    clothes: { nodeId: '107', fieldName: 'value' },
  },
};

/** 真实 V3 模型 — width/height/batch 各有独立 nodeId */
const REALISTIC_V3_NODES: NodeIds = {
  width: { nodeId: '146', fieldName: 'value' },
  height: { nodeId: '147', fieldName: 'value' },
  batchSize: { nodeId: '148', fieldName: 'value' },
  positivePrompt: '168',
  negativePrompt: undefined,
  lora1: '172',
  lora2: '161',
  lora3: '158',
  checkpoint: undefined,
};

function getNodeIds(workflowId: string): NodeIds {
  switch (workflowId) {
    case WORKFLOW.THREE_LORA:
      return THREE_LORA_NODES;
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
    threeLoraRandomPrompt = false,
  } = options;

  const ids = getNodeIds(workflowId || WORKFLOW.THREE_LORA);

  // Helper to format float weights to a clean decimal string (avoid JS float precision issues like 0.7500000000000001)
  const fmt = (n: number) => {
    const s = String(n);
    return s;
  };

  const nodes: NodeInfo[] = [
    { nodeId: ids.width.nodeId, fieldName: ids.width.fieldName, fieldValue: String(width), description: '宽度' },
    { nodeId: ids.height.nodeId, fieldName: ids.height.fieldName, fieldValue: String(height), description: '高度' },
    { nodeId: ids.batchSize.nodeId, fieldName: ids.batchSize.fieldName, fieldValue: String(imageCount), description: '数量' },
    { nodeId: ids.positivePrompt, fieldName: 'text', fieldValue: String(prompt || ''), description: '提示词' },
  ];

  // 真实 V3 — 添加图片放大节点（默认关闭）
  if (workflowId === WORKFLOW.REALISTIC_V3) {
    nodes.push({ nodeId: '267', fieldName: 'value', fieldValue: 'false', description: '图片放大' });
  }

  // 3LoRA — 负面提示词默认关闭；随机提示词开关由 UI 控制
  if (workflowId === WORKFLOW.THREE_LORA) {
    nodes.push({ nodeId: '100', fieldName: 'value', fieldValue: 'false', description: '启用反向提示词' });
    nodes.push({ nodeId: '105', fieldName: 'value', fieldValue: threeLoraRandomPrompt ? 'true' : 'false', description: '添加随机提示词' });
  }

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
    if (ids.loraSlot?.lora1) {
      nodes.push({ nodeId: ids.loraSlot.lora1.weightNode, fieldName: ids.loraSlot.lora1.weightField, fieldValue: fmt(lora1Weight), description: 'lora1权重' });
    } else {
      nodes.push({ nodeId: ids.lora1, fieldName: 'strength_model', fieldValue: fmt(lora1Weight), description: 'lora1权重' });
    }
  }

  // LoRA 2
  if (lora2Name && ids.lora2) {
    nodes.push({ nodeId: ids.lora2, fieldName: 'lora_name', fieldValue: lora2Name, description: 'lora2' });
    if (ids.loraSlot?.lora2) {
      nodes.push({ nodeId: ids.loraSlot.lora2.weightNode, fieldName: ids.loraSlot.lora2.weightField, fieldValue: fmt(lora2Weight), description: 'lora2权重' });
    } else {
      nodes.push({ nodeId: ids.lora2, fieldName: 'strength_model', fieldValue: fmt(lora2Weight), description: 'lora2权重' });
    }
  }

  // LoRA 3 — 仅默认模型和真实V3支持
  if (lora3Name && ids.lora3) {
    nodes.push({ nodeId: ids.lora3, fieldName: 'lora_name', fieldValue: lora3Name, description: 'lora3' });
    if (ids.loraSlot?.lora3) {
      nodes.push({ nodeId: ids.loraSlot.lora3.weightNode, fieldName: ids.loraSlot.lora3.weightField, fieldValue: fmt(lora3Weight), description: 'lora3权重' });
    } else {
      nodes.push({ nodeId: ids.lora3, fieldName: 'strength_model', fieldValue: fmt(lora3Weight), description: 'lora3权重' });
    }
  }

  // Checkpoint — 用户未设置时直接不推 ckpt_name 节点（让 RunningHub 工作流使用自身默认）
  if (checkpoint && ids.checkpoint) {
    nodes.push({ nodeId: ids.checkpoint, fieldName: 'ckpt_name', fieldValue: checkpoint, description: 'Checkpoint模型' });
  }

  return nodes;
}
