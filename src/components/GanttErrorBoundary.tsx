/**
 * GanttErrorBoundary.tsx
 *
 * React Error Boundary specifically for the Gantt viewer panels.
 * (https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)
 *
 * WHY THIS EXISTS:
 *   If the canvas rendering code in GanttChartAdvanced throws an error
 *   (e.g. a null date, a missing activity reference), React unmounts the
 *   entire component tree. Without an error boundary, the user sees a
 *   white screen with no way to recover except refreshing.
 *
 *   With this boundary, the crashed panel shows an error message with
 *   a "Try Again" button, while the rest of the app continues to work.
 *
 * SENTRY INTEGRATION:
 *   If Sentry is configured (PR4), caught errors are automatically reported
 *   with full stack trace and component context. If Sentry is not configured,
 *   errors are only logged to console.
 *
 * USAGE:
 *   <GanttErrorBoundary panelName="Gantt Chart">
 *     <GanttChartAdvanced ... />
 *   </GanttErrorBoundary>
 *
 * NOTE: Error boundaries must be class components — React does not yet
 * support error boundaries as function components with hooks.
 */

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface GanttErrorBoundaryProps {
  children: React.ReactNode;
  /** Label shown in the error UI (e.g. "Gantt Chart", "Activity Table") */
  panelName?: string;
}

interface GanttErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ============================================================================
// Component
// ============================================================================

export class GanttErrorBoundary extends React.Component<
  GanttErrorBoundaryProps,
  GanttErrorBoundaryState
> {
  constructor(props: GanttErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): GanttErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(
      `[GanttErrorBoundary] ${this.props.panelName || 'Component'} crashed:`,
      error,
      errorInfo.componentStack
    );

    // Report to Sentry if available (dynamic import avoids hard dependency)
    import('../lib/sentry')
      .then(({ captureError }) => {
        captureError(error, {
          panelName: this.props.panelName || 'unknown',
          componentStack: errorInfo.componentStack,
        });
      })
      .catch(() => {
        // Sentry not available — already logged to console above
      });
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex items-center justify-center bg-gray-50">
          <div className="text-center max-w-sm p-6">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 mb-1">
              {this.props.panelName || 'Panel'} encountered an error
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              {this.state.error?.message || 'An unexpected error occurred.'}
              {' '}This has been reported automatically.
            </p>
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
