import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * Case Filters for querying cases
 */
export interface CaseFilters {
  status?: string | string[];
  severity?: string | string[];
  assigned_to?: string;
  created_by?: string;
  tags?: string | string[];
  sla_breached?: boolean;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
  sort_by?: 'case_id' | 'created_at' | 'severity' | 'status';
  sort_order?: 'asc' | 'desc';
}

/**
 * Case entity
 */
export interface Case {
  _id: string;
  case_id: string;
  title: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  status: 'OPEN' | 'INVESTIGATING' | 'PENDING' | 'RESOLVED' | 'CLOSED';
  assigned_to?: string;
  assigned_at?: string;
  assigned_by?: string;
  created_by: string;
  linked_execution_ids: any[];
  primary_execution_id: any;
  tags: string[];
  sla_deadlines?: any;
  timeline: any[];
  evidence: any[];
  resolution_summary?: string;
  resolved_at?: string;
  resolved_by?: string;
  closed_at?: string;
  closed_by?: string;
  created_at: string;
  updated_at: string;
  metadata?: any;
}

/**
 * Hook to query cases with filtering and pagination
 */
export const useCases = (filters?: CaseFilters) => {
  return useQuery({
    queryKey: ['cases', filters],
    queryFn: () => apiClient.getCases(filters),
    select: (response) => ({
      cases: response.data || [],
      total: response.total || 0,
      page: response.page || 1,
      pageSize: response.page_size || 50,
      totalPages: response.total_pages || 1
    }),
    refetchInterval: 30000 // Auto-refresh every 30 seconds for case monitoring
  });
};

/**
 * Hook to fetch a single case by case_id
 */
export const useCase = (caseId: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: ['cases', caseId],
    queryFn: () => apiClient.getCase(caseId),
    enabled: !!caseId && enabled,
    refetchInterval: 15000 // Refresh every 15 seconds for active case monitoring
  });
};

/**
 * Hook to query cases by status
 */
export const useCasesByStatus = (status: string | string[], limit: number = 50) => {
  return useCases({ status, limit, sort_by: 'created_at', sort_order: 'desc' });
};

/**
 * Hook to get case statistics
 */
export const useCaseStats = (params?: { from_date?: string; to_date?: string }) => {
  return useQuery({
    queryKey: ['case-stats', params],
    queryFn: () => apiClient.getCaseStats(params),
    refetchInterval: 30000 // Refresh every 30 seconds
  });
};

/**
 * Hook to get cases assigned to an analyst
 */
export const useAssignedCases = (analyst: string, status?: string) => {
  return useQuery({
    queryKey: ['assigned-cases', analyst, status],
    queryFn: () => apiClient.getAssignedCases(analyst, status),
    enabled: !!analyst,
    refetchInterval: 30000
  });
};

/**
 * Hook to get case timeline
 */
export const useCaseTimeline = (caseId: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: ['case-timeline', caseId],
    queryFn: () => apiClient.getCaseTimeline(caseId),
    enabled: !!caseId && enabled,
    refetchInterval: 15000
  });
};

/**
 * Hook to get case comments
 */
export const useCaseComments = (caseId: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: ['case-comments', caseId],
    queryFn: () => apiClient.getCaseComments(caseId),
    enabled: !!caseId && enabled,
    refetchInterval: 15000
  });
};

/**
 * Mutation hook to create case from execution
 */
export const useCreateCaseFromExecution = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ executionId, data }: { executionId: string; data: any }) =>
      apiClient.createCaseFromExecution(executionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.invalidateQueries({ queryKey: ['case-stats'] });
    }
  });
};

/**
 * Mutation hook to update case
 */
export const useUpdateCase = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ caseId, data }: { caseId: string; data: any }) =>
      apiClient.updateCase(caseId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cases', variables.caseId] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
    }
  });
};

/**
 * Mutation hook to transition case status
 */
export const useTransitionCaseStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ caseId, status, reason }: { caseId: string; status: string; reason?: string }) =>
      apiClient.transitionCaseStatus(caseId, status as any, reason),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cases', variables.caseId] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.invalidateQueries({ queryKey: ['case-stats'] });
      queryClient.invalidateQueries({ queryKey: ['case-timeline', variables.caseId] });
    }
  });
};

/**
 * Mutation hook to assign case
 */
export const useAssignCase = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ caseId, assignedTo }: { caseId: string; assignedTo: string }) =>
      apiClient.assignCase(caseId, assignedTo),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cases', variables.caseId] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.invalidateQueries({ queryKey: ['assigned-cases'] });
      queryClient.invalidateQueries({ queryKey: ['case-timeline', variables.caseId] });
    }
  });
};

/**
 * Mutation hook to link execution to case
 */
export const useLinkExecutionToCase = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ caseId, executionId }: { caseId: string; executionId: string }) =>
      apiClient.linkExecutionToCase(caseId, executionId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cases', variables.caseId] });
      queryClient.invalidateQueries({ queryKey: ['case-timeline', variables.caseId] });
    }
  });
};

/**
 * Mutation hook to add case comment
 */
export const useAddCaseComment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ caseId, comment }: { caseId: string; comment: any }) =>
      apiClient.addCaseComment(caseId, comment),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['case-comments', variables.caseId] });
      queryClient.invalidateQueries({ queryKey: ['case-timeline', variables.caseId] });
      queryClient.invalidateQueries({ queryKey: ['cases', variables.caseId] });
    }
  });
};

/**
 * Mutation hook to add case evidence
 */
export const useAddCaseEvidence = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ caseId, evidence }: { caseId: string; evidence: any }) =>
      apiClient.addCaseEvidence(caseId, evidence),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cases', variables.caseId] });
      queryClient.invalidateQueries({ queryKey: ['case-timeline', variables.caseId] });
    }
  });
};
