-- Create severity enum
CREATE TYPE severity_level AS ENUM ('critical', 'high', 'medium', 'low', 'info');

-- Create alert status enum
CREATE TYPE alert_status AS ENUM ('new', 'acknowledged', 'in_progress', 'resolved');

-- Create execution state enum
CREATE TYPE execution_state AS ENUM ('CREATED', 'ENRICHING', 'WAITING_APPROVAL', 'EXECUTING', 'COMPLETED', 'FAILED');

-- Create step state enum
CREATE TYPE step_state AS ENUM ('pending', 'running', 'completed', 'failed', 'skipped');

-- Create approval status enum
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- Create connector status enum
CREATE TYPE connector_status AS ENUM ('healthy', 'degraded', 'error', 'disabled');

-- Alerts table
CREATE TABLE public.alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id TEXT NOT NULL UNIQUE,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  severity severity_level NOT NULL DEFAULT 'medium',
  agent_id TEXT,
  agent_name TEXT,
  mitre_technique TEXT,
  mitre_tactic TEXT,
  description TEXT,
  source_ip TEXT,
  destination_ip TEXT,
  status alert_status NOT NULL DEFAULT 'new',
  raw_data JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Playbooks table
CREATE TABLE public.playbooks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  playbook_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  trigger JSONB NOT NULL DEFAULT '{}',
  steps JSONB NOT NULL DEFAULT '[]',
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_execution TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Executions table
CREATE TABLE public.executions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  execution_id TEXT NOT NULL UNIQUE,
  playbook_id UUID REFERENCES public.playbooks(id),
  playbook_name TEXT NOT NULL,
  alert_id UUID REFERENCES public.alerts(id),
  state execution_state NOT NULL DEFAULT 'CREATED',
  current_step INTEGER,
  steps JSONB NOT NULL DEFAULT '[]',
  error TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Approvals table
CREATE TABLE public.approvals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  approval_id TEXT NOT NULL UNIQUE,
  execution_id UUID REFERENCES public.executions(id),
  playbook_name TEXT NOT NULL,
  alert_id UUID REFERENCES public.alerts(id),
  proposed_action TEXT NOT NULL,
  action_details JSONB DEFAULT '{}',
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status approval_status NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES auth.users(id),
  decided_at TIMESTAMP WITH TIME ZONE,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Connectors table
CREATE TABLE public.connectors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connector_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status connector_status NOT NULL DEFAULT 'healthy',
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB DEFAULT '{}',
  last_check TIMESTAMP WITH TIME ZONE,
  last_execution TIMESTAMP WITH TIME ZONE,
  execution_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  actions TEXT[] DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Audit log table
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  actor_id UUID REFERENCES auth.users(id),
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  outcome TEXT NOT NULL DEFAULT 'success'
);

-- Enable RLS on all tables
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Alerts policies: All authenticated users can view, senior+ can edit
CREATE POLICY "Authenticated users can view alerts" ON public.alerts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Senior analysts and admins can insert alerts" ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'senior_analyst'));

CREATE POLICY "Senior analysts and admins can update alerts" ON public.alerts
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'senior_analyst'));

-- Playbooks policies: All can view, senior+ can edit, admin can delete
CREATE POLICY "Authenticated users can view playbooks" ON public.playbooks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Senior analysts and admins can insert playbooks" ON public.playbooks
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'senior_analyst'));

CREATE POLICY "Senior analysts and admins can update playbooks" ON public.playbooks
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'senior_analyst'));

CREATE POLICY "Admins can delete playbooks" ON public.playbooks
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- Executions policies: All can view
CREATE POLICY "Authenticated users can view executions" ON public.executions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "System can insert executions" ON public.executions
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "System can update executions" ON public.executions
  FOR UPDATE TO authenticated USING (true);

-- Approvals policies: Senior+ can view and manage
CREATE POLICY "Senior analysts and admins can view approvals" ON public.approvals
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'senior_analyst'));

CREATE POLICY "Senior analysts and admins can insert approvals" ON public.approvals
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'senior_analyst'));

CREATE POLICY "Senior analysts and admins can update approvals" ON public.approvals
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'senior_analyst'));

-- Connectors policies: Admin only
CREATE POLICY "Admins can view connectors" ON public.connectors
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage connectors" ON public.connectors
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- Audit logs policies: Senior+ can view
CREATE POLICY "Senior analysts and admins can view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'senior_analyst'));

CREATE POLICY "System can insert audit logs" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- Triggers for updated_at
CREATE TRIGGER update_alerts_updated_at
  BEFORE UPDATE ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_playbooks_updated_at
  BEFORE UPDATE ON public.playbooks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_connectors_updated_at
  BEFORE UPDATE ON public.connectors
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Create indexes for performance
CREATE INDEX idx_alerts_timestamp ON public.alerts(timestamp DESC);
CREATE INDEX idx_alerts_severity ON public.alerts(severity);
CREATE INDEX idx_alerts_status ON public.alerts(status);
CREATE INDEX idx_executions_state ON public.executions(state);
CREATE INDEX idx_approvals_status ON public.approvals(status);
CREATE INDEX idx_audit_logs_timestamp ON public.audit_logs(timestamp DESC);