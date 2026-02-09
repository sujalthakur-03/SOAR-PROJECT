import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { TopBar } from '@/components/layout/TopBar';
import { ExecutionsDashboard } from '@/components/views/ExecutionsDashboard';
import { PlaybookManager } from '@/components/views/PlaybookManager';
import { ExecutionTimeline as ExecutionTimelineEnhanced } from '@/components/views/ExecutionTimelineEnhanced';
import { ApprovalConsole } from '@/components/views/ApprovalConsole';
import { ConnectorConfig } from '@/components/views/ConnectorConfig';
import { AuditLog } from '@/components/views/AuditLog';
import { MetricsDashboard } from '@/components/views/MetricsDashboard';
import CasesDashboard from '@/components/views/CasesDashboard';
import { SettingsPage } from '@/components/views/SettingsPage';
import { useUserRole } from '@/hooks/useUserRole';
import { canViewFeature } from '@/lib/permissions';

const viewComponents: Record<string, React.ComponentType> = {
  executions: ExecutionTimelineEnhanced,
  playbooks: PlaybookManager,
  approvals: ApprovalConsole,
  connectors: ConnectorConfig,
  audit: AuditLog,
  metrics: MetricsDashboard,
  cases: CasesDashboard,
  settings: SettingsPage,
};

const Index = () => {
  const { role } = useUserRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialView = searchParams.get('view') || 'executions';
  const [activeView, setActiveView] = useState(initialView);

  const handleViewChange = useCallback((view: string) => {
    setActiveView(view);
    // Keep URL in sync so back navigation preserves view
    setSearchParams(view === 'executions' ? {} : { view }, { replace: true });
  }, [setSearchParams]);

  // Reset to a valid view if current view is not accessible
  useEffect(() => {
    if (role && !canViewFeature(activeView, role)) {
      // Find the first accessible view
      const accessibleView = Object.keys(viewComponents).find(view => 
        canViewFeature(view, role)
      );
      if (accessibleView) {
        setActiveView(accessibleView);
      }
    }
  }, [role, activeView]);

  const ActiveComponent = viewComponents[activeView] || ExecutionsDashboard;

  return (
    <div className="flex h-screen w-full bg-background">
      <AppSidebar activeView={activeView} onViewChange={handleViewChange} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar isConnected={true} onNavigate={handleViewChange} />
        <main className="flex-1 overflow-auto p-6 scrollbar-thin">
          <ActiveComponent />
        </main>
      </div>
    </div>
  );
};

export default Index;
