import { Link, Outlet, useLocation } from 'react-router-dom';
import { Activity } from 'lucide-react';

export default function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="h-12 border-b border-border flex items-center px-6 sticky top-0 z-50 bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2 flex-1">
          <Activity className="w-4 h-4 text-primary" strokeWidth={1.5} />
          <Link to="/" className="font-mono text-sm font-medium tracking-widest text-foreground hover:text-primary transition-colors uppercase">
            TraceCrumb
          </Link>
        </div>
        <nav className="flex items-center gap-6">
          <Link
            to="/"
            className={`font-mono text-xs tracking-wider uppercase transition-colors ${
              location.pathname === '/' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All Incidents
          </Link>
          <Link
            to="/incident/new"
            className="font-mono text-xs tracking-wider uppercase px-3 py-1.5 border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-all"
          >
            + New
          </Link>
        </nav>
      </header>

      {/* Main */}
      <main className="max-w-3xl mx-auto px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}