create unique index if not exists submissions_created_by_unique_idx
  on submissions (lower(created_by));
