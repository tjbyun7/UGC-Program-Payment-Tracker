import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://msfxchalkygbqobehfrf.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zZnhjaGFsa3lnYnFvYmVoZnJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNjEzNDYsImV4cCI6MjA4ODczNzM0Nn0.xBQHELo8HaJWThLalE1H5QjtY4eJXjX7aZdMJrpXMJk'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
