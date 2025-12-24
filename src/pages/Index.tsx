import { useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { TopBar } from '@/components/layout/TopBar';
import { AlertsDashboard } from '@/components/views/AlertsDashboard';
import { PlaybookManager } from '@/components/views/PlaybookManager';
import { ExecutionTimeline } from '@/components/views/ExecutionTimeline';
import { ApprovalConsole } from '@/components/views/ApprovalConsole';
import { ConnectorStatus } from '@/components/views/ConnectorStatus';
import { AuditLog } from '@/components/views/AuditLog';
import { MetricsDashboard } from '@/components/views/MetricsDashboard';

const viewComponents: Record<string, React.ComponentType> = {
  alerts: AlertsDashboard,
  playbooks: PlaybookManager,
  executions: ExecutionTimeline,
  approvals: ApprovalConsole,
  connectors: ConnectorStatus,
  audit: AuditLog,
  metrics: MetricsDashboard,
};

const Index = () => {
  const [activeView, setActiveView] = useState('alerts');
  const ActiveComponent = viewComponents[activeView] || AlertsDashboard;

  return (
    <div className="flex h-screen w-full bg-background">
      <AppSidebar activeView={activeView} onViewChange={setActiveView} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar isConnected={true} />
        <main className="flex-1 overflow-auto p-6 scrollbar-thin">
          <ActiveComponent />
        </main>
      </div>
    </div>
  );
};

export default Index;
