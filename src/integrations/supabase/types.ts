export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          agent_id: string | null
          agent_name: string | null
          alert_id: string
          created_at: string
          created_by: string | null
          description: string | null
          destination_ip: string | null
          id: string
          mitre_tactic: string | null
          mitre_technique: string | null
          raw_data: Json | null
          rule_id: string
          rule_name: string
          severity: Database["public"]["Enums"]["severity_level"]
          source_ip: string | null
          status: Database["public"]["Enums"]["alert_status"]
          timestamp: string
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string | null
          alert_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          destination_ip?: string | null
          id?: string
          mitre_tactic?: string | null
          mitre_technique?: string | null
          raw_data?: Json | null
          rule_id: string
          rule_name: string
          severity?: Database["public"]["Enums"]["severity_level"]
          source_ip?: string | null
          status?: Database["public"]["Enums"]["alert_status"]
          timestamp?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          agent_name?: string | null
          alert_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          destination_ip?: string | null
          id?: string
          mitre_tactic?: string | null
          mitre_technique?: string | null
          raw_data?: Json | null
          rule_id?: string
          rule_name?: string
          severity?: Database["public"]["Enums"]["severity_level"]
          source_ip?: string | null
          status?: Database["public"]["Enums"]["alert_status"]
          timestamp?: string
          updated_at?: string
        }
        Relationships: []
      }
      approvals: {
        Row: {
          action_details: Json | null
          alert_id: string | null
          approval_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          execution_id: string | null
          expires_at: string
          id: string
          playbook_name: string
          proposed_action: string
          reason: string | null
          requested_at: string
          status: Database["public"]["Enums"]["approval_status"]
        }
        Insert: {
          action_details?: Json | null
          alert_id?: string | null
          approval_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          execution_id?: string | null
          expires_at: string
          id?: string
          playbook_name: string
          proposed_action: string
          reason?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["approval_status"]
        }
        Update: {
          action_details?: Json | null
          alert_id?: string | null
          approval_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          execution_id?: string | null
          expires_at?: string
          id?: string
          playbook_name?: string
          proposed_action?: string
          reason?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["approval_status"]
        }
        Relationships: [
          {
            foreignKeyName: "approvals_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "executions"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string
          actor_id: string | null
          actor_role: string
          details: Json | null
          id: string
          ip_address: string | null
          outcome: string
          resource_id: string
          resource_type: string
          timestamp: string
        }
        Insert: {
          action: string
          actor_email: string
          actor_id?: string | null
          actor_role: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          outcome?: string
          resource_id: string
          resource_type: string
          timestamp?: string
        }
        Update: {
          action?: string
          actor_email?: string
          actor_id?: string | null
          actor_role?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          outcome?: string
          resource_id?: string
          resource_type?: string
          timestamp?: string
        }
        Relationships: []
      }
      connectors: {
        Row: {
          actions: string[] | null
          config: Json | null
          connector_id: string
          created_at: string
          created_by: string | null
          enabled: boolean
          error_count: number
          execution_count: number
          id: string
          last_check: string | null
          last_execution: string | null
          name: string
          status: Database["public"]["Enums"]["connector_status"]
          type: string
          updated_at: string
        }
        Insert: {
          actions?: string[] | null
          config?: Json | null
          connector_id: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          error_count?: number
          execution_count?: number
          id?: string
          last_check?: string | null
          last_execution?: string | null
          name: string
          status?: Database["public"]["Enums"]["connector_status"]
          type: string
          updated_at?: string
        }
        Update: {
          actions?: string[] | null
          config?: Json | null
          connector_id?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          error_count?: number
          execution_count?: number
          id?: string
          last_check?: string | null
          last_execution?: string | null
          name?: string
          status?: Database["public"]["Enums"]["connector_status"]
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      executions: {
        Row: {
          alert_id: string | null
          completed_at: string | null
          created_at: string
          current_step: number | null
          error: string | null
          execution_id: string
          id: string
          playbook_id: string | null
          playbook_name: string
          started_at: string
          state: Database["public"]["Enums"]["execution_state"]
          steps: Json
        }
        Insert: {
          alert_id?: string | null
          completed_at?: string | null
          created_at?: string
          current_step?: number | null
          error?: string | null
          execution_id: string
          id?: string
          playbook_id?: string | null
          playbook_name: string
          started_at?: string
          state?: Database["public"]["Enums"]["execution_state"]
          steps?: Json
        }
        Update: {
          alert_id?: string | null
          completed_at?: string | null
          created_at?: string
          current_step?: number | null
          error?: string | null
          execution_id?: string
          id?: string
          playbook_id?: string | null
          playbook_name?: string
          started_at?: string
          state?: Database["public"]["Enums"]["execution_state"]
          steps?: Json
        }
        Relationships: [
          {
            foreignKeyName: "executions_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executions_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "playbooks"
            referencedColumns: ["id"]
          },
        ]
      }
      playbooks: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          execution_count: number
          id: string
          last_execution: string | null
          name: string
          playbook_id: string
          steps: Json
          trigger: Json
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          execution_count?: number
          id?: string
          last_execution?: string | null
          name: string
          playbook_id: string
          steps?: Json
          trigger?: Json
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          execution_count?: number
          id?: string
          last_execution?: string | null
          name?: string
          playbook_id?: string
          steps?: Json
          trigger?: Json
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      alert_status: "new" | "acknowledged" | "in_progress" | "resolved"
      app_role: "analyst" | "senior_analyst" | "admin"
      approval_status: "pending" | "approved" | "rejected" | "expired"
      connector_status: "healthy" | "degraded" | "error" | "disabled"
      execution_state:
        | "CREATED"
        | "ENRICHING"
        | "WAITING_APPROVAL"
        | "EXECUTING"
        | "COMPLETED"
        | "FAILED"
      severity_level: "critical" | "high" | "medium" | "low" | "info"
      step_state: "pending" | "running" | "completed" | "failed" | "skipped"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_status: ["new", "acknowledged", "in_progress", "resolved"],
      app_role: ["analyst", "senior_analyst", "admin"],
      approval_status: ["pending", "approved", "rejected", "expired"],
      connector_status: ["healthy", "degraded", "error", "disabled"],
      execution_state: [
        "CREATED",
        "ENRICHING",
        "WAITING_APPROVAL",
        "EXECUTING",
        "COMPLETED",
        "FAILED",
      ],
      severity_level: ["critical", "high", "medium", "low", "info"],
      step_state: ["pending", "running", "completed", "failed", "skipped"],
    },
  },
} as const
