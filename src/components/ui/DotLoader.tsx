/**
 * DotLoader — three bouncing blue dots used as a loading indicator.
 * Uses inline style for animation-delay so Tailwind's `animate-bounce`
 * shorthand doesn't override it.
 */
export default function DotLoader({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <span
        className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-bounce"
        style={{ animationDelay: '-0.3s' }}
      />
      <span
        className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-bounce"
        style={{ animationDelay: '-0.15s' }}
      />
      <span
        className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-bounce"
        style={{ animationDelay: '0s' }}
      />
    </div>
  );
}
