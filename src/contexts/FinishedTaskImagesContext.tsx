import { createContext, useContext } from 'react';

export interface FinishedTaskInfo {
  images: string[];
  /** Which storyboard panel this belongs to (if any). */
  storyboardInfo?: { historyId: string; panelIdx: number };
  /** zipUrl for re-extracting from zip on cache miss. */
  zipUrl?: string;
}

export interface FinishedTaskImagesContextValue {
  /** Maps taskId → { images, storyboardInfo } for all completed tasks. */
  finishedTasks: Record<string, FinishedTaskInfo>;
  registerTaskImages: (taskId: string, images: string[], storyboardInfo?: { historyId: string; panelIdx: number }, zipUrl?: string) => void;
}

export const FinishedTaskImagesContext = createContext<FinishedTaskImagesContextValue>({
  finishedTasks: {},
  registerTaskImages: () => {},
});

export function useFinishedTaskImages() {
  return useContext(FinishedTaskImagesContext);
}
