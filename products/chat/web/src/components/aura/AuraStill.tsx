export function AuraStill({ hidden = false }: { readonly hidden?: boolean }) {
  return (
    <span
      className={`chat-aura-still absolute inset-[5%] rounded-full transition-opacity duration-300 ${hidden ? "opacity-0" : "opacity-100"}`}
    />
  );
}
