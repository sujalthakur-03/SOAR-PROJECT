import { useState } from 'react';
import { useCreateCaseFromExecution } from '@/hooks/useCases';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

interface CreateCaseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  executionId: string;
  executionData?: any;
}

const CreateCaseModal = ({ open, onOpenChange, executionId, executionData }: CreateCaseModalProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const createMutation = useCreateCaseFromExecution();

  const [formData, setFormData] = useState({
    title: executionData?.playbook_name ? `Incident: ${executionData.playbook_name}` : '',
    description: executionData?.execution_id ? `Case created from execution ${executionData.execution_id}` : '',
    severity: (() => {
      const sev = executionData?.trigger_data?.severity;
      if (typeof sev === 'string') return sev.toUpperCase();
      if (typeof sev === 'number') {
        if (sev >= 12) return 'CRITICAL';
        if (sev >= 8) return 'HIGH';
        if (sev >= 4) return 'MEDIUM';
        return 'LOW';
      }
      return 'MEDIUM';
    })(),
    priority: 'P3',
    assigned_to: '',
    tags: ''
  });

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      toast({
        title: 'Error',
        description: 'Title is required',
        variant: 'destructive'
      });
      return;
    }

    try {
      const tagsArray = formData.tags.split(',').map(t => t.trim()).filter(t => t);

      const result = await createMutation.mutateAsync({
        executionId,
        data: {
          title: formData.title,
          description: formData.description,
          severity: formData.severity as any,
          priority: formData.priority as any,
          assigned_to: formData.assigned_to || undefined,
          tags: tagsArray
        }
      });

      toast({
        title: 'Case created',
        description: `Case ${result.case_id} has been created successfully`
      });

      onOpenChange(false);
      navigate(`/cases/${result.case_id}`);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create case',
        variant: 'destructive'
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Case from Execution</DialogTitle>
          <DialogDescription>
            Create a new incident case from execution {executionId}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Title*</label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Brief description of the incident"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Description*</label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Detailed description of the incident"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Severity</label>
              <Select value={formData.severity} onValueChange={(value) => setFormData({ ...formData, severity: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Priority</label>
              <Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="P1">P1 - Critical</SelectItem>
                  <SelectItem value="P2">P2 - High</SelectItem>
                  <SelectItem value="P3">P3 - Medium</SelectItem>
                  <SelectItem value="P4">P4 - Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Assign To (optional)</label>
            <Input
              value={formData.assigned_to}
              onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
              placeholder="analyst@example.com"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Tags (optional)</label>
            <Input
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              placeholder="malware, phishing, investigation (comma-separated)"
            />
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Case'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateCaseModal;
