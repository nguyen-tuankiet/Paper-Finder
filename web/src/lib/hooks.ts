import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchRequest, SearchResult, SourceHealth, SourceId } from '../../../shared/types';
import { ApiError, fetchSourceHealth, streamSearch } from './api';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export interface SourcesHealthState {
  status: 'loading' | 'ready' | 'unreachable';
  sources: SourceHealth[];
}

/** Kiểm tra kết nối nguồn dữ liệu khi mở trang, định kỳ và khi mạng trở lại. */
export function useSourceHealth(online: boolean): SourcesHealthState {
  const [state, setState] = useState<SourcesHealthState>({ status: 'loading', sources: [] });

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    const load = () =>
      fetchSourceHealth(controller.signal)
        .then((sources) => setState({ status: 'ready', sources }))
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.kind === 'cancelled') return;
          if (controller.signal.aborted) return;
          setState({ status: 'unreachable', sources: [] });
        });
    void load();
    const timer = setInterval(() => void load(), 90_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [online]);

  return state;
}

export interface SourceProgress {
  keyword: string;
  fetched: number;
  target: number;
  done: boolean;
}

export type SearchPhase = 'idle' | 'searching' | 'done' | 'failed' | 'cancelled';

export interface SearchState {
  phase: SearchPhase;
  progress: Partial<Record<SourceId, SourceProgress>>;
  result: SearchResult | null;
  error: string | null;
  start: (request: SearchRequest) => void;
  cancel: () => void;
}

export function useSearch(): SearchState {
  const [phase, setPhase] = useState<SearchPhase>('idle');
  const [progress, setProgress] = useState<SearchState['progress']>({});
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback((request: SearchRequest) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase('searching');
    setProgress({});
    setResult(null);
    setError(null);

    streamSearch(request, controller.signal, (event) => {
      if (controller.signal.aborted) return;
      if (event.type === 'progress') {
        setProgress((prev) => ({ ...prev, [event.source]: { keyword: event.keyword, fetched: event.fetched, target: event.target, done: event.done } }));
      } else if (event.type === 'result') {
        setResult(event.result);
        setPhase('done');
      } else if (event.type === 'error') {
        setError(event.message);
        setPhase('failed');
      }
    }).catch((err: unknown) => {
      if (controller.signal.aborted) {
        setPhase('cancelled');
        return;
      }
      setError(err instanceof Error ? err.message : 'Đã xảy ra lỗi không xác định.');
      setPhase('failed');
    });
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { phase, progress, result, error, start, cancel };
}
