import { useState } from 'react';
import {
  ClipboardCheck,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { SeverityBadge } from '@/components/common/StatusBadges';
import { Countdown, TimeAgo } from '@/components/common/TimeDisplay';
import { mockApprovals } from '@/data/mockData';
import type { Approval } from '@/types/soar';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function ApprovalConsole() {
  const [approvals, setApprovals] = useState<Approval[]>(mockApprovals);
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);
  const [reason, setReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const processedApprovals = approvals.filter((a) => a.status !== 'pending');

  const handleApprove = async () => {
    if (!selectedApproval || !reason.trim()) {
      toast.error('Reason is required');
      return;
    }
    setIsProcessing(true);
    // Simulate API call
    await new Promise((r) => setTimeout(r, 1000));
    setApprovals((prev) =>
      prev.map((a) =>
        a.id === selectedApproval.id
          ? {
              ...a,
              status: 'approved' as const,
              decided_by: 'analyst@cybersentinel.io',
              decided_at: new Date().toISOString(),
              reason,
            }
          : a
      )
    );
    setIsProcessing(false);
    setSelectedApproval(null);
    setReason('');
    toast.success('Action approved');
  };

  const handleReject = async () => {
    if (!selectedApproval || !reason.trim()) {
      toast.error('Reason is required');
      return;
    }
    setIsProcessing(true);
    await new Promise((r) => setTimeout(r, 1000));
    setApprovals((prev) =>
      prev.map((a) =>
        a.id === selectedApproval.id
          ? {
              ...a,
              status: 'rejected' as const,
              decided_by: 'analyst@cybersentinel.io',
              decided_at: new Date().toISOString(),
              reason,
            }
          : a
      )
    );
    setIsProcessing(false);
    setSelectedApproval(null);
    setReason('');
    toast.success('Action rejected');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            Approval Console
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Review and approve pending automated actions
          </p>
        </div>
        {pendingApprovals.length > 0 && (
          <Badge className="bg-status-warning/20 text-status-warning border-status-warning/30">
            <Clock className="h-3 w-3 mr-1" />
            {pendingApprovals.length} pending
          </Badge>
        )}
      </div>

      {/* Pending Approvals */}
      {pendingApprovals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-12 w-12 text-status-success mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium">All caught up!</h3>
            <p className="text-muted-foreground text-sm mt-1">
              No pending approvals at this time.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Pending Approvals ({pendingApprovals.length})
          </h3>
          {pendingApprovals.map((approval) => (
            <Card
              key={approval.id}
              className="border-status-warning/30 bg-status-warning/5"
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Alert Icon */}
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-status-warning/20">
                    <AlertTriangle className="h-5 w-5 text-status-warning" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium">{approval.proposed_action}</h4>
                        <p className="text-sm text-muted-foreground">
                          Playbook: {approval.playbook_name}
                        </p>
                      </div>
                      <Countdown expiresAt={approval.expires_at} />
                    </div>

                    {/* Alert Context */}
                    <div className="bg-card rounded-lg p-3 border border-border">
                      <div className="flex items-center gap-3 text-sm">
                        <SeverityBadge severity={approval.alert.severity} />
                        <span className="font-medium">{approval.alert.rule_name}</span>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {approval.alert.id}
                        </code>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {approval.alert.description}
                      </p>
                    </div>

                    {/* Action Details */}
                    <div className="flex items-center gap-4 text-xs">
                      {Object.entries(approval.action_details).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-1">
                          <span className="text-muted-foreground">{key}:</span>
                          <code className="bg-muted px-1.5 py-0.5 rounded">
                            {String(value)}
                          </code>
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        size="sm"
                        onClick={() => setSelectedApproval(approval)}
                        className="bg-status-success hover:bg-status-success/90"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setSelectedApproval(approval)}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                      <Button size="sm" variant="outline">
                        View Alert
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Processed Approvals */}
      {processedApprovals.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Recent Decisions
          </h3>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {processedApprovals.map((approval) => (
                  <div
                    key={approval.id}
                    className="flex items-center justify-between p-4"
                  >
                    <div className="flex items-center gap-3">
                      {approval.status === 'approved' ? (
                        <CheckCircle2 className="h-5 w-5 text-status-success" />
                      ) : (
                        <XCircle className="h-5 w-5 text-status-error" />
                      )}
                      <div>
                        <p className="text-sm font-medium">
                          {approval.proposed_action}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {approval.playbook_name}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge
                        variant="outline"
                        className={cn(
                          'capitalize',
                          approval.status === 'approved'
                            ? 'border-status-success text-status-success'
                            : 'border-status-error text-status-error'
                        )}
                      >
                        {approval.status}
                      </Badge>
                      {approval.decided_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          <TimeAgo date={approval.decided_at} />
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Approval/Reject Dialog */}
      <Dialog
        open={!!selectedApproval}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedApproval(null);
            setReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Confirm Decision
            </DialogTitle>
            <DialogDescription>
              You are about to approve or reject the following action. This decision
              will be logged for audit purposes.
            </DialogDescription>
          </DialogHeader>

          {selectedApproval && (
            <div className="space-y-4 py-4">
              <div className="bg-muted rounded-lg p-3">
                <p className="font-medium text-sm">
                  {selectedApproval.proposed_action}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Playbook: {selectedApproval.playbook_name}
                </p>
              </div>

              <div className="space-y-2">
                <Label>
                  Reason <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Provide justification for your decision..."
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedApproval(null)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isProcessing || !reason.trim()}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Reject
            </Button>
            <Button
              onClick={handleApprove}
              disabled={isProcessing || !reason.trim()}
              className="bg-status-success hover:bg-status-success/90"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
