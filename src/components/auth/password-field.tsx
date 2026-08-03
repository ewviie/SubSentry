"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Shared by login and signup — identical label + input + show/hide toggle +
// aria wiring, with just the autocomplete hint, validation attributes, and
// optional hint text differing per page.
export function PasswordField({
  ref,
  autoComplete,
  required,
  minLength,
  value,
  onChange,
  disabled,
  ariaInvalid,
  ariaDescribedBy,
  hint,
}: {
  ref?: React.Ref<HTMLInputElement>;
  autoComplete: "current-password" | "new-password";
  required?: boolean;
  minLength?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  hint?: React.ReactNode;
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="space-y-2">
      <Label htmlFor="password">Password</Label>
      <div className="relative">
        <Input
          id="password"
          ref={ref}
          type={showPassword ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className="pr-9"
        />
        <button
          type="button"
          onClick={() => setShowPassword((show) => !show)}
          disabled={disabled}
          aria-label={showPassword ? "Hide password" : "Show password"}
          aria-pressed={showPassword}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {hint}
    </div>
  );
}
