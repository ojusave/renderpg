/** Normalizes a team name so "Barium " and "barium" count as the same team. */
export function teamKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Builds a readable, unique URL slug from the project name and record id. */
export function makeSlug(projectName: string, id: string): string {
  const base = projectName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "experiment"}-${id.slice(0, 6)}`;
}
