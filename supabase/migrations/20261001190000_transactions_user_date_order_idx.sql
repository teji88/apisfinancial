-- Supports the user-scoped transaction fetch ordered by date DESC, id ASC.
-- The user_id prefix matches the transactions RLS predicate; the remaining
-- keys match the stable pagination order used by useTransactions.
CREATE INDEX transactions_user_date_order_idx
  ON public.transactions (user_id, transaction_date DESC, id ASC);
