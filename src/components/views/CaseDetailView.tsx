import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCase, useCaseTimeline, useTransitionCaseStatus, useAssignCase, useAddCaseComment, useAddCaseEvidence, useUpdateCase } from '@/hooks/useCases';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, Edit, ExternalLink, FileText, Link as LinkIcon, MessageSquare, Plus, Save, Users } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

const CaseDetailView = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: caseData, isLoading: loadingCase } = useCase(caseId || '');
  const { data: timeline, isLoading: loadingTimeline } = useCaseTimeline(caseId || '');

  const transitionMutation = useTransitionCaseStatus();
  const assignMutation = useAssignCase();
  const commentMutation = useAddCaseComment();
  const evidenceMutation = useAddCaseEvidence();
  const updateMutation = useUpdateCase();

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    title: '',
    description: '',
    resolution_summary: ''
  });

  const [newComment, setNewComment] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [statusReason, setStatusReason] = useState('');

  const [evidenceDialog, setEvidenceDialog] = useState(false);
  const [newEvidence, setNewEvidence] = useState({
    type: 'note',
    name: '',
    description: '',
    content: ''
  });

  if (loadingCase) {
    return (
      <div className="p-6">
        <div className="text-center py-8">Loading case details...</div>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="p-6">
        <div className="text-center py-8 text-destructive">Case not found</div>
      </div>
    );
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'destructive';
      case 'HIGH': return 'orange';
      case 'MEDIUM': return 'yellow';
      case 'LOW': return 'blue';
      default: return 'secondary';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN': return 'destructive';
      case 'INVESTIGATING': return 'orange';
      case 'PENDING': return 'yellow';
      case 'RESOLVED': return 'green';
      case 'CLOSED': return 'secondary';
      default: return 'secondary';
    }
  };

  const handleStatusChange = async () => {
    if (!newStatus) return;

    try {
      await transitionMutation.mutateAsync({
        caseId: caseData.case_id,
        status: newStatus,
        reason: statusReason
      });
      toast({
        title: 'Status updated',
        description: `Case status changed to ${newStatus}`
      });
      setNewStatus('');
      setStatusReason('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleAssign = async () => {
    if (!newAssignee) return;

    try {
      await assignMutation.mutateAsync({
        caseId: caseData.case_id,
        assignedTo: newAssignee
      });
      toast({
        title: 'Case assigned',
        description: `Case assigned to ${newAssignee}`
      });
      setNewAssignee('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    try {
      await commentMutation.mutateAsync({
        caseId: caseData.case_id,
        comment: {
          content: newComment,
          comment_type: 'note'
        }
      });
      toast({
        title: 'Comment added',
        description: 'Your comment has been added to the case'
      });
      setNewComment('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleAddEvidence = async () => {
    if (!newEvidence.name || !newEvidence.type) return;

    try {
      await evidenceMutation.mutateAsync({
        caseId: caseData.case_id,
        evidence: newEvidence
      });
      toast({
        title: 'Evidence added',
        description: 'Evidence has been added to the case'
      });
      setEvidenceDialog(false);
      setNewEvidence({ type: 'note', name: '', description: '', content: '' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleUpdate = async () => {
    try {
      await updateMutation.mutateAsync({
        caseId: caseData.case_id,
        data: editData
      });
      toast({
        title: 'Case updated',
        description: 'Case details have been updated'
      });
      setIsEditing(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const startEditing = () => {
    setEditData({
      title: caseData.title,
      description: caseData.description,
      resolution_summary: caseData.resolution_summary || ''
    });
    setIsEditing(true);
  };

  const getSLABreach = () => {
    if (caseData.sla_deadlines?.acknowledge?.breached || caseData.sla_deadlines?.resolve?.breached) {
      return true;
    }
    return false;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/?view=cases')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-3xl font-bold font-mono">{caseData.case_id}</h1>
              <Badge variant={getStatusColor(caseData.status) as any}>{caseData.status}</Badge>
              <Badge variant={getSeverityColor(caseData.severity) as any}>{caseData.severity}</Badge>
              {getSLABreach() && (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  SLA BREACH
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              Created {formatDistanceToNow(new Date(caseData.created_at), { addSuffix: true })} by {caseData.created_by}
            </p>
          </div>
        </div>
        <Button onClick={startEditing} variant="outline" className="gap-2">
          <Edit className="h-4 w-4" />
          Edit Case
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Case Information */}
          <Card>
            <CardHeader>
              <CardTitle>Case Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isEditing ? (
                <>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Title</label>
                    <Input
                      value={editData.title}
                      onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Description</label>
                    <Textarea
                      value={editData.description}
                      onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                      rows={4}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Resolution Summary</label>
                    <Textarea
                      value={editData.resolution_summary}
                      onChange={(e) => setEditData({ ...editData, resolution_summary: e.target.value })}
                      rows={4}
                      placeholder="Describe how this case was resolved..."
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleUpdate} className="gap-2">
                      <Save className="h-4 w-4" />
                      Save Changes
                    </Button>
                    <Button variant="outline" onClick={() => setIsEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <h3 className="text-lg font-semibold mb-2">{caseData.title}</h3>
                    <p className="text-muted-foreground">{caseData.description}</p>
                  </div>
                  {caseData.resolution_summary && (
                    <div>
                      <h4 className="text-sm font-medium mb-1">Resolution Summary</h4>
                      <p className="text-sm text-muted-foreground">{caseData.resolution_summary}</p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Linked Executions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LinkIcon className="h-5 w-5" />
                Linked Executions ({caseData.linked_execution_ids?.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {caseData.linked_execution_ids && caseData.linked_execution_ids.length > 0 ? (
                <div className="space-y-2">
                  {caseData.linked_execution_ids.map((execution: any) => (
                    <div
                      key={execution._id}
                      className="border rounded-lg p-3 hover:bg-accent cursor-pointer"
                      onClick={() => navigate(`/executions/${execution.execution_id}`)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium">{execution.execution_id}</span>
                            {execution._id === caseData.primary_execution_id?._id && (
                              <Badge variant="outline" className="text-xs">PRIMARY</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{execution.playbook_name}</p>
                        </div>
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No linked executions</p>
              )}
            </CardContent>
          </Card>

          {/* Evidence */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Evidence ({caseData.evidence?.length || 0})
                </CardTitle>
                <Dialog open={evidenceDialog} onOpenChange={setEvidenceDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-2">
                      <Plus className="h-4 w-4" />
                      Add Evidence
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Evidence</DialogTitle>
                      <DialogDescription>Add evidence or artifacts to this case</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">Type</label>
                        <Select value={newEvidence.type} onValueChange={(value) => setNewEvidence({ ...newEvidence, type: value })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="file">File</SelectItem>
                            <SelectItem value="url">URL</SelectItem>
                            <SelectItem value="hash">Hash</SelectItem>
                            <SelectItem value="note">Note</SelectItem>
                            <SelectItem value="screenshot">Screenshot</SelectItem>
                            <SelectItem value="log">Log</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">Name</label>
                        <Input
                          value={newEvidence.name}
                          onChange={(e) => setNewEvidence({ ...newEvidence, name: e.target.value })}
                          placeholder="Evidence name"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">Description</label>
                        <Textarea
                          value={newEvidence.description}
                          onChange={(e) => setNewEvidence({ ...newEvidence, description: e.target.value })}
                          placeholder="Description"
                          rows={3}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">Content</label>
                        <Textarea
                          value={newEvidence.content}
                          onChange={(e) => setNewEvidence({ ...newEvidence, content: e.target.value })}
                          placeholder="Evidence content, URL, hash, etc."
                          rows={3}
                        />
                      </div>
                      <Button onClick={handleAddEvidence} className="w-full">Add Evidence</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {caseData.evidence && caseData.evidence.length > 0 ? (
                <div className="space-y-2">
                  {caseData.evidence.map((item: any, index: number) => (
                    <div key={index} className="border rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{item.type}</Badge>
                            <span className="font-medium">{item.name}</span>
                          </div>
                          {item.description && (
                            <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Added by {item.added_by} on {format(new Date(item.added_at), 'PPp')}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No evidence added</p>
              )}
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingTimeline ? (
                <div className="text-center py-4 text-muted-foreground">Loading timeline...</div>
              ) : timeline && timeline.length > 0 ? (
                <div className="space-y-3">
                  {timeline.map((event: any, index: number) => (
                    <div key={index} className="flex gap-3">
                      <div className="flex-shrink-0 w-2 h-2 rounded-full bg-primary mt-2" />
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">{event.description}</span>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(event.timestamp), 'PPp')}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">by {event.actor}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No timeline events</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status Transition */}
              <div>
                <label className="text-sm font-medium mb-2 block">Change Status</label>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select new status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="INVESTIGATING">Investigating</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="RESOLVED">Resolved</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
                {newStatus && (
                  <>
                    <Input
                      placeholder="Reason (optional)"
                      value={statusReason}
                      onChange={(e) => setStatusReason(e.target.value)}
                      className="mt-2"
                    />
                    <Button onClick={handleStatusChange} className="w-full mt-2">
                      Update Status
                    </Button>
                  </>
                )}
              </div>

              {/* Assignment */}
              <div>
                <label className="text-sm font-medium mb-2 block">Assign Case</label>
                <Input
                  placeholder="analyst@example.com"
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                />
                <Button onClick={handleAssign} className="w-full mt-2" disabled={!newAssignee}>
                  Assign
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Case Details */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">Priority:</span>
                <Badge variant="outline" className="ml-2">{caseData.priority}</Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Assigned to:</span>
                <p className="font-medium">{caseData.assigned_to || 'Unassigned'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Created by:</span>
                <p className="font-medium">{caseData.created_by}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Created at:</span>
                <p className="font-medium">{format(new Date(caseData.created_at), 'PPp')}</p>
              </div>
              {caseData.resolved_at && (
                <div>
                  <span className="text-muted-foreground">Resolved at:</span>
                  <p className="font-medium">{format(new Date(caseData.resolved_at), 'PPp')}</p>
                </div>
              )}
              {caseData.closed_at && (
                <div>
                  <span className="text-muted-foreground">Closed at:</span>
                  <p className="font-medium">{format(new Date(caseData.closed_at), 'PPp')}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add Comment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Add Comment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="Add a comment or note..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                rows={4}
              />
              <Button onClick={handleAddComment} className="w-full mt-2" disabled={!newComment.trim()}>
                Add Comment
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default CaseDetailView;
