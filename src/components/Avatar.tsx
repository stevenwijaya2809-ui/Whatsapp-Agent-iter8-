const SIZES = {
  sm: "h-9 w-9",
  md: "h-10 w-10",
};

interface AvatarProps {
  name: string | null;
  phone: string;
  size?: keyof typeof SIZES;
}

export function Avatar({ name, phone, size = "md" }: AvatarProps) {
  const initials = name
    ? name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => Array.from(word)[0])
        .join("")
        .toUpperCase()
    : phone.slice(-2);

  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-emerald-600 to-emerald-800 text-xs font-semibold text-white ${SIZES[size]}`}
    >
      {initials}
    </div>
  );
}
