import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCases, useCaseStats } from '@/hooks/useCases';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Clock, Eye, Filter, FolderOpen, Search, Users, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const CasesDashboard = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    status: '',
    severity: '',
    assigned_to: '',
    limit: 50,
    offset: 0
  });

  const { data: casesData, isLoading: loadingCases } = useCases(filters);
  const { data: stats, isLoading: loadingStats } = useCaseStats();

  const cases = casesData?.cases || [];
  const total = casesData?.total || 0;

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

  const getSLABreach = (caseItem: any) => {
    if (caseItem.sla_deadlines?.acknowledge?.breached || caseItem.sla_deadlines?.resolve?.breached) {
      return true;
    }
    return false;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Case Management</h1>
          <p className="text-muted-foreground">SOC incident case tracking and lifecycle management</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setFilters({ ...filters, status: 'OPEN' })}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open</CardTitle>
            <FolderOpen className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loadingStats ? '...' : stats?.open || 0}</div>
            <p className="text-xs text-muted-foreground">New cases requiring attention</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setFilters({ ...filters, status: 'INVESTIGATING' })}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Investigating</CardTitle>
            <Eye className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loadingStats ? '...' : stats?.investigating || 0}</div>
            <p className="text-xs text-muted-foreground">Active investigations</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setFilters({ ...filters, status: 'PENDING' })}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loadingStats ? '...' : stats?.pending || 0}</div>
            <p className="text-xs text-muted-foreground">Awaiting response</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setFilters({ ...filters, status: 'RESOLVED' })}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resolved</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loadingStats ? '...' : stats?.resolved || 0}</div>
            <p className="text-xs text-muted-foreground">Ready to close</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setFilters({ ...filters, sla_breached: true } as any)}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">SLA Breached</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loadingStats ? '...' : stats?.sla_breached || 0}</div>
            <p className="text-xs text-muted-foreground">Exceeding SLA thresholds</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Status</label>
              <Select value={filters.status || 'all'} onValueChange={(value) => setFilters({ ...filters, status: value === 'all' ? '' : value })}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="INVESTIGATING">Investigating</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="RESOLVED">Resolved</SelectItem>
                  <SelectItem value="CLOSED">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Severity</label>
              <Select value={filters.severity || 'all'} onValueChange={(value) => setFilters({ ...filters, severity: value === 'all' ? '' : value })}>
                <SelectTrigger>
                  <SelectValue placeholder="All severities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severities</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Assigned To</label>
              <Input
                placeholder="analyst@example.com"
                value={filters.assigned_to}
                onChange={(e) => setFilters({ ...filters, assigned_to: e.target.value })}
              />
            </div>

            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => setFilters({ status: '', severity: '', assigned_to: '', limit: 50, offset: 0 })}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cases List */}
      <Card>
        <CardHeader>
          <CardTitle>Cases ({total})</CardTitle>
          <CardDescription>Click on a case to view details</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingCases ? (
            <div className="text-center py-8 text-muted-foreground">Loading cases...</div>
          ) : cases.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No cases found</div>
          ) : (
            <div className="space-y-2">
              {cases.map((caseItem: any) => (
                <div
                  key={caseItem.case_id}
                  className="border rounded-lg p-4 hover:bg-accent cursor-pointer transition-colors"
                  onClick={() => navigate(`/cases/${caseItem.case_id}`)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-medium">{caseItem.case_id}</span>
                        <Badge variant={getStatusColor(caseItem.status) as any}>
                          {caseItem.status}
                        </Badge>
                        <Badge variant={getSeverityColor(caseItem.severity) as any}>
                          {caseItem.severity}
                        </Badge>
                        {getSLABreach(caseItem) && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertCircle className="h-3 w-3" />
                            SLA BREACH
                          </Badge>
                        )}
                      </div>
                      <h3 className="font-semibold text-lg">{caseItem.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2">{caseItem.description}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {caseItem.assigned_to || 'Unassigned'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Created {formatDistanceToNow(new Date(caseItem.created_at), { addSuffix: true })}
                        </span>
                        <span>
                          {caseItem.linked_execution_ids?.length || 0} linked execution(s)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CasesDashboard;
