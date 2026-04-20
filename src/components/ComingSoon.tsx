import React from 'react';
import { Video, Clock } from 'lucide-react';

export function ComingSoon() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 text-center animate-fade-in">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mb-6">
        <Video size={36} className="text-primary" />
      </div>

      <h2 className="text-xl font-semibold text-text-primary mb-2">图生视频</h2>
      <p className="text-sm text-text-secondary mb-8 max-w-[280px]">
        将静态图片转换为动态视频片段，让创作更加生动
      </p>

      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm">
        <Clock size={14} />
        即将上线
      </div>

      <div className="mt-10 w-full max-w-sm p-4 rounded-xl bg-bg-surface border border-border">
        <h3 className="text-sm font-medium text-text-primary mb-3">功能预告</h3>
        <ul className="space-y-2.5 text-sm text-text-secondary">
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            基于参考图片生成连贯视频
          </li>
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
            多种运动风格可选
          </li>
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            高清视频输出
          </li>
        </ul>
      </div>
    </div>
  );
}
