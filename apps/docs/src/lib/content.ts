import registry from "../content/products.json";

const modules = import.meta.glob("../content/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type ModeKey = "tutorial" | "how-to" | "reference" | "explanation";

const MODE_ORDER = [
  "tutorial",
  "how-to",
  "reference",
  "explanation",
] as const satisfies readonly ModeKey[];

const MODE_LABELS: Record<ModeKey, string> = {
  tutorial: "Tutorial",
  "how-to": "How-to guides",
  reference: "Reference",
  explanation: "Explanation",
};

export interface ProductMeta {
  id: string;
  label: string;
  tagline: string;
}

const PRODUCT_META = registry satisfies ProductMeta[];

export interface DocEntry {
  product: string;
  mode: ModeKey | null;
  slug: string;
  title: string;
  body: string;
}

export interface DocGroup {
  key: ModeKey | null;
  label: string;
  docs: DocEntry[];
}

export interface Product extends ProductMeta {
  docs: DocEntry[];
  groups: DocGroup[];
  firstSlug: string;
}

function isModeKey(value: string): value is ModeKey {
  return (MODE_ORDER as readonly string[]).includes(value);
}

function fail(message: string): never {
  throw new Error(`apps/docs src/content: ${message}`);
}

function parsePath(path: string): Omit<DocEntry, "title" | "body"> {
  const rel = path.replace("../content/", "");
  const segments = rel.split("/");
  const file = segments.pop();
  const [product, mode, ...rest] = segments;

  if (file === undefined || product === undefined) {
    fail(`${rel} is not inside a product folder; expected <product>/...`);
  }
  if (rest.length > 0) {
    fail(
      `${rel} is nested too deep; expected <product>/<file>.md or <product>/<mode>/<file>.md`,
    );
  }
  if (mode !== undefined && !isModeKey(mode)) {
    fail(
      `${rel} sits in "${mode}", which is not a Diataxis mode (${MODE_ORDER.join(", ")})`,
    );
  }

  return {
    product,
    mode: mode ?? null,
    slug: file.replace(/\.md$/, "").replace(/^\d+-/, ""),
  };
}

function titleFromBody(body: string, fallback: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? fallback;
}

function modeRank(mode: ModeKey | null): number {
  return mode === null ? -1 : MODE_ORDER.indexOf(mode);
}

const parsed = Object.entries(modules)
  .map(([path, body]) => {
    const base = parsePath(path);
    return { ...base, path, body, title: titleFromBody(body, base.slug) };
  })
  .sort(
    (a, b) =>
      modeRank(a.mode) - modeRank(b.mode) || a.path.localeCompare(b.path),
  );

const registered = new Set(PRODUCT_META.map((meta) => meta.id));

for (const doc of parsed) {
  if (!registered.has(doc.product)) {
    fail(`${doc.product}/ has no entry in src/content/products.json`);
  }
}

function buildProduct(meta: ProductMeta): Product {
  const docs = parsed
    .filter((doc) => doc.product === meta.id)
    .map(({ product, mode, slug, title, body }) => ({
      product,
      mode,
      slug,
      title,
      body,
    }));

  const first = docs[0];
  if (first === undefined) {
    fail(`products.json lists "${meta.id}" but ${meta.id}/ has no pages`);
  }

  const seen = new Set<string>();
  for (const doc of docs) {
    if (seen.has(doc.slug)) {
      fail(`${meta.id}/ has two pages with the slug "${doc.slug}"`);
    }
    seen.add(doc.slug);
  }

  return {
    ...meta,
    docs,
    firstSlug: first.slug,
    groups: [null, ...MODE_ORDER]
      .map((key) => ({
        key,
        label: key === null ? "" : MODE_LABELS[key],
        docs: docs.filter((doc) => doc.mode === key),
      }))
      .filter((group) => group.docs.length > 0),
  };
}

export const products: Product[] = PRODUCT_META.map(buildProduct);

const byProductId = new Map(products.map((product) => [product.id, product]));

const byProductSlug = new Map(
  products.flatMap((product) =>
    product.docs.map((doc) => [`${product.id}/${doc.slug}`, doc] as const),
  ),
);

export function getProduct(id: string): Product | undefined {
  return byProductId.get(id);
}

export function getDoc(product: string, slug: string): DocEntry | undefined {
  return byProductSlug.get(`${product}/${slug}`);
}

export const defaultProduct: Product | undefined = products[0];
