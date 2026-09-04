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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bulk_days: {
        Row: {
          bulk_profile_id: string
          created_at: string
          day: string
          id: string
          payload: Json
          updated_at: string
        }
        Insert: {
          bulk_profile_id: string
          created_at?: string
          day: string
          id?: string
          payload?: Json
          updated_at?: string
        }
        Update: {
          bulk_profile_id?: string
          created_at?: string
          day?: string
          id?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_days_bulk_profile_id_fkey"
            columns: ["bulk_profile_id"]
            isOneToOne: false
            referencedRelation: "bulk_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_invitations: {
        Row: {
          accepted_at: string | null
          bulk_profile_id: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          invited_email: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["bulk_role"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          bulk_profile_id: string
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          invited_email: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["bulk_role"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          bulk_profile_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          invited_email?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["bulk_role"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_invitations_bulk_profile_id_fkey"
            columns: ["bulk_profile_id"]
            isOneToOne: false
            referencedRelation: "bulk_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_members: {
        Row: {
          bulk_profile_id: string
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["bulk_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          bulk_profile_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["bulk_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          bulk_profile_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["bulk_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_members_bulk_profile_id_fkey"
            columns: ["bulk_profile_id"]
            isOneToOne: false
            referencedRelation: "bulk_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_photos: {
        Row: {
          back_path: string | null
          bulk_profile_id: string
          created_at: string
          front_path: string | null
          id: string
          side_path: string | null
          taken_on: string
          updated_at: string
          weight: number | null
        }
        Insert: {
          back_path?: string | null
          bulk_profile_id: string
          created_at?: string
          front_path?: string | null
          id?: string
          side_path?: string | null
          taken_on: string
          updated_at?: string
          weight?: number | null
        }
        Update: {
          back_path?: string | null
          bulk_profile_id?: string
          created_at?: string
          front_path?: string | null
          id?: string
          side_path?: string | null
          taken_on?: string
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bulk_photos_bulk_profile_id_fkey"
            columns: ["bulk_profile_id"]
            isOneToOne: false
            referencedRelation: "bulk_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_profiles: {
        Row: {
          allow_editor: boolean
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          allow_editor?: boolean
          created_at?: string
          id?: string
          name?: string
          owner_id: string
        }
        Update: {
          allow_editor?: boolean
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      bulk_targets: {
        Row: {
          bulk_profile_id: string
          payload: Json
          updated_at: string
        }
        Insert: {
          bulk_profile_id: string
          payload?: Json
          updated_at?: string
        }
        Update: {
          bulk_profile_id?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_targets_bulk_profile_id_fkey"
            columns: ["bulk_profile_id"]
            isOneToOne: true
            referencedRelation: "bulk_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_week_notes: {
        Row: {
          bulk_profile_id: string
          id: string
          note: string
          updated_at: string
          week_start: string
        }
        Insert: {
          bulk_profile_id: string
          id?: string
          note?: string
          updated_at?: string
          week_start: string
        }
        Update: {
          bulk_profile_id?: string
          id?: string
          note?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_week_notes_bulk_profile_id_fkey"
            columns: ["bulk_profile_id"]
            isOneToOne: false
            referencedRelation: "bulk_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_workouts: {
        Row: {
          bulk_profile_id: string
          created_at: string
          day: string
          id: string
          payload: Json
          updated_at: string
        }
        Insert: {
          bulk_profile_id: string
          created_at?: string
          day: string
          id?: string
          payload?: Json
          updated_at?: string
        }
        Update: {
          bulk_profile_id?: string
          created_at?: string
          day?: string
          id?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_workouts_bulk_profile_id_fkey"
            columns: ["bulk_profile_id"]
            isOneToOne: false
            referencedRelation: "bulk_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_activities: {
        Row: {
          activity_date: string
          activity_type: Database["public"]["Enums"]["activity_kind"]
          average_pace_seconds_per_km: number | null
          average_speed_kmh: number | null
          challenge_id: string
          created_at: string
          distance_km: number
          duration_seconds: number | null
          edited: boolean
          equivalent_km: number | null
          evidence_path: string
          external_activity_url: string | null
          extra_evidence_paths: string[]
          id: string
          is_qualified: boolean | null
          note: string | null
          qualifying_equivalent_km: number | null
          strava_activity_id: string | null
          strava_athlete_id: string | null
          updated_at: string
          user_id: string
          verification_source: string
        }
        Insert: {
          activity_date: string
          activity_type: Database["public"]["Enums"]["activity_kind"]
          average_pace_seconds_per_km?: number | null
          average_speed_kmh?: number | null
          challenge_id: string
          created_at?: string
          distance_km: number
          duration_seconds?: number | null
          edited?: boolean
          equivalent_km?: number | null
          evidence_path: string
          external_activity_url?: string | null
          extra_evidence_paths?: string[]
          id?: string
          is_qualified?: boolean | null
          note?: string | null
          qualifying_equivalent_km?: number | null
          strava_activity_id?: string | null
          strava_athlete_id?: string | null
          updated_at?: string
          user_id: string
          verification_source?: string
        }
        Update: {
          activity_date?: string
          activity_type?: Database["public"]["Enums"]["activity_kind"]
          average_pace_seconds_per_km?: number | null
          average_speed_kmh?: number | null
          challenge_id?: string
          created_at?: string
          distance_km?: number
          duration_seconds?: number | null
          edited?: boolean
          equivalent_km?: number | null
          evidence_path?: string
          external_activity_url?: string | null
          extra_evidence_paths?: string[]
          id?: string
          is_qualified?: boolean | null
          note?: string | null
          qualifying_equivalent_km?: number | null
          strava_activity_id?: string | null
          strava_athlete_id?: string | null
          updated_at?: string
          user_id?: string
          verification_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_activities_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_activity_audit: {
        Row: {
          action: string
          activity_id: string
          challenge_id: string
          changed_at: string
          changed_by: string
          id: string
          old_activity_date: string | null
          old_activity_type: Database["public"]["Enums"]["activity_kind"] | null
          old_distance_km: number | null
          old_duration_seconds: number | null
        }
        Insert: {
          action: string
          activity_id: string
          challenge_id: string
          changed_at?: string
          changed_by: string
          id?: string
          old_activity_date?: string | null
          old_activity_type?:
            | Database["public"]["Enums"]["activity_kind"]
            | null
          old_distance_km?: number | null
          old_duration_seconds?: number | null
        }
        Update: {
          action?: string
          activity_id?: string
          challenge_id?: string
          changed_at?: string
          changed_by?: string
          id?: string
          old_activity_date?: string | null
          old_activity_type?:
            | Database["public"]["Enums"]["activity_kind"]
            | null
          old_distance_km?: number | null
          old_duration_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "challenge_activity_audit_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_evidence_cleanup: {
        Row: {
          activity_id: string
          attempts: number
          challenge_id: string
          completed_at: string | null
          created_at: string
          last_error: string | null
          lease_token: string | null
          lease_until: string | null
          next_attempt_at: string
          status: string
          storage_paths: string[]
          updated_at: string
        }
        Insert: {
          activity_id: string
          attempts?: number
          challenge_id: string
          completed_at?: string | null
          created_at?: string
          last_error?: string | null
          lease_token?: string | null
          lease_until?: string | null
          next_attempt_at?: string
          status?: string
          storage_paths: string[]
          updated_at?: string
        }
        Update: {
          activity_id?: string
          attempts?: number
          challenge_id?: string
          completed_at?: string | null
          created_at?: string
          last_error?: string | null
          lease_token?: string | null
          lease_until?: string | null
          next_attempt_at?: string
          status?: string
          storage_paths?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_evidence_cleanup_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: true
            referencedRelation: "challenge_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_evidence_cleanup_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_invitations: {
        Row: {
          accepted_at: string | null
          challenge_id: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          invited_email: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          challenge_id: string
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          invited_email: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          challenge_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          invited_email?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_invitations_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_members: {
        Row: {
          challenge_id: string
          id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          challenge_id: string
          id?: string
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          challenge_id?: string
          id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_members_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_notification_events: {
        Row: {
          actor_id: string
          actor_membership_id: string
          attempts: number
          challenge_id: string
          created_at: string
          dedupe_key: string
          facts: Json
          finished_at: string | null
          id: string
          kind: string
          last_error: string | null
          lease_token: string | null
          lease_until: string | null
          next_attempt_at: string
          opponent_membership_id: string
          provider_message_id: string | null
          status: string
          subscription_ids: string[] | null
        }
        Insert: {
          actor_id: string
          actor_membership_id: string
          attempts?: number
          challenge_id: string
          created_at?: string
          dedupe_key: string
          facts: Json
          finished_at?: string | null
          id?: string
          kind: string
          last_error?: string | null
          lease_token?: string | null
          lease_until?: string | null
          next_attempt_at?: string
          opponent_membership_id: string
          provider_message_id?: string | null
          status?: string
          subscription_ids?: string[] | null
        }
        Update: {
          actor_id?: string
          actor_membership_id?: string
          attempts?: number
          challenge_id?: string
          created_at?: string
          dedupe_key?: string
          facts?: Json
          finished_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          lease_token?: string | null
          lease_until?: string | null
          next_attempt_at?: string
          opponent_membership_id?: string
          provider_message_id?: string | null
          status?: string
          subscription_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "challenge_notification_events_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_payments: {
        Row: {
          amount_eur: number
          challenge_id: string
          confirmed_at: string | null
          created_at: string
          id: string
          marked_paid_at: string | null
          payer_id: string
          payment_evidence_path: string | null
          recipient_id: string
          settled_by: string | null
          status: Database["public"]["Enums"]["payment_status"]
          week_id: string
        }
        Insert: {
          amount_eur: number
          challenge_id: string
          confirmed_at?: string | null
          created_at?: string
          id?: string
          marked_paid_at?: string | null
          payer_id: string
          payment_evidence_path?: string | null
          recipient_id: string
          settled_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          week_id: string
        }
        Update: {
          amount_eur?: number
          challenge_id?: string
          confirmed_at?: string | null
          created_at?: string
          id?: string
          marked_paid_at?: string | null
          payer_id?: string
          payment_evidence_path?: string | null
          recipient_id?: string
          settled_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_payments_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_payments_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: true
            referencedRelation: "challenge_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_push_users: {
        Row: {
          enabled: boolean
          external_id: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          external_id?: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          external_id?: string
          user_id?: string
        }
        Relationships: []
      }
      challenge_travel_pauses: {
        Row: {
          challenge_id: string
          country: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
          week_number: number
        }
        Insert: {
          challenge_id: string
          country: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
          week_number: number
        }
        Update: {
          challenge_id?: string
          country?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "challenge_travel_pauses_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_week_targets: {
        Row: {
          challenge_id: string
          created_at: string
          id: string
          set_by: string
          target_km: number
          updated_at: string
          week_number: number
        }
        Insert: {
          challenge_id: string
          created_at?: string
          id?: string
          set_by: string
          target_km: number
          updated_at?: string
          week_number: number
        }
        Update: {
          challenge_id?: string
          created_at?: string
          id?: string
          set_by?: string
          target_km?: number
          updated_at?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "challenge_week_targets_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_weeks: {
        Row: {
          challenge_id: string
          completed: boolean
          cycling_km: number
          equivalent_km: number
          finalized_at: string
          id: string
          pause_country: string | null
          paused: boolean
          penalty_band: string | null
          penalty_consequence: string | null
          penalty_eur: number
          penalty_mode: string | null
          running_km: number
          target_km: number
          user_id: string
          week_end: string
          week_number: number
          week_start: string
        }
        Insert: {
          challenge_id: string
          completed?: boolean
          cycling_km?: number
          equivalent_km?: number
          finalized_at?: string
          id?: string
          pause_country?: string | null
          paused?: boolean
          penalty_band?: string | null
          penalty_consequence?: string | null
          penalty_eur?: number
          penalty_mode?: string | null
          running_km?: number
          target_km?: number
          user_id: string
          week_end: string
          week_number: number
          week_start: string
        }
        Update: {
          challenge_id?: string
          completed?: boolean
          cycling_km?: number
          equivalent_km?: number
          finalized_at?: string
          id?: string
          pause_country?: string | null
          paused?: boolean
          penalty_band?: string | null
          penalty_consequence?: string | null
          penalty_eur?: number
          penalty_mode?: string | null
          running_km?: number
          target_km?: number
          user_id?: string
          week_end?: string
          week_number?: number
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_weeks_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          created_at: string
          created_by: string
          cycling_ratio: number
          duration_weeks: number
          id: string
          legacy_photo_owed: boolean
          max_members: number
          name: string
          penalty_high_custom: string | null
          penalty_high_eur: number
          penalty_low_custom: string | null
          penalty_low_eur: number
          penalty_medium_custom: string | null
          penalty_medium_eur: number
          penalty_mode: string
          rules_locked_at: string
          running_ratio: number
          start_date: string
          status: Database["public"]["Enums"]["challenge_status"]
          timezone: string
          weekly_target_km: number
        }
        Insert: {
          created_at?: string
          created_by: string
          cycling_ratio?: number
          duration_weeks?: number
          id?: string
          legacy_photo_owed?: boolean
          max_members?: number
          name: string
          penalty_high_custom?: string | null
          penalty_high_eur?: number
          penalty_low_custom?: string | null
          penalty_low_eur?: number
          penalty_medium_custom?: string | null
          penalty_medium_eur?: number
          penalty_mode?: string
          rules_locked_at?: string
          running_ratio?: number
          start_date: string
          status?: Database["public"]["Enums"]["challenge_status"]
          timezone?: string
          weekly_target_km?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          cycling_ratio?: number
          duration_weeks?: number
          id?: string
          legacy_photo_owed?: boolean
          max_members?: number
          name?: string
          penalty_high_custom?: string | null
          penalty_high_eur?: number
          penalty_low_custom?: string | null
          penalty_low_eur?: number
          penalty_medium_custom?: string | null
          penalty_medium_eur?: number
          penalty_mode?: string
          rules_locked_at?: string
          running_ratio?: number
          start_date?: string
          status?: Database["public"]["Enums"]["challenge_status"]
          timezone?: string
          weekly_target_km?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_seen_at: string
          platform: string
          provider: string
          subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          platform?: string
          provider?: string
          subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          platform?: string
          provider?: string
          subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_bulk_invitation: {
        Args: { _caller: string; _email: string; _token: string }
        Returns: string
      }
      accept_challenge_invitation: {
        Args: { _caller: string; _email: string; _token: string }
        Returns: string
      }
      challenge_today: { Args: { _c: string }; Returns: string }
      challenge_week_of: { Args: { _c: string; _d: string }; Returns: number }
      challenge_week_open: {
        Args: { _c: string; _d: string }
        Returns: boolean
      }
      claim_challenge_evidence_cleanup: {
        Args: { _challenge?: string; _limit?: number }
        Returns: {
          activity_id: string
          attempts: number
          challenge_id: string
          lease_token: string
          storage_paths: string[]
        }[]
      }
      claim_challenge_push_events: {
        Args: never
        Returns: {
          actor_id: string
          actor_membership_id: string
          attempts: number
          challenge_id: string
          created_at: string
          dedupe_key: string
          facts: Json
          finished_at: string | null
          id: string
          kind: string
          last_error: string | null
          lease_token: string | null
          lease_until: string | null
          next_attempt_at: string
          opponent_membership_id: string
          provider_message_id: string | null
          status: string
          subscription_ids: string[] | null
        }[]
        SetofOptions: {
          from: "*"
          to: "challenge_notification_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_challenge_atomic: {
        Args: {
          _duration_weeks: number
          _invited_email: string
          _name: string
          _penalty_high_custom: string | null
          _penalty_high_eur: number
          _penalty_low_custom: string | null
          _penalty_low_eur: number
          _penalty_medium_custom: string | null
          _penalty_medium_eur: number
          _penalty_mode: string
          _request_id: string
          _start_date: string
          _timezone: string
          _token_hash: string
          _weekly_target_km: number
        }
        Returns: string
      }
      disable_challenge_push: { Args: never; Returns: undefined }
      ensure_bulk_profile: { Args: { _caller: string }; Returns: string }
      finalize_challenge: {
        Args: { _c: string; _caller: string }
        Returns: number
      }
      finish_challenge_evidence_cleanup: {
        Args: { _activity: string; _lease: string; _succeeded: boolean }
        Returns: boolean
      }
      penalty_for:
        | { Args: { _km: number; _target: number }; Returns: number }
        | {
            Args: {
              _high: number
              _km: number
              _low: number
              _medium: number
              _target: number
            }
            Returns: number
          }
      preview_challenge_invitation: {
        Args: { _caller: string; _email: string; _token: string }
        Returns: {
          challenge_id: string
          challenge_name: string
          duration_weeks: number
          legacy_photo_owed: boolean
          penalty_high_custom: string | null
          penalty_high_eur: number
          penalty_low_custom: string | null
          penalty_low_eur: number
          penalty_medium_custom: string | null
          penalty_medium_eur: number
          penalty_mode: string
          weekly_target_km: number
        }[]
      }
      register_challenge_push_device: {
        Args: {
          _activate: boolean
          _external_id: string
          _subscription: string
          _user: string
        }
        Returns: boolean
      }
      related_profiles: {
        Args: { _caller: string }
        Returns: {
          display_name: string
          email: string
          id: string
        }[]
      }
      safe_uuid: { Args: { _t: string }; Returns: string }
      set_bulk_editor: {
        Args: {
          _bulk: string
          _caller: string
          _editor: boolean
          _user: string
        }
        Returns: undefined
      }
    }
    Enums: {
      activity_kind: "run" | "cycle"
      bulk_role: "owner" | "viewer" | "editor"
      challenge_status: "draft" | "active" | "completed"
      payment_status: "unpaid" | "marked_paid" | "confirmed_paid"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      activity_kind: ["run", "cycle"],
      bulk_role: ["owner", "viewer", "editor"],
      challenge_status: ["draft", "active", "completed"],
      payment_status: ["unpaid", "marked_paid", "confirmed_paid"],
    },
  },
} as const
