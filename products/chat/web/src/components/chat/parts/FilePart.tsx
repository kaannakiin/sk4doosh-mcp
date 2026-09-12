import { IconPaperclip } from "@tabler/icons-react";
import { memo } from "react";

export interface FilePartProps {
  readonly url: string;
  readonly filename?: string;
}

function FilePartComponent({ url, filename }: FilePartProps) {
  return (
    <a
      className="mt-2 inline-flex items-center gap-1.5 font-mono text-[0.8125rem] text-accent"
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      <IconPaperclip size={14} />
      {filename ?? url}
    </a>
  );
}

export const FilePart = memo(FilePartComponent);
