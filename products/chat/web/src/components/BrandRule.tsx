const RULES = (
  <>
    <span className="h-0.5 w-10 rounded-sm bg-accent" />
    <span className="h-px w-16 bg-hairline-strong" />
    <span className="h-px w-24 bg-hairline" />
  </>
);

export function BrandRule({
  className = "",
}: Readonly<{ className?: string }>) {
  return (
    <div className={`flex items-center gap-2 ${className}`} aria-hidden>
      {RULES}
    </div>
  );
}
