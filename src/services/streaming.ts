/**
 * NDJSON streaming client for the prompt-engine endpoints under
 * /api/prompt/_/stream (underscore = any of: random, expand,
 * storyboard, storyboard/grid).
 *
 * Each backend stream endpoint emits one JSON object per line. Events:
 *   - start:   metadata for the slot / whole request
 *   - delta:   one text fragment (concatenate these to build the prompt)
 *   - end:     slot finished (carries the full prompt + labels)
 *   - panel:   storyboard-grid emitted one per validated panel
 *   - panel_skipped: panel rejected (safety / rewrite failure)
 *   - error:   fatal error for the slot or whole request
 *   - done:    always last, summary
 */

import { getYunwuKey, getBackendUrl } from './storage';

export type StreamEvent =
  | { event: 'start'; [k: string]: unknown }
  | { event: 'delta'; index?: number; text: string; [k: string]: unknown }
  | { event: 'end'; index: number; theme_label?: string; prompt: string; [k: string]: unknown }
  | { event: 'panel'; index: number; panel: { panel_number: number; scene_description: string; image_prompt: string }; [k: string]: unknown }
  | { event: 'panel_skipped'; index?: number; reason: string; [k: string]: unknown }
  | { event: 'error'; index?: number; message: string; fatal?: boolean; [k: string]: unknown }
  | { event: 'done'; total: number; successful: number; count?: number; [k: string]: unknown };

export interface StreamHandle {
  /** Abort the request (e.g. on component unmount or new request). */
  abort: () => void;
}

function buildAuthHeaders(): Record<string, string> {
  const yunwuKey = getYunwuKey();
  if (!yunwuKey) {
    throw new Error('OpenLux API Key 未设置，请在设置中配置 OpenLux API Key');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${yunwuKey}`,
    Accept: 'application/x-ndjson',
  };
}

/**
 * Open a POST to `path` and consume the response as NDJSON.
 *
 * Calls `onEvent` for every parsed line. Returns a StreamHandle for abort.
 * Throws on HTTP errors and on JSON parse errors (the caller may catch and
 * surface to the user).
 */
export async function openNdjsonStream(
  path: string,
  body: unknown,
  onEvent: (evt: StreamEvent) => void,
  onError?: (err: Error) => void,
): Promise<StreamHandle> {
  const controller = new AbortController();
  const base = getBackendUrl();
  const url = `${base}${path}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      // user-cancelled, no error toast
      return { abort: () => controller.abort() };
    }
    throw err instanceof Error ? err : new Error(String(err));
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '(no body)');
    const err = new Error(`HTTP ${resp.status}: ${resp.statusText} - ${text}`);
    onError?.(err);
    throw err;
  }

  if (!resp.body) {
    const err = new Error('响应没有可读的 body');
    onError?.(err);
    throw err;
  }

  // Stream consumption happens in the background so the caller can immediately
  // wire up the StreamHandle (for abort on unmount).
  (async () => {
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Split on newlines, keep the tail (incomplete line) in the buffer.
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) {
            try {
              const obj = JSON.parse(line) as StreamEvent;
              onEvent(obj);
            } catch (parseErr) {
              // Skip malformed lines but don't crash the whole stream.
              // eslint-disable-next-line no-console
              console.warn('[ndjson] failed to parse line:', line, parseErr);
            }
          }
          nl = buffer.indexOf('\n');
        }
      }
      // Flush any trailing line (some servers omit the final newline)
      const tail = buffer.trim();
      if (tail) {
        try {
          onEvent(JSON.parse(tail) as StreamEvent);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return { abort: () => controller.abort() };
}
