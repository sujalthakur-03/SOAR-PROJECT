import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Search, User, Settings, Wifi, WifiOff, LogOut,
  Play, BookOpen, Briefcase, Loader2, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';

interface SearchResults {
  executions: Array<{
    execution_id: string;
    playbook_name: string;
    state: string;
    trigger_data?: { rule?: { description?: string }; severity?: string };
    created_at: string;
  }>;
  playbooks: Array<{
    playbook_id: string;
    name: string;
    description?: string;
    version: number;
    enabled: boolean;
    created_at: string;
  }>;
  cases: Array<{
    case_id: string;
    title: string;
    description?: string;
    severity: string;
    status: string;
    created_at: string;
  }>;
}

interface TopBarProps {
  isConnected: boolean;
  onNavigate?: (view: string) => void;
}

export function TopBar({ isConnected, onNavigate }: TopBarProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults(null);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await apiClient.globalSearch(query);
      setResults(data);
      setIsOpen(true);
    } catch {
      setResults(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!searchQuery.trim()) {
      setResults(null);
      setIsOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, performSearch]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const closeAndClear = () => {
    setSearchQuery('');
    setResults(null);
    setIsOpen(false);
  };

  const handleSelectExecution = (executionId: string) => {
    closeAndClear();
    navigate(`/executions/${executionId}`);
  };

  const handleSelectPlaybook = (_playbookId: string) => {
    closeAndClear();
    onNavigate?.('playbooks');
  };

  const handleSelectCase = (caseId: string) => {
    closeAndClear();
    navigate(`/cases/${caseId}`);
  };

  const handleSignOut = async () => {
    await signOut();
  };

  const hasResults = results &&
    (results.executions.length > 0 || results.playbooks.length > 0 || results.cases.length > 0);
  const isEmpty = results && !hasResults;

  const severityColor = (severity?: string) => {
    switch (severity?.toUpperCase()) {
      case 'CRITICAL': return 'text-red-400';
      case 'HIGH': return 'text-orange-400';
      case 'MEDIUM': return 'text-yellow-400';
      case 'LOW': return 'text-green-400';
      default: return 'text-muted-foreground';
    }
  };

  const stateColor = (state: string) => {
    switch (state) {
      case 'EXECUTING': return 'text-blue-400';
      case 'COMPLETED': return 'text-green-400';
      case 'FAILED': return 'text-red-400';
      case 'WAITING_APPROVAL': return 'text-yellow-400';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4">
      {/* Search */}
      <div className="relative w-80" ref={containerRef}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => { if (results) setIsOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Search alerts, playbooks, executions..."
          className="pl-9 pr-8 bg-muted/50 border-border focus:bg-background"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
        )}
        {!isLoading && searchQuery && (
          <button
            onClick={closeAndClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {/* Search Results Dropdown */}
        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 max-h-[420px] overflow-y-auto">
            {isEmpty && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No results found for "{searchQuery}"
              </div>
            )}

            {hasResults && (
              <>
                {/* Executions */}
                {results.executions.length > 0 && (
                  <div>
                    <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">
                      Executions
                    </div>
                    {results.executions.map((exec) => (
                      <button
                        key={exec.execution_id}
                        onClick={() => handleSelectExecution(exec.execution_id)}
                        className="w-full px-3 py-2 flex items-start gap-3 hover:bg-accent text-left transition-colors"
                      >
                        <Play className="h-4 w-4 mt-0.5 text-blue-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate">
                              {exec.execution_id}
                            </span>
                            <span className={cn('text-xs font-medium', stateColor(exec.state))}>
                              {exec.state}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {exec.playbook_name}
                            {exec.trigger_data?.rule?.description && ` - ${exec.trigger_data.rule.description}`}
                          </p>
                        </div>
                        {exec.trigger_data?.severity && (
                          <span className={cn('text-xs font-medium shrink-0', severityColor(exec.trigger_data.severity))}>
                            {exec.trigger_data.severity}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Playbooks */}
                {results.playbooks.length > 0 && (
                  <div>
                    <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">
                      Playbooks
                    </div>
                    {results.playbooks.map((pb) => (
                      <button
                        key={pb.playbook_id}
                        onClick={() => handleSelectPlaybook(pb.playbook_id)}
                        className="w-full px-3 py-2 flex items-start gap-3 hover:bg-accent text-left transition-colors"
                      >
                        <BookOpen className="h-4 w-4 mt-0.5 text-purple-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate">
                              {pb.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {pb.playbook_id}
                            </span>
                          </div>
                          {pb.description && (
                            <p className="text-xs text-muted-foreground truncate">
                              {pb.description}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">v{pb.version}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Cases */}
                {results.cases.length > 0 && (
                  <div>
                    <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">
                      Cases
                    </div>
                    {results.cases.map((c) => (
                      <button
                        key={c.case_id}
                        onClick={() => handleSelectCase(c.case_id)}
                        className="w-full px-3 py-2 flex items-start gap-3 hover:bg-accent text-left transition-colors"
                      >
                        <Briefcase className="h-4 w-4 mt-0.5 text-amber-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate">
                              {c.case_id}
                            </span>
                            <span className={cn('text-xs font-medium', severityColor(c.severity))}>
                              {c.severity}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {c.status}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {c.title}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Connection Status */}
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
            isConnected
              ? 'bg-status-success/10 text-status-success'
              : 'bg-status-error/10 text-status-error'
          )}
        >
          {isConnected ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-success opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-status-success" />
              </span>
              <Wifi className="h-3 w-3" />
              <span>Live</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3" />
              <span>Disconnected</span>
            </>
          )}
        </div>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-severity-critical" />
        </Button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                <User className="h-4 w-4 text-primary" />
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user?.fullName || 'SOC Analyst'}</p>
              <p className="text-xs text-muted-foreground">@{user?.username || 'analyst'}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onNavigate?.('settings')}>
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
