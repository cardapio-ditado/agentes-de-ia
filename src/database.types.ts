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
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
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
        Relationships: [
          {
            foreignKeyName: "agent_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "agents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          category_id: string | null
          descricao_agente: string | null
          serve_pessoas: number | null
          cover_image_url: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          price: number
          slug: string
          sort_order: number
          venue_id: string
        }
        Insert: {
          category_id?: string | null
          descricao_agente?: string | null
          serve_pessoas?: number | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          price?: number
          slug: string
          sort_order?: number
          venue_id: string
        }
        Update: {
          category_id?: string | null
          descricao_agente?: string | null
          serve_pessoas?: number | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          slug?: string
          sort_order?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          grupo: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          venue_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          grupo?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          venue_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          grupo?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          venue_id?: string
        }
        Relationships: []
      }
      google_perfis: {
        Row: {
          conta_gerente: string
          configuracao: Json
          created_at: string
          id: string
          local_id: string | null
          status: string
          ultima_sincronizacao: string | null
          ultimo_erro: string | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          conta_gerente: string
          configuracao?: Json
          created_at?: string
          id?: string
          local_id?: string | null
          status?: string
          ultima_sincronizacao?: string | null
          ultimo_erro?: string | null
          updated_at?: string
          venue_id: string
        }
        Update: {
          conta_gerente?: string
          configuracao?: Json
          created_at?: string
          id?: string
          local_id?: string | null
          status?: string
          ultima_sincronizacao?: string | null
          ultimo_erro?: string | null
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_perfis_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: true
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      google_avaliacoes: {
        Row: {
          aprovada_por: string | null
          autor: string | null
          avaliacao_id: string
          avaliada_em: string | null
          comentario: string | null
          created_at: string
          id: string
          liberacao: string | null
          modelo: string | null
          nota: number
          publicada_em: string | null
          resposta: string | null
          resposta_status: string
          ultimo_erro: string | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          aprovada_por?: string | null
          autor?: string | null
          avaliacao_id: string
          avaliada_em?: string | null
          comentario?: string | null
          created_at?: string
          id?: string
          liberacao?: string | null
          modelo?: string | null
          nota: number
          publicada_em?: string | null
          resposta?: string | null
          resposta_status?: string
          ultimo_erro?: string | null
          updated_at?: string
          venue_id: string
        }
        Update: {
          aprovada_por?: string | null
          autor?: string | null
          avaliacao_id?: string
          avaliada_em?: string | null
          comentario?: string | null
          created_at?: string
          id?: string
          liberacao?: string | null
          modelo?: string | null
          nota?: number
          publicada_em?: string | null
          resposta?: string | null
          resposta_status?: string
          ultimo_erro?: string | null
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_avaliacoes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_runs: {
        Row: {
          answers: Json
          checklist_id: string
          completed_at: string | null
          created_at: string
          executor_nome: string | null
          id: string
          resumo_ia: string | null
          alertas_ia: Json
          scheduled_for: string
          started_at: string | null
          status: string
          token: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          answers?: Json
          checklist_id: string
          completed_at?: string | null
          created_at?: string
          executor_nome?: string | null
          id?: string
          resumo_ia?: string | null
          alertas_ia?: Json
          scheduled_for: string
          started_at?: string | null
          status?: string
          token: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          answers?: Json
          checklist_id?: string
          completed_at?: string | null
          created_at?: string
          executor_nome?: string | null
          id?: string
          resumo_ia?: string | null
          alertas_ia?: Json
          scheduled_for?: string
          started_at?: string | null
          status?: string
          token?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_runs_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_runs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      checklists: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          items: Json
          name: string
          schedule: Json
          updated_at: string
          venue_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          items?: Json
          name: string
          schedule?: Json
          updated_at?: string
          venue_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          items?: Json
          name?: string
          schedule?: Json
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          body: string
          channel: string
          created_at: string
          destination: string
          error: string | null
          id: string
          provider_id: string | null
          reservation_id: string | null
          sent_at: string | null
          status: string
          template: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          attempts?: number
          body: string
          channel?: string
          created_at?: string
          destination: string
          error?: string | null
          id?: string
          provider_id?: string | null
          reservation_id?: string | null
          sent_at?: string | null
          status?: string
          template: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          attempts?: number
          body?: string
          channel?: string
          created_at?: string
          destination?: string
          error?: string | null
          id?: string
          provider_id?: string | null
          reservation_id?: string | null
          sent_at?: string | null
          status?: string
          template?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          convidado_em: string | null
          created_at: string
          org_id: string
          primeiro_acesso_em: string | null
          role: string
          user_id: string
        }
        Insert: {
          convidado_em?: string | null
          created_at?: string
          org_id: string
          primeiro_acesso_em?: string | null
          role?: string
          user_id: string
        }
        Update: {
          convidado_em?: string | null
          created_at?: string
          org_id?: string
          primeiro_acesso_em?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          email_contato: string | null
          id: string
          inicio_contrato: string | null
          mensalidade: number | null
          name: string
          observacoes: string | null
          plan: string
          settings: Json
          slug: string
          status_pagamento: string
          telefone_contato: string | null
          updated_at: string
          vencimento_dia: number | null
        }
        Insert: {
          created_at?: string
          email_contato?: string | null
          id?: string
          inicio_contrato?: string | null
          mensalidade?: number | null
          name: string
          observacoes?: string | null
          plan?: string
          settings?: Json
          slug: string
          status_pagamento?: string
          telefone_contato?: string | null
          updated_at?: string
          vencimento_dia?: number | null
        }
        Update: {
          created_at?: string
          email_contato?: string | null
          id?: string
          inicio_contrato?: string | null
          mensalidade?: number | null
          name?: string
          observacoes?: string | null
          plan?: string
          settings?: Json
          slug?: string
          status_pagamento?: string
          telefone_contato?: string | null
          updated_at?: string
          vencimento_dia?: number | null
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          nome: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          nome?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          nome?: string | null
          user_id?: string
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
        Relationships: [
          {
            foreignKeyName: "reservation_status_history_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "reservations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "tool_calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_calls_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
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
          recurrence: Json | null
          series_id: string | null
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
          recurrence?: Json | null
          series_id?: string | null
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
          recurrence?: Json | null
          series_id?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "venue_info_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          active: boolean
          address: string | null
          capacity: number | null
          ciclo_dia: number
          created_at: string
          description: string | null
          email: string | null
          id: string
          name: string
          opening_hours: Json
          org_id: string
          phone: string | null
          plano: string
          pontos_mensais: number
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
          ciclo_dia?: number
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          name: string
          opening_hours?: Json
          org_id: string
          phone?: string | null
          plano?: string
          pontos_mensais?: number
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
          ciclo_dia?: number
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          name?: string
          opening_hours?: Json
          org_id?: string
          phone?: string | null
          plano?: string
          pontos_mensais?: number
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "webhooks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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

type DefaultSchema = DatabaseWithoutInternals["public"]

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
    Enums: {},
  },
} as const
