import { Plug, RefreshCw, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConnectorStatusBadge } from '@/components/common/StatusBadges';
import { TimeAgo } from '@/components/common/TimeDisplay';
import { useConnectors, useToggleConnector } from '@/hooks/useConnectors';
import { useUserRole } from '@/hooks/useUserRole';
import { canEditFeature } from '@/lib/permissions';
import { useToast } from '@/hooks/use-toast';

export function ConnectorStatus() {
  const { data: connectors = [], isLoading, refetch } = useConnectors();
  const toggleConnector = useToggleConnector();
  const { role } = useUserRole();
  const { toast } = useToast();

  const canEdit = canEditFeature('connectors', role);

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    try {
      await toggleConnector.mutateAsync({ id, enabled: !currentEnabled });
      toast({ title: `Connector ${!currentEnabled ? 'enabled' : 'disabled'}` });
    } catch (error) {
      toast({ title: 'Failed to update connector', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <Plug className="h-6 w-6 text-primary" />
            Connectors
          </h2>
          <p className="text-muted-foreground text-sm mt-1">Integration health and status</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {connectors.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No connectors configured
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {connectors.map((connector) => (
            <Card key={connector.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {canEdit && (
                      <Switch
                        checked={connector.enabled}
                        onCheckedChange={() => handleToggle(connector.id, connector.enabled)}
                      />
                    )}
                    <h4 className="font-medium">{connector.name}</h4>
                  </div>
                  <ConnectorStatusBadge status={connector.status} />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-xs">{connector.type}</Badge>
                  <span>{connector.executionCount} executions</span>
                  {connector.errorCount > 0 && (
                    <span className="text-destructive">{connector.errorCount} errors</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {connector.lastCheck && (
                    <span>Last check: <TimeAgo date={connector.lastCheck} /></span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {connector.actions.slice(0, 3).map((action) => (
                    <Badge key={action} variant="secondary" className="text-xs">
                      {action}
                    </Badge>
                  ))}
                  {connector.actions.length > 3 && (
                    <Badge variant="secondary" className="text-xs">
                      +{connector.actions.length - 3} more
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
