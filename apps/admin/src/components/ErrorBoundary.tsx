import React, { Component, ReactNode, ErrorInfo } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class InnerErrorBoundary extends (Component as any)<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled React Error Boundary caught exception:', error, errorInfo);
  }

  render() {
    const state = (this as any).state;
    const props = (this as any).props;

    if (state?.hasError) {
      if (props?.fallback) {
        return props.fallback;
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

    return props?.children;
  }
}

export const ErrorBoundary = InnerErrorBoundary as unknown as React.FC<ErrorBoundaryProps>;
