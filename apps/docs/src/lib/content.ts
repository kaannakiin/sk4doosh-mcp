const modules = import.meta.glob("../content/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type SectionKey = "tutorial" | "how-to" | "reference" | "explanation";

export interface DocEntry {
  slug: string;
  title: string;
  body: string;
  section: SectionKey | null;
}

export interface DocSection {
  key: SectionKey | null;
  label: string;
  docs: DocEntry[];
}

const SECTION_ORDER: SectionKey[] = [
  "tutorial",
  "how-to",
  "reference",
  "explanation",
];

const SECTION_LABELS: Record<SectionKey, string> = {
  tutorial: "Tutorial",
  "how-to": "How-to guides",
  reference: "Reference",
  explanation: "Explanation",
};

function isSectionKey(value: string): value is SectionKey {
  return (SECTION_ORDER as string[]).includes(value);
}

function parsePath(path: string): { slug: string; section: SectionKey | null } {
  const segments = path.replace("../content/", "").split("/");
  const file = segments.pop() ?? path;
  const dir = segments[0];
  return {
    slug: file.replace(/\.md$/, "").replace(/^\d+-/, ""),
    section: dir !== undefined && isSectionKey(dir) ? dir : null,
  };
}

function titleFromBody(body: string, fallback: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? fallback;
}

function rank(section: SectionKey | null): number {
  return section === null ? -1 : SECTION_ORDER.indexOf(section);
}

export const docs: DocEntry[] = Object.entries(modules)
  .map(([path, body]) => {
    const { slug, section } = parsePath(path);
    return { path, slug, section, title: titleFromBody(body, slug), body };
  })
  .sort(
    (a, b) => rank(a.section) - rank(b.section) || a.path.localeCompare(b.path),
  )
  .map(({ slug, section, title, body }) => ({ slug, section, title, body }));

export const sections: DocSection[] = [null, ...SECTION_ORDER]
  .map((key) => ({
    key,
    label: key === null ? "" : SECTION_LABELS[key],
    docs: docs.filter((doc) => doc.section === key),
  }))
  .filter((section) => section.docs.length > 0);

const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));

export function getDoc(slug: string): DocEntry | undefined {
  return bySlug.get(slug);
}

export const firstDocSlug = docs[0]?.slug;
