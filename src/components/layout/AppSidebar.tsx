import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Shield,
  AlertTriangle,
  PlayCircle,
  ClipboardCheck,
  Plug,
  FileText,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Radio,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

const navItems = [
  { id: 'alerts', label: 'Live Alerts', icon: AlertTriangle, badge: 5 },
  { id: 'playbooks', label: 'Playbooks', icon: PlayCircle },
  { id: 'executions', label: 'Executions', icon: Radio },
  { id: 'approvals', label: 'Approvals', icon: ClipboardCheck, badge: 2 },
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'audit', label: 'Audit Log', icon: FileText },
  { id: 'metrics', label: 'Metrics', icon: BarChart3 },
];

export function AppSidebar({ activeView, onViewChange }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-sidebar-border">
        <Shield className="h-8 w-8 text-primary flex-shrink-0" />
        {!collapsed && (
          <div className="ml-3 overflow-hidden">
            <h1 className="font-semibold text-sidebar-foreground text-sm leading-tight">
              CyberSentinel
            </h1>
            <span className="text-[10px] text-primary font-medium tracking-wider">
              SOAR
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          const Icon = item.icon;

          const button = (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge && (
                    <span
                      className={cn(
                        'px-1.5 py-0.5 text-xs font-semibold rounded-full',
                        item.id === 'alerts'
                          ? 'bg-severity-critical/20 text-severity-critical'
                          : 'bg-status-pending/20 text-status-pending'
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </button>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.id} delayDuration={0}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right" className="flex items-center gap-2">
                  {item.label}
                  {item.badge && (
                    <span className="px-1.5 py-0.5 text-xs font-semibold rounded-full bg-primary/20 text-primary">
                      {item.badge}
                    </span>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          }

          return button;
        })}
      </nav>

      {/* Collapse Toggle */}
      <div className="p-2 border-t border-sidebar-border">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}
