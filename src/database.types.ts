// Gerado a partir do schema do Supabase (projeto tittvjdrtuzsresheore).
// Regenerar após qualquer migração:
//   npx supabase gen types typescript --project-id tittvjdrtuzsresheore > src/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      agent_events: {
        Row: {
          agent_id: string | null
          conversation_id: string | null
          created_at: string
          event: string
          id: string
          level: string
          payload: Json
        }
        Insert: {
          agent_id?: string | null
          conversation_id?: string | null
          created_at?: string
          event: string
          id?: string
          level?: string
          payload?: Json
        }
        Update: {
          agent_id?: string | null
          conversation_id?: string | null
          created_at?: string
          event?: string
          id?: string
          level?: string
          payload?: Json
        }
        Relationships: []
      }
      agents: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          effort: string
          enabled: boolean
          id: string
          max_tokens: number
          model: string
          name: string
          org_id: string | null
          slug: string
          system_prompt: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          effort?: string
          enabled?: boolean
          id?: string
          max_tokens?: number
          model?: string
          name: string
          org_id?: string | null
          slug: string
          system_prompt?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          effort?: string
          enabled?: boolean
          id?: string
          max_tokens?: number
          model?: string
          name?: string
          org_id?: string | null
          slug?: string
          system_prompt?: string
          updated_at?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          org_id: string
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          org_id: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          org_id?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: []
      }
      conversations: {
        Row: {
          agent_id: string
          channel: string
          created_at: string
          external_id: string | null
          id: string
          metadata: Json
          status: string
          title: string | null
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          agent_id: string
          channel?: string
          created_at?: string
          external_id?: string | null
          id?: string
          metadata?: Json
          status?: string
          title?: string | null
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          agent_id?: string
          channel?: string
          created_at?: string
          external_id?: string | null
          id?: string
          metadata?: Json
          status?: string
          title?: string | null
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          blocks: Json | null
          cache_creation_tokens: number | null
          cache_read_tokens: number | null
          content: string | null
          conversation_id: string
          created_at: string
          id: string
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          output_tokens: number | null
          role: string
          stop_reason: string | null
        }
        Insert: {
          blocks?: Json | null
          cache_creation_tokens?: number | null
          cache_read_tokens?: number | null
          content?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          output_tokens?: number | null
          role: string
          stop_reason?: string | null
        }
        Update: {
          blocks?: Json | null
          cache_creation_tokens?: number | null
          cache_read_tokens?: number | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          output_tokens?: number | null
          role?: string
          stop_reason?: string | null
        }
        Relationships: []
      }
      org_members: {
        Row: {
          created_at: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          plan: string
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          plan?: string
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          plan?: string
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      reservation_status_history: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          created_at: string
          from_status: string | null
          id: string
          reason: string | null
          reservation_id: string
          to_status: string
        }
        Insert: {
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          reservation_id: string
          to_status: string
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          reservation_id?: string
          to_status?: string
        }
        Relationships: []
      }
      reservations: {
        Row: {
          agent_id: string | null
          area_preference: string | null
          conversation_id: string | null
          created_at: string
          customer_email: string | null
          customer_name: string
          customer_phone: string
          id: string
          metadata: Json
          notes: string | null
          occasion: string | null
          party_size: number
          reserved_for: string
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_channel: string
          status: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          agent_id?: string | null
          area_preference?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name: string
          customer_phone: string
          id?: string
          metadata?: Json
          notes?: string | null
          occasion?: string | null
          party_size: number
          reserved_for: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_channel?: string
          status?: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          agent_id?: string | null
          area_preference?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string
          id?: string
          metadata?: Json
          notes?: string | null
          occasion?: string | null
          party_size?: number
          reserved_for?: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_channel?: string
          status?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: []
      }
      tool_calls: {
        Row: {
          conversation_id: string
          created_at: string
          duration_ms: number | null
          id: string
          input: Json
          is_error: boolean
          message_id: string | null
          output: Json | null
          tool_name: string
          tool_use_id: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          input?: Json
          is_error?: boolean
          message_id?: string | null
          output?: Json | null
          tool_name: string
          tool_use_id?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          input?: Json
          is_error?: boolean
          message_id?: string | null
          output?: Json | null
          tool_name?: string
          tool_use_id?: string | null
        }
        Relationships: []
      }
      venue_events: {
        Row: {
          active: boolean
          cover_charge: number | null
          created_at: string
          description: string | null
          details: Json
          ends_at: string | null
          id: string
          kind: string
          starts_at: string
          title: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          active?: boolean
          cover_charge?: number | null
          created_at?: string
          description?: string | null
          details?: Json
          ends_at?: string | null
          id?: string
          kind?: string
          starts_at: string
          title: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          active?: boolean
          cover_charge?: number | null
          created_at?: string
          description?: string | null
          details?: Json
          ends_at?: string | null
          id?: string
          kind?: string
          starts_at?: string
          title?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: []
      }
      venue_info: {
        Row: {
          active: boolean
          content: string
          created_at: string
          id: string
          tags: string[]
          topic: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          active?: boolean
          content: string
          created_at?: string
          id?: string
          tags?: string[]
          topic: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          active?: boolean
          content?: string
          created_at?: string
          id?: string
          tags?: string[]
          topic?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: []
      }
      venues: {
        Row: {
          active: boolean
          address: string | null
          capacity: number | null
          created_at: string
          description: string | null
          email: string | null
          id: string
          name: string
          opening_hours: Json
          org_id: string
          phone: string | null
          settings: Json
          slug: string
          timezone: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          capacity?: number | null
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          name: string
          opening_hours?: Json
          org_id: string
          phone?: string | null
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          capacity?: number | null
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          name?: string
          opening_hours?: Json
          org_id?: string
          phone?: string | null
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          error: string | null
          event: string
          id: string
          payload: Json
          status_code: number | null
          webhook_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          event: string
          id?: string
          payload?: Json
          status_code?: number | null
          webhook_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          event?: string
          id?: string
          payload?: Json
          status_code?: number | null
          webhook_id?: string
        }
        Relationships: []
      }
      webhooks: {
        Row: {
          active: boolean
          created_at: string
          events: string[]
          id: string
          org_id: string
          secret: string
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          events?: string[]
          id?: string
          org_id: string
          secret: string
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          events?: string[]
          id?: string
          org_id?: string
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<Name extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][Name]["Row"]

export type TablesInsert<Name extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][Name]["Insert"]

export type TablesUpdate<Name extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][Name]["Update"]
