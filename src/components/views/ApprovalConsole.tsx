import { useState } from 'react';
import {
  ClipboardCheck,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Shield,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Countdown, TimeAgo } from '@/components/common/TimeDisplay';
import { useApprovals, useApproveAction, useRejectAction, type Approval } from '@/hooks/useApprovals';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export function ApprovalConsole() {
  const { data: approvals = [], isLoading, refetch } = useApprovals();
  const approveAction = useApproveAction();
  const rejectAction = useRejectAction();
  const { toast } = useToast();
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);
  const [reason, setReason] = useState('');
  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null);

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const processedApprovals = approvals.filter((a) => a.status !== 'pending');

  const handleApprove = async () => {
    if (!selectedApproval || !reason.trim()) {
      toast({ title: 'Reason is required', variant: 'destructive' });
      return;
    }
    try {
      await approveAction.mutateAsync({ id: selectedApproval.id, reason });
      toast({ title: 'Action approved' });
      setSelectedApproval(null);
      setReason('');
      setActionType(null);
    } catch (error) {
      toast({ title: 'Failed to approve', variant: 'destructive' });
    }
  };

  const handleReject = async () => {
    if (!selectedApproval || !reason.trim()) {
      toast({ title: 'Reason is required', variant: 'destructive' });
      return;
    }
    try {
      await rejectAction.mutateAsync({ id: selectedApproval.id, reason });
      toast({ title: 'Action rejected' });
      setSelectedApproval(null);
      setReason('');
      setActionType(null);
    } catch (error) {
      toast({ title: 'Failed to reject', variant: 'destructive' });
    }
  };

  const openDialog = (approval: Approval, type: 'approve' | 'reject') => {
    setSelectedApproval(approval);
    setActionType(type);
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
        <div className="flex items-center gap-2">
          {pendingApprovals.length > 0 && (
            <Badge className="bg-status-warning/20 text-status-warning border-status-warning/30">
              <Clock className="h-3 w-3 mr-1" />
              {pendingApprovals.length} pending
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
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
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-status-warning/20">
                    <AlertTriangle className="h-5 w-5 text-status-warning" />
                  </div>

                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium">{approval.proposedAction}</h4>
                        <p className="text-sm text-muted-foreground">
                          Playbook: {approval.playbookName}
                        </p>
                      </div>
                      <Countdown expiresAt={approval.expiresAt} />
                    </div>

                    {/* Action Details */}
                    <div className="flex items-center gap-4 text-xs">
                      {Object.entries(approval.actionDetails).map(([key, value]) => (
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
                        onClick={() => openDialog(approval, 'approve')}
                        className="bg-status-success hover:bg-status-success/90"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => openDialog(approval, 'reject')}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
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
                        <p className="text-sm font-medium">{approval.proposedAction}</p>
                        <p className="text-xs text-muted-foreground">{approval.playbookName}</p>
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
                      {approval.decidedAt && (
                        <p className="text-xs text-muted-foreground mt-1">
                          <TimeAgo date={approval.decidedAt} />
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
        open={!!selectedApproval && !!actionType}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedApproval(null);
            setReason('');
            setActionType(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              {actionType === 'approve' ? 'Approve Action' : 'Reject Action'}
            </DialogTitle>
            <DialogDescription>
              This decision will be logged for audit purposes.
            </DialogDescription>
          </DialogHeader>

          {selectedApproval && (
            <div className="space-y-4 py-4">
              <div className="bg-muted rounded-lg p-3">
                <p className="font-medium text-sm">{selectedApproval.proposedAction}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Playbook: {selectedApproval.playbookName}
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
              onClick={() => {
                setSelectedApproval(null);
                setReason('');
                setActionType(null);
              }}
              disabled={approveAction.isPending || rejectAction.isPending}
            >
              Cancel
            </Button>
            {actionType === 'approve' ? (
              <Button
                onClick={handleApprove}
                disabled={approveAction.isPending || !reason.trim()}
                className="bg-status-success hover:bg-status-success/90"
              >
                {approveAction.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                )}
                Approve
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={rejectAction.isPending || !reason.trim()}
              >
                {rejectAction.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4 mr-1" />
                )}
                Reject
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
