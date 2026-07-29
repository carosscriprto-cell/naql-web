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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_config: {
        Row: {
          key: string
          value: Json
        }
        Insert: {
          key: string
          value: Json
        }
        Update: {
          key?: string
          value?: Json
        }
        Relationships: []
      }
      booking_passengers: {
        Row: {
          active: boolean
          booking_id: string
          checked_in_at: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender"]
          id: string
          phone: string
          seat_number: string
          trip_id: string
        }
        Insert: {
          active?: boolean
          booking_id: string
          checked_in_at?: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender"]
          id?: string
          phone: string
          seat_number: string
          trip_id: string
        }
        Update: {
          active?: boolean
          booking_id?: string
          checked_in_at?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["gender"]
          id?: string
          phone?: string
          seat_number?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_passengers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_passengers_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          commission_rate: number
          created_at: string
          id: string
          idempotency_key: string
          payload_hash: string | null
          payment_method: string
          pnr: string
          response_snapshot: Json | null
          status: Database["public"]["Enums"]["booking_status"]
          total_price: number
          trip_id: string
          user_id: string
        }
        Insert: {
          commission_rate: number
          created_at?: string
          id?: string
          idempotency_key: string
          payload_hash?: string | null
          payment_method: string
          pnr: string
          response_snapshot?: Json | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_price: number
          trip_id: string
          user_id: string
        }
        Update: {
          commission_rate?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          payload_hash?: string | null
          payment_method?: string
          pnr?: string
          response_snapshot?: Json | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_price?: number
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      buses: {
        Row: {
          bus_type: string
          company_id: string
          id: string
          layout: Json
          plate_number: string
        }
        Insert: {
          bus_type: string
          company_id: string
          id?: string
          layout: Json
          plate_number: string
        }
        Update: {
          bus_type?: string
          company_id?: string
          id?: string
          layout?: Json
          plate_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "buses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          id: string
          name_ar: string
          name_en: string
          slug: string
        }
        Insert: {
          id?: string
          name_ar: string
          name_en: string
          slug: string
        }
        Update: {
          id?: string
          name_ar?: string
          name_en?: string
          slug?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          commission_rate: number
          created_at: string
          id: string
          logo_url: string | null
          name: string
          rating: number | null
          status: Database["public"]["Enums"]["company_status"]
        }
        Insert: {
          commission_rate?: number
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          rating?: number | null
          status?: Database["public"]["Enums"]["company_status"]
        }
        Update: {
          commission_rate?: number
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          rating?: number | null
          status?: Database["public"]["Enums"]["company_status"]
        }
        Relationships: []
      }
      lookup_attempts: {
        Row: {
          attempted_at: string
          id: string
          pnr: string
        }
        Insert: {
          attempted_at?: string
          id?: string
          pnr: string
        }
        Update: {
          attempted_at?: string
          id?: string
          pnr?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          role: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id: string
          role: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          default_duration_min: number
          from_city_id: string
          id: string
          to_city_id: string
        }
        Insert: {
          default_duration_min: number
          from_city_id: string
          id?: string
          to_city_id: string
        }
        Update: {
          default_duration_min?: number
          from_city_id?: string
          id?: string
          to_city_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_from_city_id_fkey"
            columns: ["from_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_to_city_id_fkey"
            columns: ["to_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      seat_lock_seats: {
        Row: {
          gender: Database["public"]["Enums"]["gender"]
          id: string
          lock_id: string
          seat_number: string
          trip_id: string
        }
        Insert: {
          gender: Database["public"]["Enums"]["gender"]
          id?: string
          lock_id: string
          seat_number: string
          trip_id: string
        }
        Update: {
          gender?: Database["public"]["Enums"]["gender"]
          id?: string
          lock_id?: string
          seat_number?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seat_lock_seats_lock_id_fkey"
            columns: ["lock_id"]
            isOneToOne: false
            referencedRelation: "seat_locks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seat_lock_seats_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      seat_locks: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          owner_id: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          owner_id: string
          trip_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          owner_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seat_locks_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_seat_map_version: {
        Row: {
          revision: number
          trip_id: string
          updated_at: string
        }
        Insert: {
          revision?: number
          trip_id: string
          updated_at?: string
        }
        Update: {
          revision?: number
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_seat_map_version_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: true
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          arrival_at: string
          bus_id: string
          company_id: string
          created_at: string
          departure_at: string
          id: string
          price: number
          route_id: string
          status: Database["public"]["Enums"]["trip_status"]
        }
        Insert: {
          arrival_at: string
          bus_id: string
          company_id: string
          created_at?: string
          departure_at: string
          id?: string
          price: number
          route_id: string
          status?: Database["public"]["Enums"]["trip_status"]
        }
        Update: {
          arrival_at?: string
          bus_id?: string
          company_id?: string
          created_at?: string
          departure_at?: string
          id?: string
          price?: number
          route_id?: string
          status?: Database["public"]["Enums"]["trip_status"]
        }
        Relationships: [
          {
            foreignKeyName: "trips_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "buses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_company_json: { Args: { p_company_id: string }; Returns: Json }
      booking_ticket: { Args: { p_booking_id: string }; Returns: Json }
      cancel_booking: { Args: { p_booking_id: string }; Returns: Json }
      cancel_trip: { Args: { p_trip_id: string }; Returns: Json }
      check_in: { Args: { p_qr_payload: string }; Returns: Json }
      check_in_booking: {
        Args: { p_booking_id: string; p_company_id: string }
        Returns: Json
      }
      check_in_by_pnr: { Args: { p_pnr: string }; Returns: Json }
      commissions_by_month: { Args: { p_month: string }; Returns: Json }
      create_booking: {
        Args: {
          p_idempotency_key: string
          p_lock_id: string
          p_passengers: Json
          p_payment_method: string
        }
        Returns: Json
      }
      create_bus: {
        Args: { p_bus_type: string; p_layout: Json; p_plate_number: string }
        Returns: Json
      }
      create_trip: {
        Args: {
          p_arrival_at: string
          p_bus_id: string
          p_departure_at: string
          p_price: number
          p_route_id: string
        }
        Returns: Json
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      delete_city: { Args: { p_city_id: string }; Returns: Json }
      delete_route: { Args: { p_route_id: string }; Returns: Json }
      generate_pnr: { Args: never; Returns: string }
      get_booking: { Args: { p_id: string }; Returns: Json }
      get_manifest: { Args: { p_trip_id: string }; Returns: Json }
      get_seat_map: { Args: { p_trip_id: string }; Returns: Json }
      get_trip: { Args: { p_trip_id: string }; Returns: Json }
      lock_seats: { Args: { p_seats: Json; p_trip_id: string }; Returns: Json }
      lookup_booking: {
        Args: { p_phone: string; p_pnr: string }
        Returns: Json
      }
      operator_cancel_booking: { Args: { p_booking_id: string }; Returns: Json }
      operator_summary: {
        Args: { p_from_date: string; p_to_date: string }
        Returns: Json
      }
      operator_trip_json: { Args: { p_trip_id: string }; Returns: Json }
      qr_hmac_secret: { Args: never; Returns: string }
      release_lock: { Args: { p_lock_id: string }; Returns: Json }
      role_executable_functions: { Args: { p_role: string }; Returns: string[] }
      search_trips: {
        Args: {
          p_from_slug: string
          p_passengers: number
          p_to_slug: string
          p_travel_date: string
        }
        Returns: Json
      }
      set_commission_rate: {
        Args: { p_company_id: string; p_rate: number }
        Returns: Json
      }
      set_company_status: {
        Args: { p_company_id: string; p_status: string }
        Returns: Json
      }
      update_bus: {
        Args: {
          p_bus_id: string
          p_bus_type?: string
          p_layout?: Json
          p_plate_number?: string
        }
        Returns: Json
      }
      update_trip: {
        Args: {
          p_arrival_at?: string
          p_departure_at?: string
          p_price?: number
          p_status?: string
          p_trip_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      booking_status: "confirmed" | "cancelled"
      company_status: "pending" | "approved" | "suspended"
      gender: "male" | "female"
      trip_status: "draft" | "published" | "cancelled"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      booking_status: ["confirmed", "cancelled"],
      company_status: ["pending", "approved", "suspended"],
      gender: ["male", "female"],
      trip_status: ["draft", "published", "cancelled"],
    },
  },
} as const
