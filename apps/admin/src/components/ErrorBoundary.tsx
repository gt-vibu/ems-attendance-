import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled React Error Boundary caught exception:', error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          padding: '40px 20px',
          margin: '20px auto',
          maxWidth: '600px',
          textAlign: 'center',
          fontFamily: 'sans-serif',
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          border: '1px solid #e2e8f0'
        }}>
          <h2 style={{ color: '#e53e3e', fontSize: '1.25rem', marginBottom: '12px' }}>
            Something went wrong while rendering this section.
          </h2>
          <p style={{ color: '#4a5568', fontSize: '0.9rem', marginBottom: '20px' }}>
            An unexpected user interface error occurred. You can reload or try again.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#3182ce',
              color: '#ffffff',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
