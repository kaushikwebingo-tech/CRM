-- Non-throwing casts for dynamic field values.
--
-- Every dynamic field lives in records.data as text, and the schema compiler
-- casts it to the type the field declares. A plain `::numeric` / `::date` /
-- `::uuid` raises for the WHOLE result set when a single row holds a value the
-- cast cannot parse, so one bad value takes out every list, sort and filter on
-- that field for every user. Writes are validated, but legacy rows, CSV
-- imports and a field whose data predates a validation fix can all produce one.
--
-- These helpers return NULL instead. They are IMMUTABLE, so the hot-field
-- promotion job can still build expression indexes on them. A regex fast-path
-- means the plpgsql exception block (and its subtransaction) is only entered
-- for values that are already shaped correctly.

CREATE OR REPLACE FUNCTION crm_try_numeric(v text) RETURNS numeric AS $$
BEGIN
  IF v IS NULL OR v !~ '^\s*[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?\s*$' THEN
    RETURN NULL;
  END IF;
  RETURN v::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION crm_try_date(v text) RETURNS date AS $$
BEGIN
  IF v IS NULL OR v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    RETURN NULL;
  END IF;
  RETURN substring(v FROM 1 FOR 10)::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION crm_try_timestamptz(v text) RETURNS timestamptz AS $$
BEGIN
  IF v IS NULL OR v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    RETURN NULL;
  END IF;
  RETURN v::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION crm_try_uuid(v text) RETURNS uuid AS $$
BEGIN
  IF v IS NULL OR v !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN v::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION crm_try_boolean(v text) RETURNS boolean AS $$
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  CASE lower(v)
    WHEN 'true'  THEN RETURN true;
    WHEN 't'     THEN RETURN true;
    WHEN '1'     THEN RETURN true;
    WHEN 'yes'   THEN RETURN true;
    WHEN 'false' THEN RETURN false;
    WHEN 'f'     THEN RETURN false;
    WHEN '0'     THEN RETURN false;
    WHEN 'no'    THEN RETURN false;
    ELSE RETURN NULL;
  END CASE;
END $$ LANGUAGE plpgsql IMMUTABLE;
