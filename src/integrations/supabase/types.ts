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
      bulk_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
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
      bulk_meal_preset_ingredients: {
        Row: {
          id: string
          meal_preset_id: string
          name: string
          quantity: number
          sort_order: number
          unit: string
        }
        Insert: {
          id?: string
          meal_preset_id: string
          name: string
          quantity: number
          sort_order: number
          unit: string
        }
        Update: {
          id?: string
          meal_preset_id?: string
          name?: string
          quantity?: number
          sort_order?: number
          unit?: string
        }
        Relationships: [{
          foreignKeyName: "bulk_meal_preset_ingredients_meal_preset_id_fkey"
          columns: ["meal_preset_id"]
          isOneToOne: false
          referencedRelation: "bulk_meal_presets"
          referencedColumns: ["id"]
        }]
      }
      bulk_meal_presets: {
        Row: {
          bulk_profile_id: string
          calories: number
          carbs_g: number
          created_at: string
          description: string | null
          fat_g: number
          id: string
          name: string
          protein_g: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          bulk_profile_id: string
          calories: number
          carbs_g: number
          created_at?: string
          description?: string | null
          fat_g: number
          id?: string
          name: string
          protein_g: number
          sort_order: number
          updated_at?: string
        }
        Update: {
          bulk_profile_id?: string
          calories?: number
          carbs_g?: number
          created_at?: string
          description?: string | null
          fat_g?: number
          id?: string
          name?: string
          protein_g?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [{
          foreignKeyName: "bulk_meal_presets_bulk_profile_id_fkey"
          columns: ["bulk_profile_id"]
          isOneToOne: false
          referencedRelation: "bulk_profiles"
          referencedColumns: ["id"]
        }]
      }
      bulk_nutrition_days: {
        Row: {
          bulk_profile_id: string
          created_at: string
          id: string
          log_date: string
          target_calories: number
          target_carbs_g: number
          target_fat_g: number
          target_protein_g: number
          updated_at: string
        }
        Insert: {
          bulk_profile_id: string
          created_at?: string
          id?: string
          log_date: string
          target_calories: number
          target_carbs_g: number
          target_fat_g: number
          target_protein_g: number
          updated_at?: string
        }
        Update: {
          bulk_profile_id?: string
          created_at?: string
          id?: string
          log_date?: string
          target_calories?: number
          target_carbs_g?: number
          target_fat_g?: number
          target_protein_g?: number
          updated_at?: string
        }
        Relationships: [{
          foreignKeyName: "bulk_nutrition_days_bulk_profile_id_fkey"
          columns: ["bulk_profile_id"]
          isOneToOne: false
          referencedRelation: "bulk_profiles"
          referencedColumns: ["id"]
        }]
      }
      bulk_nutrition_entries: {
        Row: {
          calories: number
          carbs_g: number
          created_at: string
          fat_g: number
          id: string
          ingredient_snapshot: Json
          name_snapshot: string
          note: string | null
          nutrition_day_id: string
          protein_g: number
          request_id: string
          sort_order: number
          source_meal_preset_id: string | null
          source_type: string
          updated_at: string
        }
        Insert: {
          calories: number
          carbs_g: number
          created_at?: string
          fat_g: number
          id?: string
          ingredient_snapshot?: Json
          name_snapshot: string
          note?: string | null
          nutrition_day_id: string
          protein_g: number
          request_id: string
          sort_order: number
          source_meal_preset_id?: string | null
          source_type: string
          updated_at?: string
        }
        Update: {
          calories?: number
          carbs_g?: number
          created_at?: string
          fat_g?: number
          id?: string
          ingredient_snapshot?: Json
          name_snapshot?: string
          note?: string | null
          nutrition_day_id?: string
          protein_g?: number
          request_id?: string
          sort_order?: number
          source_meal_preset_id?: string | null
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_nutrition_entries_nutrition_day_id_fkey"
            columns: ["nutrition_day_id"]
            isOneToOne: false
            referencedRelation: "bulk_nutrition_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_nutrition_entries_source_meal_preset_id_fkey"
            columns: ["source_meal_preset_id"]
            isOneToOne: false
            referencedRelation: "bulk_meal_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_exercises: {
        Row: {
          active: boolean
          category: string
          created_at: string
          default_unilateral_mode: string
          equipment: string[]
          id: string
          is_bodyweight: boolean
          is_system: boolean
          min_experience: string
          movement_pattern: string
          name: string
          owner_id: string | null
          primary_muscle: string
          secondary_muscles: string[]
          slug: string
          supports_unilateral: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          default_unilateral_mode?: string
          equipment: string[]
          id?: string
          is_bodyweight?: boolean
          is_system?: boolean
          min_experience?: string
          movement_pattern: string
          name: string
          owner_id?: string | null
          primary_muscle: string
          secondary_muscles?: string[]
          slug: string
          supports_unilateral?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          default_unilateral_mode?: string
          equipment?: string[]
          id?: string
          is_bodyweight?: boolean
          is_system?: boolean
          min_experience?: string
          movement_pattern?: string
          name?: string
          owner_id?: string | null
          primary_muscle?: string
          secondary_muscles?: string[]
          slug?: string
          supports_unilateral?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      bulk_training_plan_days: {
        Row: { day_order: number; id: string; name: string; plan_id: string }
        Insert: { day_order: number; id?: string; name: string; plan_id: string }
        Update: { day_order?: number; id?: string; name?: string; plan_id?: string }
        Relationships: [{
          foreignKeyName: "bulk_training_plan_days_plan_id_fkey"
          columns: ["plan_id"]
          isOneToOne: false
          referencedRelation: "bulk_training_plans"
          referencedColumns: ["id"]
        }]
      }
      bulk_training_plan_exercises: {
        Row: {
          exercise_id: string | null
          exercise_name: string
          exercise_order: number
          id: string
          intended_unilateral_mode: string
          notes: string | null
          plan_day_id: string
          rep_max: number
          rep_min: number
          sets: number
          source_system_exercise_id: string | null
        }
        Insert: {
          exercise_id?: string | null; exercise_name: string; exercise_order: number; id?: string
          intended_unilateral_mode?: string; notes?: string | null; plan_day_id: string
          rep_max: number; rep_min: number; sets: number; source_system_exercise_id?: string | null
        }
        Update: {
          exercise_id?: string | null; exercise_name?: string; exercise_order?: number; id?: string
          intended_unilateral_mode?: string; notes?: string | null; plan_day_id?: string
          rep_max?: number; rep_min?: number; sets?: number; source_system_exercise_id?: string | null
        }
        Relationships: [
          { foreignKeyName: "bulk_training_plan_exercises_plan_day_id_fkey"; columns: ["plan_day_id"]; isOneToOne: false; referencedRelation: "bulk_training_plan_days"; referencedColumns: ["id"] },
          { foreignKeyName: "bulk_training_plan_exercises_exercise_id_fkey"; columns: ["exercise_id"]; isOneToOne: false; referencedRelation: "bulk_exercises"; referencedColumns: ["id"] },
        ]
      }
      bulk_training_sessions: {
        Row: {
          bulk_profile_id: string; completed_at: string | null; created_at: string; id: string
          plan_name_snapshot: string; source_plan_day_id: string | null; started_at: string
          status: string; training_plan_id: string | null; updated_at: string
          workout_day_name_snapshot: string; workout_day_order_snapshot: number
        }
        Insert: {
          bulk_profile_id: string; completed_at?: string | null; created_at?: string; id?: string
          plan_name_snapshot: string; source_plan_day_id?: string | null; started_at?: string
          status?: string; training_plan_id?: string | null; updated_at?: string
          workout_day_name_snapshot: string; workout_day_order_snapshot: number
        }
        Update: {
          bulk_profile_id?: string; completed_at?: string | null; created_at?: string; id?: string
          plan_name_snapshot?: string; source_plan_day_id?: string | null; started_at?: string
          status?: string; training_plan_id?: string | null; updated_at?: string
          workout_day_name_snapshot?: string; workout_day_order_snapshot?: number
        }
        Relationships: [
          { foreignKeyName: "bulk_training_sessions_bulk_profile_id_fkey"; columns: ["bulk_profile_id"]; isOneToOne: false; referencedRelation: "bulk_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "bulk_training_sessions_training_plan_id_fkey"; columns: ["training_plan_id"]; isOneToOne: false; referencedRelation: "bulk_training_plans"; referencedColumns: ["id"] },
          { foreignKeyName: "bulk_training_sessions_source_plan_day_id_fkey"; columns: ["source_plan_day_id"]; isOneToOne: false; referencedRelation: "bulk_training_plan_days"; referencedColumns: ["id"] },
        ]
      }
      bulk_training_session_exercises: {
        Row: {
          exercise_name_snapshot: string; exercise_order: number; execution_mode: string; id: string
          is_bodyweight: boolean; notes_snapshot: string | null; session_id: string
          source_exercise_id: string | null; source_plan_exercise_id: string | null
          target_rep_max: number; target_rep_min: number; target_sets: number
        }
        Insert: {
          exercise_name_snapshot: string; exercise_order: number; execution_mode: string; id?: string
          is_bodyweight: boolean; notes_snapshot?: string | null; session_id: string
          source_exercise_id?: string | null; source_plan_exercise_id?: string | null
          target_rep_max: number; target_rep_min: number; target_sets: number
        }
        Update: {
          exercise_name_snapshot?: string; exercise_order?: number; execution_mode?: string; id?: string
          is_bodyweight?: boolean; notes_snapshot?: string | null; session_id?: string
          source_exercise_id?: string | null; source_plan_exercise_id?: string | null
          target_rep_max?: number; target_rep_min?: number; target_sets?: number
        }
        Relationships: [
          { foreignKeyName: "bulk_training_session_exercises_session_id_fkey"; columns: ["session_id"]; isOneToOne: false; referencedRelation: "bulk_training_sessions"; referencedColumns: ["id"] },
          { foreignKeyName: "bulk_training_session_exercises_source_plan_exercise_id_fkey"; columns: ["source_plan_exercise_id"]; isOneToOne: false; referencedRelation: "bulk_training_plan_exercises"; referencedColumns: ["id"] },
          { foreignKeyName: "bulk_training_session_exercises_source_exercise_id_fkey"; columns: ["source_exercise_id"]; isOneToOne: false; referencedRelation: "bulk_exercises"; referencedColumns: ["id"] },
        ]
      }
      bulk_training_session_sets: {
        Row: {
          bilateral_reps: number | null; bilateral_weight: number | null; id: string
          is_complete: boolean; is_extra: boolean; left_reps: number | null
          left_weight: number | null; right_reps: number | null; right_weight: number | null
          session_exercise_id: string; set_order: number; updated_at: string
        }
        Insert: {
          bilateral_reps?: number | null; bilateral_weight?: number | null; id?: string
          is_complete?: boolean; is_extra?: boolean; left_reps?: number | null
          left_weight?: number | null; right_reps?: number | null; right_weight?: number | null
          session_exercise_id: string; set_order: number; updated_at?: string
        }
        Update: {
          bilateral_reps?: number | null; bilateral_weight?: number | null; id?: string
          is_complete?: boolean; is_extra?: boolean; left_reps?: number | null
          left_weight?: number | null; right_reps?: number | null; right_weight?: number | null
          session_exercise_id?: string; set_order?: number; updated_at?: string
        }
        Relationships: [{ foreignKeyName: "bulk_training_session_sets_session_exercise_id_fkey"; columns: ["session_exercise_id"]; isOneToOne: false; referencedRelation: "bulk_training_session_exercises"; referencedColumns: ["id"] }]
      }
      bulk_training_plan_template_days: {
        Row: { day_order: number; id: string; name: string; template_id: string }
        Insert: { day_order: number; id: string; name: string; template_id: string }
        Update: { day_order?: number; id?: string; name?: string; template_id?: string }
        Relationships: [{ foreignKeyName: "bulk_training_plan_template_days_template_id_fkey"; columns: ["template_id"]; isOneToOne: false; referencedRelation: "bulk_training_plan_templates"; referencedColumns: ["id"] }]
      }
      bulk_training_plan_template_exercises: {
        Row: {
          exercise_id: string; exercise_order: number; id: string; intended_unilateral_mode: string
          notes: string | null; rep_max: number; rep_min: number; sets: number; template_day_id: string
        }
        Insert: {
          exercise_id: string; exercise_order: number; id: string; intended_unilateral_mode?: string
          notes?: string | null; rep_max: number; rep_min: number; sets: number; template_day_id: string
        }
        Update: {
          exercise_id?: string; exercise_order?: number; id?: string; intended_unilateral_mode?: string
          notes?: string | null; rep_max?: number; rep_min?: number; sets?: number; template_day_id?: string
        }
        Relationships: [
          { foreignKeyName: "bulk_training_plan_template_exercises_template_day_id_fkey"; columns: ["template_day_id"]; isOneToOne: false; referencedRelation: "bulk_training_plan_template_days"; referencedColumns: ["id"] },
          { foreignKeyName: "bulk_training_plan_template_exercises_exercise_id_fkey"; columns: ["exercise_id"]; isOneToOne: false; referencedRelation: "bulk_exercises"; referencedColumns: ["id"] },
        ]
      }
      bulk_training_plan_templates: {
        Row: {
          active: boolean; created_at: string; description: string; experience_level: string; id: string
          name: string; required_equipment: string[]; slug: string; split_summary: string
          training_days_per_week: number; updated_at: string
        }
        Insert: {
          active?: boolean; created_at?: string; description: string; experience_level: string; id: string
          name: string; required_equipment?: string[]; slug: string; split_summary: string
          training_days_per_week: number; updated_at?: string
        }
        Update: {
          active?: boolean; created_at?: string; description?: string; experience_level?: string; id?: string
          name?: string; required_equipment?: string[]; slug?: string; split_summary?: string
          training_days_per_week?: number; updated_at?: string
        }
        Relationships: []
      }
      bulk_training_plans: {
        Row: {
          active: boolean; bulk_profile_id: string; created_at: string; description: string
          experience_level: string | null; id: string; name: string; plan_type: string
          source_template_id: string | null; training_days_per_week: number; updated_at: string
        }
        Insert: {
          active?: boolean; bulk_profile_id: string; created_at?: string; description?: string
          experience_level?: string | null; id?: string; name: string; plan_type: string
          source_template_id?: string | null; training_days_per_week: number; updated_at?: string
        }
        Update: {
          active?: boolean; bulk_profile_id?: string; created_at?: string; description?: string
          experience_level?: string | null; id?: string; name?: string; plan_type?: string
          source_template_id?: string | null; training_days_per_week?: number; updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "bulk_training_plans_bulk_profile_id_fkey"; columns: ["bulk_profile_id"]; isOneToOne: false; referencedRelation: "bulk_profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "bulk_training_plans_source_template_id_fkey"; columns: ["source_template_id"]; isOneToOne: false; referencedRelation: "bulk_training_plan_templates"; referencedColumns: ["id"] },
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
      bulk_progress_photos: {
        Row: {
          bulk_profile_id: string
          created_at: string
          id: string
          log_date: string
          note: string | null
          storage_path: string
          updated_at: string
          view_type: string
        }
        Insert: {
          bulk_profile_id: string
          created_at?: string
          id?: string
          log_date: string
          note?: string | null
          storage_path: string
          updated_at?: string
          view_type?: string
        }
        Update: {
          bulk_profile_id?: string
          created_at?: string
          id?: string
          log_date?: string
          note?: string | null
          storage_path?: string
          updated_at?: string
          view_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_progress_photos_bulk_profile_id_fkey"
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
      bulk_weight_entries: {
        Row: {
          bulk_profile_id: string
          created_at: string
          id: string
          log_date: string
          note: string | null
          updated_at: string
          weight_kg: number
        }
        Insert: {
          bulk_profile_id: string
          created_at?: string
          id?: string
          log_date: string
          note?: string | null
          updated_at?: string
          weight_kg: number
        }
        Update: {
          bulk_profile_id?: string
          created_at?: string
          id?: string
          log_date?: string
          note?: string | null
          updated_at?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "bulk_weight_entries_bulk_profile_id_fkey"
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
          travel_pause_enabled: boolean
          travel_pause_home_countries: string[]
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
          travel_pause_enabled?: boolean
          travel_pause_home_countries?: string[]
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
          travel_pause_enabled?: boolean
          travel_pause_home_countries?: string[]
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
      apply_bulk_calorie_recommendation: {
        Args: { _expected_current_calories: number; _new_calories: number }
        Returns: boolean
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
          _travel_pause_enabled: boolean
          _travel_pause_home_countries: string[]
          _weekly_target_km: number
        }
        Returns: string
      }
      disable_challenge_push: { Args: never; Returns: undefined }
      activate_my_bulk: { Args: never; Returns: string }
      complete_bulk_onboarding: {
        Args: {
          _available_equipment: string[]
          _calories: number
          _carbs: number
          _current_weight_kg: number
          _experience_level: string
          _fat: number
          _protein: number
          _target_weekly_gain_kg: number
          _target_weight_kg: number
          _training_days_per_week: number
          _training_setup_preference: string
        }
        Returns: string
      }
      create_bulk_meal_preset: {
        Args: {
          _calories: number
          _carbs: number
          _description: string | null
          _fat: number
          _ingredients?: Json
          _name: string
          _protein: number
        }
        Returns: string
      }
      update_bulk_meal_preset: {
        Args: {
          _calories: number
          _carbs: number
          _description: string | null
          _expected_updated_at: string
          _fat: number
          _ingredients?: Json
          _meal: string
          _name: string
          _protein: number
        }
        Returns: string
      }
      duplicate_bulk_meal_preset: { Args: { _meal: string }; Returns: string }
      delete_bulk_meal_preset: { Args: { _meal: string }; Returns: boolean }
      move_bulk_meal_preset: {
        Args: { _direction: number; _meal: string }
        Returns: boolean
      }
      log_bulk_meal_preset: {
        Args: { _log_date: string; _preset: string; _request_id: string }
        Returns: string
      }
      create_bulk_nutrition_entry: {
        Args: {
          _calories: number
          _carbs: number
          _fat: number
          _log_date: string
          _name: string
          _note?: string | null
          _protein: number
          _request_id: string
        }
        Returns: string
      }
      update_bulk_nutrition_entry: {
        Args: {
          _calories: number
          _carbs: number
          _entry: string
          _expected_updated_at: string
          _fat: number
          _name: string
          _note?: string | null
          _protein: number
        }
        Returns: string
      }
      delete_bulk_nutrition_entry: { Args: { _entry: string }; Returns: boolean }
      create_empty_bulk_training_plan: { Args: { _name: string }; Returns: string }
      ensure_bulk_profile: { Args: { _caller: string }; Returns: string }
      finalize_challenge: {
        Args: { _c: string; _caller: string }
        Returns: number
      }
      finish_challenge_evidence_cleanup: {
        Args: { _activity: string; _lease: string; _succeeded: boolean }
        Returns: boolean
      }
      is_bulk_admin: { Args: never; Returns: boolean }
      instantiate_bulk_training_plan: {
        Args: { _plan_type: string; _template_id: string }
        Returns: string
      }
      save_bulk_training_plan: {
        Args: {
          _days: Json
          _expected_updated_at: string
          _name: string
          _plan: string
        }
        Returns: string
      }
      start_bulk_training_session: { Args: { _plan_day: string }; Returns: string }
      save_bulk_training_session_set: {
        Args: {
          _bilateral_reps: number | null; _bilateral_weight: number | null
          _left_reps: number | null; _left_weight: number | null
          _right_reps: number | null; _right_weight: number | null
          _session: string; _set: string
        }
        Returns: string
      }
      add_bulk_training_session_set: { Args: { _exercise: string; _session: string }; Returns: string }
      remove_bulk_training_session_set: { Args: { _session: string; _set: string }; Returns: boolean }
      finish_bulk_training_session: { Args: { _confirm_incomplete?: boolean; _session: string }; Returns: string }
      discard_bulk_training_session: { Args: { _session: string }; Returns: boolean }
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
          travel_pause_enabled: boolean
          travel_pause_home_countries: string[]
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
