-- ============================================================================
-- Update 39 — run once in Supabase → SQL Editor (safe to run again). NOT run yet.
--
-- Adds one setting: the default Notes text that every new invoice starts with
-- (More → Quotes & Invoices → Document Defaults → Invoice Notes). Payment
-- instructions already had a default; this is the same idea for Notes.
-- Invoices that already exist are not changed.
-- ============================================================================

alter table public.financial_settings add column if not exists default_invoice_notes text;
