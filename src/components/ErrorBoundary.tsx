import React from 'react';
import { logger } from '../utils/clientLogger';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Name shown in error logs to identify which region crashed */
  name?: string;
  /** Callback invoked when an error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** Fallback UI to render when an error occurs */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  logId: string | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, logId: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const logId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.setState({ errorInfo, logId });

    logger.logReactError(error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false, error: null, errorInfo: null, logId: null });
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center gap-3 p-6 rounded-xl bg-red-500/10 border border-red-500/30 text-center">
          <p className="text-sm font-medium text-red-400">
            {this.props.name ? `"${this.props.name}" 区域发生错误` : '页面区域发生错误'}
          </p>
          {this.state.error && (
            <p className="text-xs text-text-secondary max-w-sm break-all">
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null, logId: null })}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
          >
            重试
          </button>
          {this.state.logId && (
            <p className="text-xs text-text-tertiary">日志ID: {this.state.logId}</p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
