import { cn } from "@/lib/utils"

interface MosaicLogoProps {
  className?: string
  size?: "sm" | "md"
}

export default function MosaicLogo({ className, size = "md" }: MosaicLogoProps) {
  const isSm = size === "sm"
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "rounded-lg bg-primary flex items-center justify-center",
          isSm ? "size-6" : "size-7"
        )}
      >
        <div className={cn("grid grid-cols-2 gap-0.5", isSm ? "size-3" : "size-3.5")}>
          <div className="rounded-[1px] bg-primary-foreground/90" />
          <div className="rounded-[1px] bg-primary-foreground/50" />
          <div className="rounded-[1px] bg-primary-foreground/50" />
          <div className="rounded-[1px] bg-primary-foreground/90" />
        </div>
      </div>
      <span
        className={cn(
          "font-semibold tracking-tight text-foreground",
          isSm ? "text-base" : "text-lg"
        )}
      >
        Mosaic
      </span>
    </div>
  )
}
