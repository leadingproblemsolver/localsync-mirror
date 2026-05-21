// Gap #14: app-root error boundary so a render-time throw degrades to a
// recoverable page instead of a white screen.

import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  handleReload = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  handleHome = () => {
    if (typeof window !== 'undefined') window.location.assign('/');
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full border border-border bg-card p-6 text-center">
          <h1 className="font-mono text-lg text-foreground mb-2">
            This page didn’t load
          </h1>
          <p className="font-mono text-xs text-muted-foreground mb-5">
            Something went wrong rendering the view. You can try again or head home.
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={this.handleReload}
              className="px-4 py-2 bg-primary text-primary-foreground font-mono text-xs uppercase tracking-wider hover:bg-primary/90 transition-all"
            >
              Try again
            </button>
            <button
              onClick={this.handleHome}
              className="px-4 py-2 border border-border text-muted-foreground font-mono text-xs uppercase tracking-wider hover:text-foreground transition-all"
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
