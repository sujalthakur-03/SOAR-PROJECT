import { Plug, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConnectorStatusBadge } from '@/components/common/StatusBadges';
import { TimeAgo } from '@/components/common/TimeDisplay';
import { mockConnectors } from '@/data/mockData';

export function ConnectorStatus() {
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
        <Button variant="outline" size="sm"><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {mockConnectors.map((connector) => (
          <Card key={connector.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">{connector.name}</h4>
                <ConnectorStatusBadge status={connector.status} />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-xs">{connector.type}</Badge>
                <span>{connector.execution_count} executions</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Last check: <TimeAgo date={connector.last_check} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
