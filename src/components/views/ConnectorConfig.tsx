import { useState } from 'react';
import {
  Plug,
  Plus,
  RefreshCw,
  Settings,
  Loader2,
  CheckCircle2,
  XCircle,
  Edit,
  Trash2,
  TestTube,
  Eye,
  EyeOff,
  Save,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useUserRole } from '@/hooks/useUserRole';
import { canEditFeature } from '@/lib/permissions';
import {
  useConnectors,
  useCreateConnector,
  useUpdateConnector,
  useDeleteConnector,
  useTestConnector,
  type Connector,
} from '@/hooks/useConnectors';
import { cn } from '@/lib/utils';
import { TimeAgo } from '@/components/common/TimeDisplay';

const CONNECTOR_TYPES = [
  { value: 'virustotal', label: 'VirusTotal', description: 'IP, domain, hash, URL lookups' },
  { value: 'abuseipdb', label: 'AbuseIPDB', description: 'IP reputation checks' },
  { value: 'alienvault_otx', label: 'AlienVault OTX', description: 'IP, domain, hash threat intel' },
  { value: 'cybersentinel_blocklist', label: 'CyberSentinel Blocklist', description: 'IP/domain blocklist management' },
  { value: 'cortex', label: 'Cortex XSOAR', description: 'Incident orchestration' },
  { value: 'email', label: 'Email (SMTP)', description: 'Email notifications' },
  { value: 'slack', label: 'Slack', description: 'Slack notifications' },
  { value: 'custom', label: 'Custom HTTP', description: 'Generic webhook/API' },
];

const CONNECTOR_CONFIG_TEMPLATES: Record<string, any> = {
  virustotal: {
    api_key: '',
    base_url: 'https://www.virustotal.com/api/v3',
    timeout_ms: 10000,
  },
  abuseipdb: {
    api_key: '',
    base_url: 'https://api.abuseipdb.com/api/v2',
    timeout_ms: 10000,
  },
  alienvault_otx: {
    api_key: '',
    base_url: 'https://otx.alienvault.com/api/v1',
    timeout_ms: 15000,
  },
  cybersentinel_blocklist: {
    api_url: '',
    api_key: '',
    timeout_ms: 10000,
  },
  cortex: {
    api_key: '',
    base_url: '',
    timeout_ms: 30000,
  },
  email: {
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
    from_email: '',
    use_tls: true,
  },
  slack: {
    webhook_url: '',
    bot_token: '',
    channel: '',
  },
  custom: {
    url: '',
    method: 'POST',
    headers: {},
    timeout_ms: 10000,
  },
};

interface ConnectorFormData {
  name: string;
  type: string;
  description: string;
  config: Record<string, any>;
  status: 'active' | 'inactive';
}

