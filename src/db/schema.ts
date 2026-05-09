// Plain TypeScript types matching the database schema.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface GmailTokenRow {
  id: string;
  user_id: string;
  email: string;
  access_token: string;
  refresh_token: string | null;
  expiry_date: number | null;
  created_at: string;
  updated_at: string;
}

export interface DigestRunRow {
  id: string;
  user_id: string;
  ran_at: string;
  emails_fetched: number;
  status: "success" | "partial" | "failed";
  error: string | null;
}

export interface AnalyzerResultRow {
  id: string;
  user_id: string;
  analyzer_id: string;
  run_date: string;
  raw_output: Json;
  created_at: string;
}

export interface TransactionDbRow {
  id: string;
  user_id: string;
  service: string;
  amount: number;
  currency: string;
  date: string;
  type: "charge" | "renewal" | "refund";
  analyzer_id: string;
  created_at: string;
}

export interface TransportationMonthlyRow {
  id: string;
  user_id: string;
  month: string;
  goto_spend: number;
  rav_kav_spend: number;
  total: number;
  created_at: string;
}

export interface UserConfigRow {
  id: string;
  user_id: string;
  key: string;
  value: Json;
  updated_at: string;
}
