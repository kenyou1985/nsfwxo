import type { NodeInfo } from '../types';

export interface Txt2ImgNodeOptions {
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

export function buildTxt2ImgNodeList(options: Txt2ImgNodeOptions): NodeInfo[] {
  const {
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

  // Helper to format float weights to a clean decimal string (avoid JS float precision issues like 0.7500000000000001)
  const fmt = (n: number) => {
    const s = String(n);
    return s;
  };

  const nodes: NodeInfo[] = [
    { nodeId: '5', fieldName: 'width', fieldValue: String(width), description: '宽度' },
    { nodeId: '5', fieldName: 'height', fieldValue: String(height), description: '高度' },
    { nodeId: '5', fieldName: 'batch_size', fieldValue: String(imageCount), description: '数量' },
    { nodeId: '6', fieldName: 'text', fieldValue: prompt, description: '提示词' },
    {
      nodeId: '7',
      fieldName: 'text',
      fieldValue: negativePrompt || NEGATIVE_PROMPT_DEFAULT,
      description: '反向提示词',
    },
  ];

  if (lora1Name) {
    nodes.push({ nodeId: '11', fieldName: 'lora_name', fieldValue: lora1Name, description: 'lora1' });
    nodes.push({ nodeId: '11', fieldName: 'strength_model', fieldValue: fmt(lora1Weight), description: 'lora1权重' });
  }
  if (lora2Name) {
    nodes.push({ nodeId: '13', fieldName: 'lora_name', fieldValue: lora2Name, description: 'lora2' });
    nodes.push({ nodeId: '13', fieldName: 'strength_model', fieldValue: fmt(lora2Weight), description: 'lora2权重' });
  }
  if (lora3Name) {
    nodes.push({ nodeId: '15', fieldName: 'lora_name', fieldValue: lora3Name, description: 'lora3' });
    nodes.push({ nodeId: '15', fieldName: 'strength_model', fieldValue: fmt(lora3Weight), description: 'lora3权重' });
  }

  return nodes;
}
