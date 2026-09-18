import React from 'react';

// The net under every screen.
//
// When a render throws, React unmounts the WHOLE tree — the app goes to the
// wallpaper and stays there, which on an iPad is indistinguishable from a
// freeze (you can't even reach another tab to get out of it). One missing
// import was enough to do that to Coaches Corner. Catching here keeps the
// topbar alive, so the app is still navigable, and says what broke instead of
// showing nothing.
//
// Nothing here touches stored data: a crashed render never got as far as
// writing, and the library is on disk in IndexedDB either way.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    // Switching screens clears it — the failure belonged to the old one, and
    // the tab you just pressed deserves a fresh try.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error, info) {
    // Still worth the console: it's the only trace if someone reports it.
    console.error('[Repertoire Lab] screen crashed:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="empty-note" style={{ maxWidth: 560, margin: '48px auto' }}>
        <p style={{ fontSize: 17, color: 'var(--text)', marginBottom: 6 }}>
          This screen hit a bug
        </p>
        <p style={{ margin: '0 0 10px' }}>
          Nothing has been lost — your repertoire, games and progress are still saved. Pick another
          tab above to keep working, or reload to start this screen again.
        </p>
        <p className="muted-note" style={{ display: 'block', marginBottom: 14, fontFamily: 'ui-monospace, monospace' }}>
          {String(error?.message ?? error)}
        </p>
        <button className="primary" onClick={() => window.location.reload()}>Reload the app</button>
      </div>
    );
  }
}
