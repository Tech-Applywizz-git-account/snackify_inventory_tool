-- Rollback for 0023_stock_takes.sql
-- stock_takes is standalone (only FKs out to profiles), so dropping it is safe.
drop table if exists stock_takes;
