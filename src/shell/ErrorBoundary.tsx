// Keeps a bug in one view from blanking the whole window.
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}]`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div>
          <strong>Something went wrong in {this.props.label}.</strong>
          <p>Your boards and data are safe on disk.</p>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try Again
          </button>
        </div>
      </div>
    );
  }
}
