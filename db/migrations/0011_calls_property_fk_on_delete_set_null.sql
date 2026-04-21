-- 0011: Make calls.property_id FK use ON DELETE SET NULL.
--
-- Migration 0009 originally added the FK with no ON DELETE action (defaults
-- to NO ACTION), meaning any attempt to delete a property whose id is
-- referenced by even one call row fails with a FK violation. Calls are our
-- source of truth — when a property is retired we want the call records
-- preserved, just unassigned from the property. SET NULL is the right
-- semantic.
--
-- Fresh DBs also receive this behavior inline in the updated 0009 so this
-- migration is effectively a no-op for them (DROP + ADD of the same
-- constraint name).

ALTER TABLE calls
  DROP CONSTRAINT IF EXISTS calls_property_id_fkey;

ALTER TABLE calls
  ADD CONSTRAINT calls_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
