import { DEFAULT_TXT2IMG_PARAMS, KREA2_TXT2IMG_PARAMS } from '../constants';
import { WORKFLOW } from '../services/runninghub';
import {
  getCheckpointDefault,
  getLoraDefault,
  getDefaultWorkflow,
  getUnetDefault,
} from '../services/modelDefaultsService';

/**
 * 构建统一的文生图节点列表参数，确保任何模块调用文生图时
 * 都能正确使用文生图设置里的高级选项（lora1/2/3、unet、checkpoint、width/height/imageCount）。
 * 根据当前默认工作流（KREA2/THREE_LORA/REALISTIC_V3）自动选择对应参数集。
 *
 * - KREA2 工作流：使用 KREA2_TXT2IMG_PARAMS（含 unet 字段），无 checkpoint
 * - 其他工作流：使用 DEFAULT_TXT2IMG_PARAMS（含 checkpoint），无 unet
 *
 * 用户通过"模型库 → 设为默认"保存的设置（getLoraDefault / getUnetDefault / getCheckpointDefault）
 * 会覆盖代码内的硬编码默认值。
 */
export function buildUnifiedTxt2ImgOptions(prompt: string) {
  const wf = getDefaultWorkflow();
  const isKREA2 = wf === WORKFLOW.KREA2;
  const baseParams: {
    width: number;
    height: number;
    imageCount: number;
    lora1Name: string;
    lora1Weight: number;
    lora2Name: string;
    lora2Weight: number;
    lora3Name: string;
    lora3Weight: number;
    checkpoint?: string;
    unet?: string;
  } = isKREA2 ? KREA2_TXT2IMG_PARAMS : DEFAULT_TXT2IMG_PARAMS;

  const l1 = getLoraDefault('lora1');
  const l2 = getLoraDefault('lora2');
  const l3 = getLoraDefault('lora3');
  const ckpt = getCheckpointDefault(wf);
  const unetDefault = getUnetDefault();

  return {
    workflowId: wf,
    width: baseParams.width,
    height: baseParams.height,
    imageCount: baseParams.imageCount,
    prompt,
    lora1Name: l1?.name ?? baseParams.lora1Name,
    lora1Weight: l1?.weight ?? baseParams.lora1Weight,
    lora2Name: l2?.name ?? baseParams.lora2Name,
    lora2Weight: l2?.weight ?? baseParams.lora2Weight,
    lora3Name: l3?.name ?? baseParams.lora3Name,
    lora3Weight: l3?.weight ?? baseParams.lora3Weight,
    checkpoint: ckpt?.name ?? baseParams.checkpoint ?? '',
    unet: isKREA2 ? (unetDefault?.name ?? baseParams.unet ?? '') : '',
  };
}
