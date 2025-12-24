import { FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { mockAuditLog } from '@/data/mockData';
import { cn } from '@/lib/utils';

export function AuditLog() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" />
          Audit Log
        </h2>
        <p className="text-muted-foreground text-sm mt-1">Immutable record of all SOAR activities</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Timestamp</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead className="w-24">Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockAuditLog.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono text-xs">{new Date(entry.timestamp).toLocaleString()}</TableCell>
                  <TableCell><span className="text-sm">{entry.actor}</span><br/><span className="text-xs text-muted-foreground">{entry.actor_role}</span></TableCell>
                  <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{entry.action}</code></TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{entry.resource_type}</Badge> <code className="text-xs">{entry.resource_id}</code></TableCell>
                  <TableCell><Badge variant="outline" className={cn("text-xs", entry.outcome === 'success' ? 'border-status-success text-status-success' : 'border-status-error text-status-error')}>{entry.outcome}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