export function ConnectorConfig() {
  const { data, isLoading, refetch } = useConnectors();
  const connectors = Array.isArray(data) ? data : [];
  const createConnector = useCreateConnector();
  const updateConnector = useUpdateConnector();
  const deleteConnector = useDeleteConnector();
  const testConnector = useTestConnector();
  const { role } = useUserRole();
  const { toast } = useToast();
  const canEdit = canEditFeature('connectors', role);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingConnector, setEditingConnector] = useState<Connector | null>(null);
  const [deleteConfirmConnector, setDeleteConfirmConnector] = useState<Connector | null>(null);
  const [testingConnectorId, setTestingConnectorId] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const [formData, setFormData] = useState<ConnectorFormData>({
    name: '',
    type: '',
    description: '',
    config: {},
    status: 'inactive',
  });

  const resetForm = () => {
    setFormData({
      name: '',
      type: '',
      description: '',
      config: {},
      status: 'inactive',
    });
    setEditingConnector(null);
  };

  const openAddDialog = () => {
    resetForm();
    setIsAddDialogOpen(true);
  };

  const openEditDialog = (connector: Connector) => {
    setFormData({
      name: connector.name,
      type: connector.type,
      description: connector.description || '',
      config: connector.config || {},
      status: connector.status,
    });
    setEditingConnector(connector);
    setIsAddDialogOpen(true);
  };

  const handleTypeChange = (type: string) => {
    setFormData({
      ...formData,
      type,
      config: CONNECTOR_CONFIG_TEMPLATES[type] || {},
    });
  };

  const handleConfigChange = (key: string, value: any) => {
    setFormData({
      ...formData,
      config: {
        ...formData.config,
        [key]: value,
      },
    });
  };

  const handleSave = async () => {
    if (!formData.name || !formData.type) {
      toast({
        title: 'Validation Error',
        description: 'Name and type are required',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (editingConnector) {
        await updateConnector.mutateAsync({
          id: editingConnector.id,
          data: formData,
        });
        toast({ title: 'Connector updated successfully' });
      } else {
        await createConnector.mutateAsync(formData);
        toast({ title: 'Connector created successfully' });
      }
      setIsAddDialogOpen(false);
      resetForm();
    } catch (error: any) {
      toast({
        title: 'Failed to save connector',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmConnector) return;

    try {
      await deleteConnector.mutateAsync(deleteConfirmConnector.id);
      toast({ title: 'Connector deleted successfully' });
      setDeleteConfirmConnector(null);
    } catch (error: any) {
      toast({
        title: 'Failed to delete connector',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleTest = async (connectorId: string) => {
    setTestingConnectorId(connectorId);
    try {
      const result = await testConnector.mutateAsync(connectorId);
      if (result.health_status === 'healthy') {
        toast({ title: 'Connection test successful', description: result.health_message });
      } else {
        toast({
          title: 'Connection test failed',
          description: result.health_message,
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Connection test error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setTestingConnectorId(null);
    }
  };

  const toggleSecretVisibility = (fieldKey: string) => {
    setShowSecrets((prev) => ({
      ...prev,
      [fieldKey]: !prev[fieldKey],
    }));
  };

  const renderConfigField = (key: string, value: any) => {
    const isSecret = key.includes('password') || key.includes('token') || key.includes('key') || key.includes('secret');
    const fieldId = `config-${key}`;

    if (typeof value === 'boolean') {
      return (
        <div key={key} className="flex items-center justify-between space-x-2">
          <Label htmlFor={fieldId} className="text-sm font-medium">
            {key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
          </Label>
          <Switch
            id={fieldId}
            checked={value}
            onCheckedChange={(checked) => handleConfigChange(key, checked)}
          />
        </div>
      );
    }

    if (typeof value === 'number') {
      return (
        <div key={key} className="space-y-1.5">
          <Label htmlFor={fieldId} className="text-sm font-medium">
            {key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
          </Label>
          <Input
            id={fieldId}
            type="number"
            value={value}
            onChange={(e) => handleConfigChange(key, parseInt(e.target.value))}
          />
        </div>
      );
    }

    return (
      <div key={key} className="space-y-1.5">
        <Label htmlFor={fieldId} className="text-sm font-medium">
          {key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
        </Label>
        <div className="relative">
          <Input
            id={fieldId}
            type={isSecret && !showSecrets[key] ? 'password' : 'text'}
            value={value}
            onChange={(e) => handleConfigChange(key, e.target.value)}
            placeholder={isSecret ? '••••••••' : ''}
          />
          {isSecret && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full px-3"
              onClick={() => toggleSecretVisibility(key)}
            >
              {showSecrets[key] ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const getHealthIcon = (health: string) => {
    switch (health) {
      case 'healthy':
        return <CheckCircle2 className="h-4 w-4 text-status-success" />;
      case 'unhealthy':
        return <XCircle className="h-4 w-4 text-status-error" />;
      default:
        return <Loader2 className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'success' | 'destructive' | 'outline'> = {
      active: 'success',
      inactive: 'outline',
      error: 'destructive',
      testing: 'default',
    };
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <Plug className="h-6 w-6 text-primary" />
            Connector Configuration
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Manage integration connectors and credentials
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {canEdit && (
            <Button size="sm" onClick={openAddDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Add Connector
            </Button>
          )}
        </div>
      </div>

      {connectors.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Plug className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground text-lg mb-4">No connectors configured</p>
            {canEdit && (
              <Button onClick={openAddDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Connector
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {connectors.map((connector) => (
            <Card key={connector.id} className={cn('transition-all', connector.status === 'active' ? 'border-primary/50' : '')}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      {connector.name}
                      {getStatusBadge(connector.status)}
                    </CardTitle>
                    <Badge variant="outline" className="text-xs">
                      {CONNECTOR_TYPES.find((t) => t.value === connector.type)?.label || connector.type}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    {canEdit && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEditDialog(connector)}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => setDeleteConfirmConnector(connector)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {connector.description && (
                  <p className="text-xs text-muted-foreground">{connector.description}</p>
                )}

                <div className="flex items-center gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    {getHealthIcon(connector.health_status)}
                    <span className="text-muted-foreground">
                      {connector.health_status || 'unknown'}
                    </span>
                  </div>
                  {connector.last_health_check && (
                    <span className="text-muted-foreground">
                      checked <TimeAgo date={connector.last_health_check} />
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Total:</span>{' '}
                    <span className="font-medium">{connector.total_executions || 0}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Success:</span>{' '}
                    <span className="font-medium text-status-success">
                      {connector.successful_executions || 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Failed:</span>{' '}
                    <span className="font-medium text-status-error">
                      {connector.failed_executions || 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Success Rate:</span>{' '}
                    <span className="font-medium">
                      {connector.total_executions > 0
                        ? Math.round((connector.successful_executions / connector.total_executions) * 100)
                        : 0}
                      %
                    </span>
                  </div>
                </div>

                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => handleTest(connector.id)}
                    disabled={testingConnectorId === connector.id}
                  >
                    {testingConnectorId === connector.id ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <TestTube className="h-3.5 w-3.5 mr-2" />
                        Test Connection
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingConnector ? 'Edit Connector' : 'Add New Connector'}
            </DialogTitle>
            <DialogDescription>
              Configure connector settings and credentials. Sensitive fields are encrypted at rest.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Connector Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Production VirusTotal"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="type">Connector Type</Label>
              <Select
                value={formData.type}
                onValueChange={handleTypeChange}
                disabled={!!editingConnector}
              >
                <SelectTrigger id="type">
                  <SelectValue placeholder="Select connector type" />
                </SelectTrigger>
                <SelectContent>
                  {CONNECTOR_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <div>
                        <div className="font-medium">{type.label}</div>
                        <div className="text-xs text-muted-foreground">{type.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of this connector"
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value: any) => setFormData({ ...formData, status: value })}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.type && (
              <div className="border-t pt-4 space-y-3">
                <Label className="text-base font-semibold">Configuration</Label>
                {Object.keys(formData.config).map((key) =>
                  renderConfigField(key, formData.config[key])
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createConnector.isPending || updateConnector.isPending}
            >
              {createConnector.isPending || updateConnector.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Connector
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteConfirmConnector}
        onOpenChange={(open) => !open && setDeleteConfirmConnector(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Connector</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteConfirmConnector?.name}</strong>?
              This action cannot be undone and may affect existing playbooks.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteConnector.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
