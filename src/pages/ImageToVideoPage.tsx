import React, { useState, useCallback, useRef } from 'react';
import { Video, Upload, Image as ImageIcon } from 'lucide-react';
import { ImageUploader } from '../components/ImageUploader';
import { ParameterSlider } from '../components/ParameterSlider';
import { ParameterSelect } from '../components/ParameterSelect';
import { GenerateButton } from '../components/GenerateButton';
import { VideoTaskList, type VideoTask } from '../components/VideoTaskList';
import { uploadImage } from '../services/runninghub';
import type { NodeInfo } from '../types';

const DURATION_OPTIONS = [
  { value: '5', label: '5秒' },
  { value: '8', label: '8秒' },
];

const RESOLUTION_OPTIONS = [
  { value: '512', label: '512px (快速)' },
  { value: '720', label: '720px (推荐)' },
  { value: '1024', label: '1024px (高清)' },
];

const LORA_HIGH_OPTIONS = [
  { value: 'SmoothMixAnimationStyle_High.safetensors', label: 'SmoothMixAnimationStyle_High (默认)' },
];

const LORA_LOW_OPTIONS = [
  { value: 'SmoothMixAnimation_Low.safetensors', label: 'SmoothMixAnimation_Low (默认)' },
];

interface ImageToVideoPageProps {
  apiKey: string;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export function ImageToVideoPage({ apiKey, onError, onSuccess }: ImageToVideoPageProps) {
  const [imagePath, setImagePath] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState('5');
  const [resolution, setResolution] = useState('720');
  const [interpolation, setInterpolation] = useState(false);
  const [loraHigh, setLoraHigh] = useState('SmoothMixAnimationStyle_High.safetensors');
  const [loraHighWeight, setLoraHighWeight] = useState(1.0);
  const [loraLow, setLoraLow] = useState('SmoothMixAnimation_Low.safetensors');
  const [loraLowWeight, setLoraLowWeight] = useState(1.0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const taskListRef = useRef<{ submitTask: (prompt: string, imagePath: string, imagePreview: string, nodeInfoList: NodeInfo[]) => void } | null>(null);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploadError(null);
      try {
        const objectUrl = URL.createObjectURL(file);
        setImagePreview(objectUrl);

        const { imagePath: path } = await uploadImage(apiKey, file);
        setImagePath(path);
        onSuccess('图片上传成功');
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : '上传失败');
        throw err;
      }
    },
    [apiKey, onSuccess]
  );

  const handleImageSelect = (path: string, preview: string) => {
    setImagePath(path);
    setImagePreview(preview);
  };

  const buildNodeList = (): NodeInfo[] => {
    const nodeList: NodeInfo[] = [
      { nodeId: '28', fieldName: 'value', fieldValue: resolution, description: '最长边' },
      { nodeId: '20', fieldName: 'value', fieldValue: duration, description: '时长（秒）' },
      { nodeId: '77', fieldName: 'value', fieldValue: String(interpolation), description: '补帧（默认关）' },
      { nodeId: '21', fieldName: 'image', fieldValue: imagePath, description: '图片上传' },
      { nodeId: '38', fieldName: 'value', fieldValue: prompt, description: '提示词' },
    ];

    if (loraHigh) {
      nodeList.push(
        { nodeId: '42', fieldName: 'lora_name', fieldValue: loraHigh, description: 'lora（high）' },
        { nodeId: '42', fieldName: 'strength_model', fieldValue: String(loraHighWeight), description: 'lora权重' }
      );
    }
    if (loraLow) {
      nodeList.push(
        { nodeId: '43', fieldName: 'lora_name', fieldValue: loraLow, description: 'lora（low）' },
        { nodeId: '43', fieldName: 'strength_model', fieldValue: String(loraLowWeight), description: 'lora权重' }
      );
    }

    return nodeList;
  };

  const handleSubmit = () => {
    if (!imagePath) {
      onError('请上传或选择一张图片');
      return;
    }
    if (!prompt.trim()) {
      onError('请输入提示词');
      return;
    }
    if (isSubmitting) return;

    taskListRef.current?.submitTask(prompt, imagePath, imagePreview, buildNodeList());
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Task list */}
      <VideoTaskList
        ref={taskListRef}
        apiKey={apiKey}
        onError={onError}
        onSuccess={onSuccess}
        maxTasks={10}
      />

      {/* Input form */}
      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <ImageIcon size={16} className="text-primary" />
          选择图片
        </h3>
        <ImageUploader
          value={imagePath}
          previewUrl={imagePreview}
          onChange={handleImageSelect}
          onUpload={handleUpload}
          disabled={isSubmitting}
          error={uploadError || undefined}
        />
      </div>

      <div className="rounded-xl bg-bg-surface border border-border p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <Video size={16} className="text-primary" />
          视频参数
        </h3>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-text-secondary mb-1.5 block">提示词</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述视频中的人物动作、表情、场景变化..."
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-primary/50 resize-none"
              rows={3}
              disabled={isSubmitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <ParameterSelect
              label="时长"
              value={duration}
              options={DURATION_OPTIONS}
              onChange={setDuration}
              disabled={isSubmitting}
            />
            <ParameterSelect
              label="分辨率"
              value={resolution}
              options={RESOLUTION_OPTIONS}
              onChange={setResolution}
              disabled={isSubmitting}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setInterpolation(!interpolation)}
              className={`w-10 h-6 rounded-full transition-colors relative ${
                interpolation ? 'bg-primary' : 'bg-text-tertiary'
              }`}
              disabled={isSubmitting}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  interpolation ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-xs text-text-secondary">补帧（视频更流畅但耗时更长）</span>
          </div>

          <div className="border-t border-border/50 pt-4">
            <h4 className="text-xs text-text-secondary mb-3">LoRA 设置（可选）</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <ParameterSelect
                  label="High LoRA"
                  value={loraHigh}
                  options={LORA_HIGH_OPTIONS}
                  onChange={setLoraHigh}
                  disabled={isSubmitting}
                />
                {loraHigh && (
                  <div className="mt-2">
                    <ParameterSlider
                      label="权重"
                      value={loraHighWeight}
                      min={0.1}
                      max={2}
                      step={0.1}
                      onChange={setLoraHighWeight}
                      disabled={isSubmitting}
                    />
                  </div>
                )}
              </div>
              <div>
                <ParameterSelect
                  label="Low LoRA"
                  value={loraLow}
                  options={LORA_LOW_OPTIONS}
                  onChange={setLoraLow}
                  disabled={isSubmitting}
                />
                {loraLow && (
                  <div className="mt-2">
                    <ParameterSlider
                      label="权重"
                      value={loraLowWeight}
                      min={0.1}
                      max={2}
                      step={0.1}
                      onChange={setLoraLowWeight}
                      disabled={isSubmitting}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-2 pb-4">
        <GenerateButton
          onClick={handleSubmit}
          isLoading={isSubmitting}
          disabled={!imagePath || !prompt.trim() || isSubmitting}
          label={isSubmitting ? '提交中...' : '生成视频'}
        />
      </div>
    </div>
  );
}
